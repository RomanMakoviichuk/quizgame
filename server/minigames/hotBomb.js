/**
 * «Гаряча бомба» — animal word chain with a bomb (server-authoritative).
 *
 * Trigger: at least one player got the quiz question wrong (like Тупоматика).
 * Participants: EVERY living player.
 * Life loss: whoever holds the bomb when it explodes. That player is out of
 * the rest of this minigame (so nobody loses more than one life here); the
 * bomb restarts with a random remaining player and a fresh word.
 *
 * Two clocks, both on the server:
 *   - round clock: PLAY_MS (2 min) for the whole minigame. When it runs out
 *     and nobody has exploded yet, the bomb blows up in the current holder's
 *     hands (so the round always costs somebody a life); otherwise the round
 *     just ends.
 *   - fuse: FUSE_MIN..FUSE_MAX (15s each by default) from every pass — the
 *     time a holder has to name an animal and pass the bomb on.
 *
 * Moves (all checked here; the phone can't fake them):
 *   hb:word   { seq, text }      holder names an animal on the required letter
 *   hb:target { seq, targetId }  pick who gets the bomb next (can be done in
 *                                advance); a correct word passes the bomb AT
 *                                ONCE — to that pick, or else to the next
 *                                player round the circle
 * `seq` is the bomb's pass counter: a move made for an older bomb (after a
 * pass or an explosion) is dropped, so a word and an explosion arriving at the
 * same moment, or a resent event, can never act twice.
 */
const crypto = require("crypto");
const words = require("./hotBombWords");

const ID = "hotBomb";

const CONFIG = {
  PREP_MS: Number(process.env.HOT_BOMB_PREP_MS) || 20000, // rules + 3-2-1
  PLAY_MS: Number(process.env.HOT_BOMB_PLAY_MS) || 120000,
  FUSE_MIN_MS: Number(process.env.HOT_BOMB_FUSE_MIN_MS) || 15000, // time per holder
  FUSE_MAX_MS: Number(process.env.HOT_BOMB_FUSE_MAX_MS) || 15000,
  BOOM_PAUSE_MS: 2800, // explosion scene before the bomb comes back
  MIN_WORD_GAP_MS: 350, // flood guard: one word attempt per 350ms
  CHAIN_SHOWN: 12,
};
const TOTAL_DURATION_MS = CONFIG.PREP_MS + CONFIG.PLAY_MS + 8000; // server hard stop

const pick = (arr) => arr[crypto.randomInt(0, arr.length)];
const fuseLength = () => crypto.randomInt(CONFIG.FUSE_MIN_MS, CONFIG.FUSE_MAX_MS + 1);

// ---------------------------------------------------------------- contest

function buildContest({ players, correctIndex, roundIndex }) {
  if (players.length < 2) return null;
  const failers = players.filter((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex));
  if (failers.length === 0) return null; // everyone right -> no minigame
  return {
    minigameId: ID,
    mode: "all_play_bomb",
    roundIndex,
    contestantIds: players.map((p) => p.id),
  };
}

function onStart(mg) {
  mg.hb = {
    phase: "prep", // prep | live | boom | done
    holder: null,
    seq: 0,
    word: null, // last accepted (or start) word
    letter: null, // the next word starts with this
    used: new Set(),
    chain: [], // [{ word, by }] by = null for start words
    out: [], // exploded players (in order)
    left: [], // disconnected players
    target: {}, // holder's pre-picked recipient: playerId -> targetId
    awaitingTarget: false,
    passedAt: 0,
    fuseEndsAt: 0,
    boomUntil: 0,
    startAt: 0,
    endsAt: 0,
    lastTry: {},
    explosions: [], // [{ id, at, word }]
    passes: 0,
  };
}

const active = (mg) => mg.contestantIds.filter((id) => !mg.hb.out.includes(id) && !mg.hb.left.includes(id));

/** The next player still in the game after `from`, going round the circle. */
function nextAfter(mg, from) {
  const ring = mg.contestantIds.filter((id) => id === from || active(mg).includes(id));
  const i = ring.indexOf(from);
  for (let k = 1; k <= ring.length; k++) {
    const id = ring[(i + k) % ring.length];
    if (id !== from) return id;
  }
  return null;
}

function publicState(mg, now) {
  const s = mg.hb;
  return {
    phase: s.phase,
    seq: s.seq,
    holderId: s.holder,
    word: s.word,
    letter: s.letter,
    chain: s.chain.slice(-CONFIG.CHAIN_SHOWN),
    usedCount: s.used.size,
    activeIds: active(mg),
    outIds: [...s.out],
    awaitingTarget: s.awaitingTarget,
    passedAt: s.passedAt,
    startAt: s.startAt,
    endsAt: s.endsAt,
    serverNow: now,
    fuseMinMs: CONFIG.FUSE_MIN_MS,
    fuseMaxMs: CONFIG.FUSE_MAX_MS,
  };
}

const broadcast = (mg, ctx, extra = {}) => ctx.emitAll("hb:state", { ...publicState(mg, ctx.now()), ...extra });

/** One server timer: whichever comes first — fuse, end of the boom scene, end of round. */
function arm(mg, ctx) {
  const s = mg.hb;
  if (s.phase === "done") return;
  let next;
  if (s.phase === "prep") next = s.startAt;
  else if (s.phase === "boom") next = s.finalBoom ? s.boomUntil : Math.min(s.boomUntil, s.endsAt);
  else next = Math.min(s.fuseEndsAt, s.endsAt); // the fuse burns while choosing a target too
  ctx.setTimer(() => tick(mg, ctx), Math.max(0, next - ctx.now()));
}

function tick(mg, ctx) {
  const s = mg.hb;
  const now = ctx.now();
  if (s.phase === "done") return;
  if (s.phase === "prep") {
    if (now < s.startAt) return arm(mg, ctx);
    return newBomb(mg, ctx, null);
  }
  if (now >= s.endsAt) {
    // time is up: nobody blew up yet -> the bomb goes off in the holder's hands
    if (s.phase === "live" && s.explosions.length === 0) return explode(mg, ctx, true);
    if (s.phase === "boom" && s.finalBoom && now < s.boomUntil) return arm(mg, ctx);
    return finish(mg, ctx);
  }
  if (s.phase === "live" && now >= s.fuseEndsAt) return explode(mg, ctx);
  if (s.phase === "boom" && now >= s.boomUntil) {
    if (active(mg).length < 2) return finish(mg, ctx);
    return newBomb(mg, ctx, null);
  }
  arm(mg, ctx);
}

/** A fresh bomb: random start word, random holder (never `notTo` if avoidable). */
function newBomb(mg, ctx, notTo) {
  const s = mg.hb;
  const ids = active(mg);
  if (ids.length < 2) return finish(mg, ctx);
  const start = words.randomStartWord(s.used);
  if (!start) return finish(mg, ctx);
  s.used.add(start.key);
  s.word = start.word;
  s.chain.push({ word: start.word, by: null });
  s.letter = words.chainLetter(start.key, s.used);
  const pool = ids.filter((id) => id !== notTo);
  giveBomb(mg, ctx, pick(pool.length ? pool : ids));
}

function giveBomb(mg, ctx, to) {
  const s = mg.hb;
  const now = ctx.now();
  s.phase = "live";
  s.holder = to;
  s.seq += 1;
  s.awaitingTarget = false;
  s.passedAt = now;
  s.fuseEndsAt = now + fuseLength();
  if (s.target[to] && !active(mg).includes(s.target[to])) delete s.target[to];
  broadcast(mg, ctx);
  arm(mg, ctx);
}

function explode(mg, ctx, final = false) {
  const s = mg.hb;
  if (s.phase !== "live" || !s.holder) return;
  s.finalBoom = final; // the round-end explosion: show the scene, then finish
  const victim = s.holder;
  s.out.push(victim);
  s.explosions.push({ id: victim, at: ctx.now(), word: s.word, letter: s.letter });
  s.phase = "boom";
  s.seq += 1; // any move still in flight for this bomb is now stale
  s.holder = null;
  s.awaitingTarget = false;
  s.boomUntil = ctx.now() + CONFIG.BOOM_PAUSE_MS;
  broadcast(mg, ctx, { boom: { id: victim } });
  arm(mg, ctx);
}

function finish(mg, ctx) {
  const s = mg.hb;
  if (s.phase === "done") return;
  s.phase = "done";
  s.holder = null;
  s.seq += 1;
  broadcast(mg, ctx);
  ctx.resolveNow();
}

// ---------------------------------------------------------------- moves

function onSync(mg, nowTs, ctx) {
  const s = mg.hb;
  s.startAt = nowTs + CONFIG.PREP_MS;
  s.endsAt = s.startAt + CONFIG.PLAY_MS;
  ctx.emitAll("hb:go", { startAt: s.startAt, endsAt: s.endsAt, serverNow: nowTs });
  broadcast(mg, ctx);
  arm(mg, ctx);
}

function pass(mg, ctx, from, to) {
  const s = mg.hb;
  const ids = active(mg);
  if (to === from || !ids.includes(to)) return false;
  delete s.target[from]; // a pick is used once
  s.passes += 1;
  giveBomb(mg, ctx, to);
  ctx.emitAll("hb:pass", { from, to, seq: s.seq });
  return true;
}

function onClientEvent(mg, playerId, name, data, ctx) {
  const s = mg.hb;
  if (!s || s.phase !== "live") return;
  const seq = Number(data?.seq);

  if (name === "hb:target") {
    const targetId = String(data?.targetId || "");
    if (s.holder !== playerId) {
      // not your bomb yet — remember the pick for when it comes
      if (active(mg).includes(playerId) && targetId !== playerId) s.target[playerId] = targetId;
      return;
    }
    if (seq !== s.seq) return;
    if (s.awaitingTarget) {
      if (!pass(mg, ctx, playerId, targetId)) ctx.emitPlayer(playerId, "hb:reject", { seq, reason: "target", message: "Цьому гравцю не можна" });
    } else if (targetId !== playerId && active(mg).includes(targetId)) {
      s.target[playerId] = targetId;
      ctx.emitPlayer(playerId, "hb:targetAck", { seq, targetId });
    }
    return;
  }

  if (name !== "hb:word") return;
  if (s.holder !== playerId || seq !== s.seq || s.awaitingTarget) return;
  const now = ctx.now();
  if (now - (s.lastTry[playerId] || 0) < CONFIG.MIN_WORD_GAP_MS) return;
  s.lastTry[playerId] = now;

  const text = String(data?.text ?? "").slice(0, 40);
  const res = words.validateAnimalWord(text, s.letter, s.used);
  if (!res.ok) {
    if (res.reason === "unknown") words.noteUnknown(text);
    ctx.emitPlayer(playerId, "hb:reject", { seq, reason: res.reason, message: res.message, text });
    ctx.emitAll("hb:miss", { by: playerId, text: text.trim().slice(0, 24), reason: res.reason });
    return; // the fuse keeps burning
  }

  s.used.add(res.key);
  s.word = res.word;
  s.chain.push({ word: res.word, by: playerId });
  s.letter = words.chainLetter(res.key, s.used);
  ctx.emitPlayer(playerId, "hb:accept", { seq, word: res.word });

  // a right word passes the bomb at once: to the player picked in advance, else the next one round the circle
  const pre = s.target[playerId];
  if (pre && pass(mg, ctx, playerId, pre)) return;
  const next = nextAfter(mg, playerId);
  if (next && pass(mg, ctx, playerId, next)) return;
  s.awaitingTarget = true; // nobody else to take it (cannot really happen with 2+ players)
  broadcast(mg, ctx, { accepted: { by: playerId, word: res.word } });
}

/** A player left the room mid-round: never leave the bomb with them, no life lost. */
function onPlayerLeft(mg, playerId, ctx) {
  const s = mg.hb;
  if (!s || s.phase === "done" || !mg.contestantIds.includes(playerId) || s.left.includes(playerId)) return;
  s.left.push(playerId);
  for (const [k, v] of Object.entries(s.target)) if (v === playerId || k === playerId) delete s.target[k];
  const ids = active(mg);
  if (s.phase === "prep") return broadcast(mg, ctx);
  if (ids.length < 2) return finish(mg, ctx);
  if (s.phase === "live" && s.holder === playerId) return giveBomb(mg, ctx, pick(ids));
  broadcast(mg, ctx);
}

// ---------------------------------------------------------------- results

function resolveLosers(mg) {
  return [...new Set(mg.hb?.explosions.map((e) => e.id) || [])];
}

function buildResults(mg) {
  const s = mg.hb;
  const wordsBy = {};
  for (const c of s.chain) if (c.by) wordsBy[c.by] = (wordsBy[c.by] || 0) + 1;
  return {
    minigameScores: wordsBy,
    explosions: s.explosions,
    chain: s.chain.slice(-30),
    wordsBy,
    passes: s.passes,
  };
}

module.exports = {
  ID,
  CONFIG,
  TOTAL_DURATION_MS,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  onPlayerLeft,
  resolveLosers,
  buildResults,
  publicState,
};
