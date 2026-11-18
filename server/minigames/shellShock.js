/**
 * «Не кліпай!» (id: shellShock) — the shell game: a thing goes under one of
 * three identical cups, the cups swap places, faster and faster; pick the cup.
 *
 * Trigger: at least ONE player got the quiz question wrong; everyone alive plays.
 *
 * Three rounds, harder and harder (DIFFICULTY): a shorter look at the thing,
 * more moves, faster moves, crossovers (a far swap over the middle cup, all
 * three rotating), feints (two cups start to swap and go back), short pauses.
 *
 * Cups have a stable identity (c1, c2, c3) and a position (0 left, 1 middle,
 * 2 right). The thing stays under its own cup the whole round; every move maps
 * cups to new positions and only through that does the answer change. The whole
 * sequence is generated once per round (onStart) — the same for everybody, never
 * regenerated: a TV that reloads replays it from the server clock.
 * The TV alone gets the sequence and the thing's cup; the phones only get the
 * timings (they could compute the answer from the sequence otherwise).
 *
 * A round (server clock): INTRO (the host's line) -> REVEAL (the thing shows
 * under its lifted cup, memorize ms) -> COVER (the cup comes down) -> SHUFFLE
 * (the moves) -> SUSPENSE -> ANSWER (phones: «1 / 2 / 3», one tap, final) ->
 * RESULT (the cups lift, the right one shows the thing). Closes early when
 * everybody has answered.
 *
 * An answer is a final position 1..3 (left to right, as the cups stand at the
 * end). The server checks it against the thing's cup's final position; the
 * first answer counts, before ANSWER or after its end nothing is taken.
 * Points: ROUND_POINTS[round] for a right answer, 0 otherwise.
 * Lives: the lowest total loses one life (ties: all of them, as in «Меморі»);
 * everybody equal -> nobody. A single best total > 0 is the winner.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ID = "shellShock";
const MIN_PLAYERS = 2;
const POSITIONS = 3;
const CUPS = ["c1", "c2", "c3"];

const CONFIG = {
  PREP_MS: Number(process.env.SHELL_PREP_MS) || 12000, // title + rules on the TV
  INTRO_MS: 3500, // "Раунд N з 3" + the host's line
  COVER_MS: 800, // the cup comes down over the thing
  ANSWER_MS: Number(process.env.SHELL_ANSWER_MS) || 6000,
  RESULT_MS: Number(process.env.SHELL_RESULT_MS) || 8500, // the cups lift, the verdicts
  LAST_RESULT_MS: 7500, // round 3's reveal, then the final board
  CLOSE_GRACE_MS: 400, // an answer tapped before the end may arrive a little after it
  ROUND_POINTS: [100, 150, 200],
};

/**
 * Difficulty per round. Moves: a count range; durations ramp from `startMs` to
 * `endMs` over the round (acceleration); `gapMs` between moves (`pauses` of them
 * a longer `pauseMs`); `cross` = far swaps (0<->2 over the middle) and 3-cup
 * rotations allowed; `feints` = fake swaps; `finalMs` = a slower dramatic last move.
 */
const DIFFICULTY = [
  { level: "Розминка", memorizeMs: 1700, moves: [12, 16], startMs: 480, endMs: 230, gapMs: 40, pauses: 1, pauseMs: 300, cross: true, feints: 2, finalMs: 650, suspenseMs: 1000 },
  { level: "Повний хаос", memorizeMs: 1400, moves: [16, 20], startMs: 380, endMs: 180, gapMs: 25, pauses: 1, pauseMs: 250, cross: true, feints: 3, finalMs: 600, suspenseMs: 1100 },
  { level: "Неможливо", memorizeMs: 1200, moves: [20, 26], startMs: 320, endMs: 140, gapMs: 15, pauses: 1, pauseMs: 220, cross: true, feints: 4, finalMs: 600, suspenseMs: 1200 },
];

const HOST = [
  ["Це розминка. Легка. Мабуть.", "Дивіться уважно. Тут буквально три стаканчики."],
  ["Досі впевнені? Як мило.", "Ваші очі зараз напишуть на мене скаргу."],
  ["Тут ваша впевненість і помре.", "Кліпнете зараз — винні будете самі."],
];
const QUIPS = {
  allRight: ["Всі вгадали?! Я втрачаю форму…", "Підозріло гострий зір у цієї компанії."],
  mostRight: ["Хтось таки дивився!", "Можете зберегти свою гідність."],
  mostWrong: ["Дякую. Я тренувався для цієї миті.", "Хвилина мовчання за вашою увагою."],
  allWrong: ["Жодного! Ось це я розумію — майстерність.", "Він був прямо тут! Під носом!"],
};

/**
 * The things that go under the cup: a drop-in folder — every picture in
 * client/public/assets/minigames/shell-shock/items/ (png/webp/gif/jpg/svg),
 * read afresh each game, served straight from there (server.js), so a new file
 * needs no rebuild and no restart. The file name is what the host calls it
 * («огірок.png» -> «огірок»; «гумова_качка 2.webp» -> «гумова качка»).
 * An empty folder -> the «Меморі» pictures below.
 */
const ITEMS_DIR = path.join(__dirname, "..", "..", "client", "public", "assets", "minigames", "shell-shock", "items");
const ITEMS_URL = "/assets/minigames/shell-shock/items";
const nameOf = (file) =>
  path
    .parse(file)
    .name.replace(/[_-]+/g, " ")
    .replace(/\s*\d+$/, "")
    .trim()
    .toLowerCase() || "річ";
function loadObjects(dir = ITEMS_DIR) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(png|webp|gif|jpe?g|svg)$/i.test(f));
  } catch {
    /* no folder: the defaults */
  }
  const own = files.map((f) => ({ id: f, name: nameOf(f), src: `${ITEMS_URL}/${encodeURIComponent(f)}`, fallback: null }));
  return own.length ? own : OBJECTS;
}
const IMAGE_DIR = "/assets/minigames/memory";
const OBJECTS = [
  { id: "cucumber", name: "огірок", file: "cucumber.png" },
  { id: "banana", name: "банан", file: "banana.png" },
  { id: "orange", name: "апельсин", file: "orange.png" },
  { id: "wrench", name: "ключ", file: "key.png" },
  { id: "cone", name: "конус", file: "road cone.png" },
].map((o) => ({ ...o, src: `${IMAGE_DIR}/web/${o.id}.webp`, fallback: `${IMAGE_DIR}/${encodeURIComponent(o.file)}` }));

const rint = (lo, hi) => crypto.randomInt(lo, hi + 1);
const pick = (list) => list[crypto.randomInt(0, list.length)];

// ---------------------------------------------------------------- the moves (pure)

/**
 * One round's sequence. `rng(lo, hi)` gives an integer in [lo, hi] (crypto by
 * default; tests pass their own). Returns
 *   { start: {cupId: pos}, objectCup, moves: [{ kind, at, ms, from: {cupId: pos}, to: {cupId: pos}, front }], shuffleMs }
 * `at` is ms from the shuffle's start; `front` is the cup passing in front in a
 * crossing (the other goes behind). kind: swap (neighbours) | cross (0<->2 over
 * the middle) | rotate (all three) | feint (from == to: its `pair` of cups only
 * starts to swap and slides back).
 */
function makeSequence(diff, rng = rint) {
  const start = Object.fromEntries(CUPS.map((c, i) => [c, i]));
  const objectCup = CUPS[rng(0, CUPS.length - 1)];
  const count = rng(diff.moves[0], diff.moves[1]);
  // which steps are feints / get a longer pause after them (never the last move)
  const feintAt = new Set();
  while (feintAt.size < Math.min(diff.feints, Math.max(0, count - 2))) feintAt.add(rng(1, count - 2));
  const pauseAfter = new Set();
  while (pauseAfter.size < Math.min(diff.pauses, Math.max(0, count - 1))) pauseAfter.add(rng(0, count - 2));

  let pos = { ...start };
  const moves = [];
  let t = 0;
  let lastPair = "";
  for (let k = 0; k < count; k++) {
    const p = count > 1 ? k / (count - 1) : 1;
    const last = k === count - 1;
    let ms = Math.round(diff.startMs + (diff.endMs - diff.startMs) * p);
    if (last && diff.finalMs) ms = diff.finalMs;
    const at = posToCup(pos);
    let kind;
    let to;
    let front = null;
    let pair = null;
    if (feintAt.has(k)) {
      // two neighbours start to swap and slide back: nothing changes
      kind = "feint";
      const a = rng(0, 1);
      pair = [at[a], at[a + 1]];
      front = at[a];
      to = { ...pos };
      lastPair = `${a}${a + 1}`;
    } else {
      // a swap of two positions (adjacent; far = over the middle when allowed) or a rotation
      const options = ["01", "12"];
      if (diff.cross) options.push("02", "rotL", "rotR");
      let kindKey;
      do kindKey = options[rng(0, options.length - 1)];
      while (kindKey === lastPair && options.length > 1 && !kindKey.startsWith("rot")); // not the same swap twice in a row (it undoes itself)
      lastPair = kindKey;
      to = { ...pos };
      if (kindKey.startsWith("rot")) {
        kind = "rotate";
        const step = kindKey === "rotL" ? POSITIONS - 1 : 1;
        for (const c of CUPS) to[c] = (pos[c] + step) % POSITIONS;
        front = at[kindKey === "rotL" ? 0 : 2]; // the cup jumping the whole table passes in front
      } else {
        kind = kindKey === "02" ? "cross" : "swap";
        const [a, b] = kindKey.split("").map(Number);
        to[at[a]] = b;
        to[at[b]] = a;
        front = at[rng(0, 1) ? a : b];
      }
    }
    moves.push({ kind, at: t, ms, from: { ...pos }, to, front, ...(pair ? { pair } : {}) });
    pos = to;
    t += ms + (last ? 0 : pauseAfter.has(k) ? diff.pauseMs : diff.gapMs);
  }
  return { start, objectCup, moves, shuffleMs: t };
}

/** position -> cupId */
function posToCup(pos) {
  const out = [];
  for (const c of CUPS) out[pos[c]] = c;
  return out;
}

/** Where every cup stands after the whole sequence (follows the moves, nothing else). */
function finalPositions(seq) {
  return seq.moves.reduce((pos, m) => ({ ...m.to }), { ...seq.start });
}

/** The right answer: the thing's cup's final position, 1..3 left to right. */
const correctAnswer = (seq) => finalPositions(seq)[seq.objectCup] + 1;

// ---------------------------------------------------------------- contest

function buildContest({ players, correctIndex, roundIndex }) {
  const failers = players.filter((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex)).map((p) => p.id);
  if (failers.length === 0 || players.length < MIN_PLAYERS) return null;
  return {
    minigameId: ID,
    mode: "all_play_lowest_loses",
    roundIndex,
    contestantIds: players.map((p) => p.id), // EVERYONE plays
    quizFailerIds: failers,
  };
}

function onStart(mg) {
  const objects = loadObjects();
  mg.ss = {
    prepEndsAt: 0,
    current: -1,
    rounds: DIFFICULTY.map((diff, i) => ({
      ...makeSequence(diff),
      object: pick(objects),
      host: pick(HOST[i]),
      introAt: 0,
      revealAt: 0,
      coverAt: 0,
      shuffleAt: 0,
      answerAt: 0,
      endAt: 0,
      answers: {}, // playerId -> 1..3 (first one only)
      rows: null,
      quip: null,
      nextAt: 0,
    })),
    outcome: null,
  };
}

const TOTAL_DURATION_MS =
  CONFIG.PREP_MS +
  DIFFICULTY.reduce((sum, d) => sum + CONFIG.INTRO_MS + d.memorizeMs + CONFIG.COVER_MS + 9000 + d.suspenseMs + CONFIG.ANSWER_MS + CONFIG.CLOSE_GRACE_MS + CONFIG.RESULT_MS, 0) +
  10000; // server hard stop (9 s: more than any shuffle runs)

const roundMeta = () => DIFFICULTY.map((d, i) => ({ index: i + 1, level: d.level, points: CONFIG.ROUND_POINTS[i] }));

/** What everybody may know about a round: the timings, never the cups. */
function roundPayload(mg, i, now) {
  const r = mg.ss.rounds[i];
  return {
    round: i + 1,
    of: DIFFICULTY.length,
    level: DIFFICULTY[i].level,
    points: CONFIG.ROUND_POINTS[i],
    host: r.host,
    object: { id: r.object.id, name: r.object.name, src: r.object.src, fallback: r.object.fallback },
    introAt: r.introAt,
    revealAt: r.revealAt,
    coverAt: r.coverAt,
    shuffleAt: r.shuffleAt,
    answerAt: r.answerAt,
    endAt: r.endAt,
    serverNow: now,
  };
}

/** The TV's extra: the cups, the thing's cup and the moves. */
function showPayload(mg, i, now) {
  const r = mg.ss.rounds[i];
  return { ...roundPayload(mg, i, now), start: r.start, objectCup: r.objectCup, moves: r.moves, coverMs: CONFIG.COVER_MS };
}

function totalsOf(mg, upto) {
  const totals = Object.fromEntries(mg.contestantIds.map((id) => [id, 0]));
  mg.ss.rounds.slice(0, upto + 1).forEach((r) => (r.rows || []).forEach((row) => (totals[row.id] += row.points)));
  return totals;
}
const rankIds = (ids, totals) => [...ids].sort((a, b) => totals[b] - totals[a] || (a < b ? -1 : 1));

function resultPayload(mg, i, now) {
  const r = mg.ss.rounds[i];
  const totals = totalsOf(mg, i);
  return {
    round: i + 1,
    of: DIFFICULTY.length,
    correct: correctAnswer(r),
    objectCup: r.objectCup,
    final: finalPositions(r),
    rows: r.rows,
    quip: r.quip,
    totals,
    ranked: rankIds(mg.contestantIds, totals),
    nextAt: r.nextAt,
    serverNow: now,
  };
}

const progressPayload = (mg) => {
  const r = mg.ss.rounds[mg.ss.current];
  return { round: mg.ss.current + 1, answeredIds: r ? Object.keys(r.answers) : [] };
};
const goPayload = (mg, now) => ({ prepEndsAt: mg.ss.prepEndsAt, rounds: roundMeta(), serverNow: now });

function onSync(mg, nowTs, ctx) {
  mg.ss.prepEndsAt = nowTs + CONFIG.PREP_MS;
  ctx.emitAll("ss:go", goPayload(mg, nowTs));
  ctx.setTimer(() => startRound(mg, 0, ctx), CONFIG.PREP_MS);
}

function startRound(mg, i, ctx) {
  const s = mg.ss;
  const now = ctx.now();
  const r = s.rounds[i];
  const diff = DIFFICULTY[i];
  s.current = i;
  r.introAt = now;
  r.revealAt = now + CONFIG.INTRO_MS;
  r.coverAt = r.revealAt + diff.memorizeMs;
  r.shuffleAt = r.coverAt + CONFIG.COVER_MS;
  r.answerAt = r.shuffleAt + r.shuffleMs + diff.suspenseMs;
  r.endAt = r.answerAt + CONFIG.ANSWER_MS;
  ctx.emitAll("ss:round", roundPayload(mg, i, now));
  ctx.emitDisplay?.("ss:show", showPayload(mg, i, now));
  ctx.emitAll("ss:progress", progressPayload(mg));
  ctx.setTimer(() => closeRound(mg, i, ctx), r.endAt - now + CONFIG.CLOSE_GRACE_MS);
}

function quipFor(rows) {
  const right = rows.filter((r) => r.correct).length;
  const share = rows.length ? right / rows.length : 0;
  const bucket = share === 1 ? "allRight" : share === 0 ? "allWrong" : share >= 0.5 ? "mostRight" : "mostWrong";
  return pick(QUIPS[bucket]);
}

function scoreRound(mg, i) {
  const r = mg.ss.rounds[i];
  const right = correctAnswer(r);
  return mg.contestantIds.map((id) => {
    const answer = r.answers[id] ?? null;
    const correct = answer === right;
    return { id, pick: answer, correct, points: correct ? CONFIG.ROUND_POINTS[i] : 0 };
  });
}

function closeRound(mg, i, ctx) {
  const r = mg.ss.rounds[i];
  if (!r || r.rows) return; // closed already (everybody answered, then the timer)
  const now = ctx.now();
  r.rows = scoreRound(mg, i);
  r.quip = quipFor(r.rows);
  const last = i === DIFFICULTY.length - 1;
  const hold = last ? CONFIG.LAST_RESULT_MS : CONFIG.RESULT_MS;
  r.nextAt = now + hold;
  ctx.emitAll("ss:roundResult", resultPayload(mg, i, now));
  if (last) ctx.scheduleResolve(hold);
  else ctx.setTimer(() => startRound(mg, i + 1, ctx), hold);
}

/** The state as it stands (a screen that reloaded): same sequence, never a new one. */
function sendState(mg, now, emit, isDisplay) {
  const s = mg.ss;
  if (!s.prepEndsAt) return;
  emit("ss:go", goPayload(mg, now));
  if (s.current < 0) return;
  emit("ss:round", roundPayload(mg, s.current, now));
  if (isDisplay) emit("ss:show", showPayload(mg, s.current, now));
  emit("ss:progress", progressPayload(mg));
  if (s.rounds[s.current].rows) emit("ss:roundResult", resultPayload(mg, s.current, now));
}

function onClientEvent(mg, playerId, name, data, ctx) {
  const s = mg.ss;
  if (!s) return;
  const now = ctx.now();
  if (name === "ss:hello") {
    sendState(mg, now, (ev, payload) => ctx.emitPlayer(playerId, ev, payload), false);
    const r = s.rounds[s.current];
    if (r && r.answers[playerId] != null) ctx.emitPlayer(playerId, "ss:ack", { round: s.current + 1, pick: r.answers[playerId] });
    return;
  }
  if (name !== "ss:pick") return;
  if (!mg.contestantIds.includes(playerId)) return;
  const i = s.current;
  const r = s.rounds[i];
  if (!r || r.rows || Number(data?.round) !== i + 1) return; // no round / closed / another round
  if (now < r.answerAt || now > r.endAt + CONFIG.CLOSE_GRACE_MS) return; // still shuffling / too late
  if (r.answers[playerId] != null) return; // one answer, final
  const pos = Number(data?.pos);
  if (!Number.isInteger(pos) || pos < 1 || pos > POSITIONS) return;
  r.answers[playerId] = pos;
  ctx.emitPlayer(playerId, "ss:ack", { round: i + 1, pick: pos });
  ctx.emitAll("ss:progress", progressPayload(mg));
  if (mg.contestantIds.every((id) => r.answers[id] != null)) closeRound(mg, i, ctx); // everybody answered
}

function onDisplayEvent(mg, name, data, ctx) {
  if (name === "ss:hello") sendState(mg, ctx.now(), (ev, payload) => ctx.emitDisplay?.(ev, payload), true);
}

// ---------------------------------------------------------------- outcome

/** Close whatever round is open and freeze the totals (idempotent). */
function outcomeOf(mg) {
  const s = mg.ss;
  if (s.outcome) return s.outcome;
  s.rounds.forEach((r, i) => {
    if (r.introAt && !r.rows) r.rows = scoreRound(mg, i); // a hard stop mid-round
  });
  const totals = totalsOf(mg, s.rounds.length - 1);
  const ranked = rankIds(mg.contestantIds, totals);
  const values = mg.contestantIds.map((id) => totals[id]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const allEqual = !values.length || min === max;
  const best = mg.contestantIds.filter((id) => totals[id] === max);
  s.outcome = {
    totals,
    ranked,
    loserIds: allEqual ? [] : mg.contestantIds.filter((id) => totals[id] === min),
    winnerId: !allEqual && max > 0 && best.length === 1 ? best[0] : null,
  };
  return s.outcome;
}

const resolveLosers = (mg) => [...outcomeOf(mg).loserIds];
const resolveWinner = (mg) => outcomeOf(mg).winnerId;

function buildResults(mg) {
  const o = outcomeOf(mg);
  return {
    minigameScores: { ...o.totals },
    shellShock: {
      rounds: mg.ss.rounds.map((r, i) => ({ round: i + 1, level: DIFFICULTY[i].level, points: CONFIG.ROUND_POINTS[i], correct: correctAnswer(r), rows: r.rows || [] })),
      totals: { ...o.totals },
      ranked: [...o.ranked],
      winnerId: o.winnerId,
      // the minigame's losers even when the quiz answer shields their life (results.loserIds leaves them out)
      lowestIds: [...(mg.minigameLoserIds || o.loserIds)],
    },
  };
}

module.exports = {
  ID,
  CONFIG,
  CUPS,
  DIFFICULTY,
  OBJECTS,
  ITEMS_DIR,
  ITEMS_URL,
  loadObjects,
  TOTAL_DURATION_MS,
  makeSequence,
  finalPositions,
  correctAnswer,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  HELLO: "ss:hello",
  onDisplayEvent,
  resolveLosers,
  resolveWinner,
  buildResults,
};
