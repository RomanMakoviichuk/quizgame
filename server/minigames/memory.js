/**
 * «Меморі: кольоровий хаос» (id: memory) — remember a row of items and their
 * (unnatural) colours, then restore either the order or the colours.
 *
 * Trigger: at least 2 living players got the quiz question wrong; they play.
 *
 * Round (decided ONCE in onStart, the same for everybody):
 *   - the level follows the game's difficulty: easy -> 2 colours, medium -> 3,
 *     hard -> 4 (the maximum); "mixed" (climbing) climbs with the quiz round:
 *     1-3 easy, 4-6 medium, 7+ hard — the palette is a random pick of that many colours;
 *   - COUNT different items picked at random from server/data/memoryItems.json,
 *     in a random order, each with a random colour from the palette;
 *   - the mode: "order" (put the items back in order) or "color" (give each
 *     item its colour), 50/50. The mode stays secret until the answer phase.
 *
 * Timeline (server clock): PREP (rules + 3-2-1) -> SHOW (the coloured row, on
 * the TV only) -> ANSWER (phones get the task) -> results. Phones never get the
 * coloured row: `mem:show` goes to the display socket only, and the colour task
 * carries no colours.
 *
 * Answers: a phone keeps sending its current answer (`mem:answer`); `final:
 * true` locks it. When the time is up the last answer counts (locked or not);
 * after that nothing is accepted. Everybody locked early -> results right away.
 *
 * Scoring: 1 point per item in the right place (order) / with the right colour
 * (color); empty spots score 0. Max = COUNT.
 * Lives: the lowest score loses one life (ties: all of them). Everybody equal
 * -> nobody. The single best score > 0 gets the usual minigame bonus.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ID = "memory";
const COLORS = ["blue", "red", "green", "yellow"];
const MODES = ["order", "color"];
const MIN_PLAYERS = 2;
const IMAGE_DIR = "/assets/minigames/memory"; // client/public/assets/minigames/memory

// level by the quiz round (1-based): up to `untilRound` -> `colors` colours in play
const LEVELS = [
  { id: "easy", name: "Легкий", colors: 2, untilRound: 3 },
  { id: "medium", name: "Середній", colors: 3, untilRound: 6 },
  { id: "hard", name: "Максимальний", colors: 4, untilRound: Infinity },
];
/** The game's difficulty sets the level; "mixed" (or none) climbs with the round. */
const levelFor = (roundIndex, difficulty) =>
  LEVELS.find((l) => l.id === difficulty) ||
  LEVELS.find((l) => (Number(roundIndex) || 1) <= l.untilRound) ||
  LEVELS[LEVELS.length - 1];

const CONFIG = {
  COUNT: Number(process.env.MEMORY_COUNT) || 5,
  PREP_MS: Number(process.env.MEMORY_PREP_MS) || 15000, // title + rules + 3-2-1
  SHOW_MS: Number(process.env.MEMORY_SHOW_MS) || 10000, // remember
  ANSWER_MS: Number(process.env.MEMORY_ANSWER_MS) || 15000,
  CLOSE_GRACE_MS: 250,
};
const TOTAL_DURATION_MS = CONFIG.PREP_MS + CONFIG.SHOW_MS + CONFIG.ANSWER_MS + 8000; // server hard stop

// ---------------------------------------------------------------- item registry

/**
 * server/data/memoryItems.json: [{ id, name, image, colors? }]. `image` is the
 * file in client/public/assets/minigames/memory; an optimised copy
 * web/<id>.webp is used when it exists (see items/README.md).
 */
function loadItems(file = path.join(__dirname, "..", "data", "memoryItems.json")) {
  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`[memory] cannot read ${file}: ${e.message}`);
  }
  const seen = new Set();
  return raw
    .filter((it) => it && typeof it.id === "string" && typeof it.image === "string" && !seen.has(it.id) && seen.add(it.id))
    .map((it) => ({
      id: it.id,
      name: String(it.name || it.id),
      src: `${IMAGE_DIR}/web/${encodeURIComponent(it.id)}.webp`,
      fallback: `${IMAGE_DIR}/${encodeURIComponent(it.image)}`,
      colors: Array.isArray(it.colors) && it.colors.some((c) => COLORS.includes(c)) ? it.colors.filter((c) => COLORS.includes(c)) : COLORS,
    }));
}
let ITEMS = loadItems();

const pick = (list) => list[crypto.randomInt(0, list.length)];
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A round: the palette (`paletteSize` random colours), COUNT different items in
 * a random order, each painted a random colour of the palette, a random mode.
 * Items whose allowed colours miss the palette are left out when possible.
 */
function makeRound(items = ITEMS, count = CONFIG.COUNT, paletteSize = COLORS.length) {
  const palette = shuffle(COLORS).slice(0, Math.max(2, Math.min(COLORS.length, paletteSize)));
  const fits = items.filter((it) => it.colors.some((c) => palette.includes(c)));
  const pool = fits.length >= Math.min(count, items.length) ? fits : items;
  const n = Math.min(count, pool.length);
  const lineup = shuffle(pool)
    .slice(0, n)
    .map((it) => {
      const allowed = it.colors.filter((c) => palette.includes(c));
      return { id: it.id, name: it.name, src: it.src, fallback: it.fallback, color: pick(allowed.length ? allowed : palette) };
    });
  // keep the palette in the canonical order (blue, red, green, yellow) for the buttons
  // dev: MEMORY_MODE=color|order always deals that task (to check one screen)
  const mode = MODES.includes(process.env.MEMORY_MODE) ? process.env.MEMORY_MODE : pick(MODES);
  return { lineup, mode, palette: COLORS.filter((c) => palette.includes(c)) };
}

// ---------------------------------------------------------------- contest

function buildContest({ players, correctIndex, roundIndex, difficulty }) {
  if (ITEMS.length < 2) return null;
  const failers = players.filter((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex));
  if (failers.length < MIN_PLAYERS) return null;
  return {
    minigameId: ID,
    mode: "all_lowest_loses",
    roundIndex,
    difficulty, // the game's difficulty sets the level (levelFor)
    contestantIds: failers.map((p) => p.id),
  };
}

function onStart(mg) {
  const level = levelFor(mg.roundIndex, mg.difficulty);
  const round = makeRound(ITEMS, CONFIG.COUNT, level.colors);
  mg.mem = {
    ...round,
    level: { id: level.id, name: level.name, colors: level.colors },
    order: round.lineup.map((it) => it.id), // the right answer for "order"
    colors: round.lineup.map((it) => it.color), // the right answer for "color"
    showAt: 0,
    answerAt: 0,
    endAt: 0,
    answers: {}, // playerId -> { order: [id|null] } | { colors: [color|null] }
    locked: {}, // playerId -> true once confirmed
    outcome: null,
  };
}

const card = (it, withColor) => ({ id: it.id, name: it.name, src: it.src, fallback: it.fallback, ...(withColor ? { color: it.color } : {}) });

/** The task the phones get when the answer phase starts. */
function taskPayload(mg) {
  const s = mg.mem;
  return {
    mode: s.mode,
    count: s.lineup.length,
    // order: the items shuffled (colours visible as context); color: in order, no colours
    items: s.mode === "order" ? shuffle(s.lineup).map((it) => card(it, true)) : s.lineup.map((it) => card(it, false)),
    colors: s.palette, // only this round's colours
    answerAt: s.answerAt,
    endAt: s.endAt,
  };
}
const goPayload = (mg, now) => ({
  showAt: mg.mem.showAt,
  answerAt: mg.mem.answerAt,
  endAt: mg.mem.endAt,
  serverNow: now,
  count: mg.mem.lineup.length,
  level: mg.mem.level,
  palette: mg.mem.palette, // the colours in play (not which item has which)
});
const progressPayload = (mg) => ({ done: Object.keys(mg.mem.locked).length, total: mg.contestantIds.length });

function onSync(mg, nowTs, ctx) {
  const s = mg.mem;
  s.showAt = nowTs + CONFIG.PREP_MS;
  s.answerAt = s.showAt + CONFIG.SHOW_MS;
  s.endAt = s.answerAt + CONFIG.ANSWER_MS;
  ctx.emitAll("mem:go", goPayload(mg, nowTs));
  ctx.setTimer(() => {
    // the coloured row: the TV only
    ctx.emitDisplay?.("mem:show", { lineup: s.lineup.map((it) => card(it, true)), answerAt: s.answerAt, serverNow: ctx.now() });
    ctx.setTimer(() => {
      ctx.emitAll("mem:task", { ...taskPayload(mg), serverNow: ctx.now() });
      ctx.emitAll("mem:progress", progressPayload(mg));
      ctx.scheduleResolve(s.endAt - ctx.now() + CONFIG.CLOSE_GRACE_MS);
    }, s.answerAt - ctx.now());
  }, s.showAt - nowTs);
}

const answering = (mg, now) => !mg.mem.outcome && mg.mem.answerAt > 0 && now >= mg.mem.answerAt && now < mg.mem.endAt;

/** Keep only a well-formed answer for this round; anything else -> null. */
function sanitize(mg, data) {
  const s = mg.mem;
  const n = s.lineup.length;
  if (s.mode === "order") {
    const order = Array.isArray(data?.order) ? data.order : null;
    if (!order || order.length !== n) return null;
    const ids = new Set(s.order);
    const used = new Set();
    const clean = order.map((id) => (typeof id === "string" && ids.has(id) && !used.has(id) && used.add(id) ? id : null));
    return { order: clean };
  }
  const colors = Array.isArray(data?.colors) ? data.colors : null;
  if (!colors || colors.length !== n) return null;
  return { colors: colors.map((c) => (s.palette.includes(c) ? c : null)) };
}

function onClientEvent(mg, playerId, name, data, ctx) {
  const s = mg.mem;
  if (!s) return;
  const now = ctx.now();

  if (name === "mem:hello") {
    // a phone (re)opened the page: the clock, the task (if it started), its lock
    if (s.showAt) ctx.emitPlayer(playerId, "mem:go", goPayload(mg, now));
    if (now >= s.answerAt && s.answerAt) ctx.emitPlayer(playerId, "mem:task", { ...taskPayload(mg), serverNow: now });
    if (s.locked[playerId]) ctx.emitPlayer(playerId, "mem:ack", { locked: true });
    return;
  }
  if (name !== "mem:answer") return;
  if (s.locked[playerId] || !answering(mg, now)) return;
  const answer = sanitize(mg, data);
  if (!answer) return;
  s.answers[playerId] = answer;
  if (data?.final) {
    s.locked[playerId] = true;
    ctx.emitPlayer(playerId, "mem:ack", { locked: true });
    ctx.emitAll("mem:progress", progressPayload(mg));
    if (mg.contestantIds.every((id) => s.locked[id])) ctx.resolveNow(); // everybody is done
  }
}

// ---------------------------------------------------------------- scoring

/** Points for one answer against the round (pure). */
function scoreAnswer(round, answer) {
  if (!answer) return 0;
  if (round.mode === "order") {
    const order = round.lineup.map((it) => it.id);
    return (answer.order || []).reduce((n, id, i) => n + (id && id === order[i] ? 1 : 0), 0);
  }
  return (answer.colors || []).reduce((n, c, i) => n + (c && c === round.lineup[i].color ? 1 : 0), 0);
}

/** Close the answers and freeze the scores (idempotent). */
function outcomeOf(mg) {
  const s = mg.mem;
  if (s.outcome) return s.outcome;
  const scores = {};
  for (const id of mg.contestantIds) scores[id] = scoreAnswer(s, s.answers[id]);
  const values = mg.contestantIds.map((id) => scores[id]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const allEqual = min === max;
  const best = mg.contestantIds.filter((id) => scores[id] === max);
  s.outcome = {
    scores,
    loserIds: allEqual ? [] : mg.contestantIds.filter((id) => scores[id] === min),
    winnerId: !allEqual && max > 0 && best.length === 1 ? best[0] : null,
    topIds: allEqual ? [] : best,
  };
  return s.outcome;
}

function resolveLosers(mg) {
  return [...outcomeOf(mg).loserIds];
}

function resolveWinner(mg) {
  return outcomeOf(mg).winnerId;
}

function buildResults(mg) {
  const s = mg.mem;
  const o = outcomeOf(mg);
  const ranked = [...mg.contestantIds].sort((a, b) => o.scores[b] - o.scores[a]);
  return {
    minigameScores: { ...o.scores },
    memory: {
      mode: s.mode,
      level: s.level,
      palette: [...s.palette],
      max: s.lineup.length,
      lineup: s.lineup.map((it) => card(it, true)),
      answers: Object.fromEntries(mg.contestantIds.map((id) => [id, s.answers[id] || null])),
      scores: { ...o.scores },
      ranked,
      topIds: [...o.topIds],
    },
  };
}

module.exports = {
  ID,
  CONFIG,
  COLORS,
  MODES,
  LEVELS,
  levelFor,
  TOTAL_DURATION_MS,
  loadItems,
  makeRound,
  scoreAnswer,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  resolveLosers,
  resolveWinner,
  buildResults,
  _setItems: (items) => {
    ITEMS = items;
  },
  get items() {
    return ITEMS;
  },
};
