/**
 * Question source for a game.
 *
 * A game is played from ONE category and ONE difficulty (chosen by the host).
 * We pull all active questions in that category, pick TOTAL_ROUNDS unique ones
 * at random — preferring the chosen difficulty, see pickRoundsByDifficulty —
 * and shuffle each question's answers so the correct one is never fixed in slot A.
 *
 * The correct answer is tracked by index AFTER the shuffle and stays
 * server-side — clients receive `options` + `correctIndex` is only used by
 * phases.js to score `answer` events (and only echoed back to a player once
 * they have answered).
 */
const store = require("./content/store");
const { cryptoShuffle } = require("./content/util");
const usage = require("./content/usage");
const { TOTAL_ROUNDS, MIN_QUESTIONS_PER_GAME, FINAL, GAME_DIFFICULTIES, DEFAULT_GAME_DIFFICULTY } = require("./config");

const NOT_ENOUGH_MESSAGE = "У цій категорії недостатньо питань для гри.";

/**
 * Turn a stored question into the wire shape for a round.
 * Answers are crypto-shuffled; correctIndex points at the correct one's new slot.
 */
function toRoundQuestion(q) {
  const shuffled = cryptoShuffle(q.answers);
  const correctIndex = shuffled.findIndex((a) => a.isCorrect);
  return {
    id: q.id,
    text: q.text,
    options: shuffled.map((a) => a.text),
    correctIndex: correctIndex === -1 ? 0 : correctIndex,
    audioSrc: null,
  };
}

/**
 * Pure helper (unit-tested): pick `count` unique questions at random and build
 * their rounds. Throws nothing — returns { rounds } or { error }.
 */
function pickRounds(questions, count) {
  if (!Array.isArray(questions) || questions.length < count) {
    return { error: NOT_ENOUGH_MESSAGE, available: questions ? questions.length : 0 };
  }
  const chosen = cryptoShuffle(questions).slice(0, count);
  const rounds = chosen.map((q, i) => ({
    roundIndex: i + 1,
    question: toRoundQuestion(q),
    audioSrc: null,
  }));
  return { rounds };
}

// Which question difficulties to draw from, best first: when the category runs
// short of one, the nearest one fills in, so any playable category can be
// played on any difficulty. Questions without a difficulty count as medium.
const PREFERENCE = {
  easy: ["easy", "medium", "hard"],
  medium: ["medium", "easy", "hard"],
  hard: ["hard", "medium", "easy"],
};

function normalizeGameDifficulty(value) {
  const v = String(value || "").toLowerCase();
  return GAME_DIFFICULTIES.includes(v) ? v : DEFAULT_GAME_DIFFICULTY;
}

/** The wanted difficulty of each round. "mixed": a third easy, a third medium, a third hard. */
function roundPlan(difficulty, count) {
  if (difficulty !== "mixed") return Array.from({ length: count }, () => difficulty);
  return Array.from({ length: count }, (_, i) => ["easy", "medium", "hard"][Math.min(2, Math.floor((i * 3) / count))]);
}

const levelOf = (q) => (PREFERENCE[q.difficulty] ? q.difficulty : "medium");

/** Question text as people read it: case, spaces and the final punctuation do not matter. */
const textKey = (q) =>
  String(q.text || "")
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[\s?!.…:]+$/u, "")
    .trim();

/**
 * Pure helper (unit-tested): one question per text. A question imported twice
 * (two ids, the same words) would otherwise come up twice — even back to back.
 * The first one (by admin order) stays.
 */
function uniqueByText(questions) {
  const seen = new Set();
  const out = [];
  for (const q of [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const k = textKey(q);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

// no repeats between games (content/usage.js): one log per category — every
// question of it (main rounds and the final) is played once before any comes back
const usageKind = (categoryId) => `quiz:${categoryId}`;
const LEVELS = ["easy", "medium", "hard"];

/** Ids of the category's questions already played in the current cycle. */
function playedSet(categoryId, questions = uniqueByText(store.getPlayableQuestions(categoryId))) {
  const kind = usageKind(categoryId);
  if (!usage.has(kind)) {
    // the older logs were kept per difficulty: they open the category's cycle once
    const before = LEVELS.flatMap((l) => [...usage.usedSet(`quiz:${categoryId}:${l}`)]);
    const all = questions.map((q) => q.id);
    const known = new Set(all);
    const ids = [...new Set(before)].filter((id) => known.has(id));
    if (ids.length && ids.length < all.length) usage.mark(kind, ids, all);
  }
  return usage.usedSet(kind);
}

/** Log these questions as played (main rounds and every final-battle question). */
function markPlayed(categoryId, ids, questions = uniqueByText(store.getPlayableQuestions(categoryId))) {
  const kind = usageKind(categoryId);
  const all = questions.map((q) => q.id);
  const known = new Set(all);
  const used = usage.usedSet(kind);
  const mine = ids.filter((id) => known.has(id));
  const fresh = mine.filter((id) => !used.has(id));
  const again = mine.filter((id) => used.has(id));
  // the last new ones close the cycle; a repeat then counts for the next one
  if (fresh.length) usage.mark(kind, fresh, all);
  if (again.length) usage.mark(kind, again, all);
}

/**
 * Pure helper (unit-tested): like pickRounds, but every round takes a random
 * unused question of its wanted difficulty, falling back to the nearest one.
 * `playedIds`: questions played in earlier games — taken only when a pool has
 * nothing else left.
 */
function pickRoundsByDifficulty(questions, difficulty, count, playedIds = new Set()) {
  if (!Array.isArray(questions) || questions.length < count) {
    return { error: NOT_ENOUGH_MESSAGE, available: questions ? questions.length : 0 };
  }
  // per difficulty: the questions not played yet in this cycle, and the played ones
  const fresh = { easy: [], medium: [], hard: [] };
  const old = { easy: [], medium: [], hard: [] };
  for (const q of cryptoShuffle(questions)) (playedIds.has(q.id) ? old : fresh)[levelOf(q)].push(q);
  // a new question of the nearest difficulty beats a repeat of the wanted one:
  // nothing comes back before the whole category has been played
  const chosen = roundPlan(normalizeGameDifficulty(difficulty), count).map((want) => {
    const pref = PREFERENCE[want];
    const from = pref.find((d) => fresh[d].length > 0);
    return from ? fresh[from].pop() : old[pref.find((d) => old[d].length > 0)].pop();
  });
  const rounds = chosen.map((q, i) => ({
    roundIndex: i + 1,
    question: toRoundQuestion(q),
    audioSrc: null,
  }));
  return { rounds };
}

/** How many active questions a category currently has (host-facing check). */
function categoryReadiness(categoryId) {
  const questions = uniqueByText(store.getPlayableQuestions(categoryId));
  return {
    available: questions.length,
    needed: MIN_QUESTIONS_PER_GAME,
    ok: questions.length >= MIN_QUESTIONS_PER_GAME,
  };
}

/**
 * Build the full round script for a game in the given category and difficulty.
 * Returns { rounds } (length TOTAL_ROUNDS) or { error }.
 */
function getRounds(categoryId, difficulty = DEFAULT_GAME_DIFFICULTY) {
  const category = store.getCategory(categoryId);
  if (!category || !category.isActive) {
    return { error: "Категорія недоступна для гри." };
  }
  const questions = uniqueByText(store.getPlayableQuestions(categoryId));
  const result = pickRoundsByDifficulty(questions, difficulty, TOTAL_ROUNDS, playedSet(categoryId, questions));
  if (result.rounds) markPlayed(categoryId, result.rounds.map((r) => r.question.id), questions);
  return result;
}

/**
 * Pure helper (unit-tested): the final race deck. First the questions nobody has
 * seen lately (not in this game's rounds, not in earlier games of the current
 * cycle — short ones first, for a quick read on the TV), then the ones from
 * earlier games, then this game's rounds; when the category runs dry the deck
 * cycles. Stays inside the chosen category on purpose.
 */
function pickFinalDeck(questions, usedIds = [], size = FINAL.DECK_SIZE, playedBefore = new Set()) {
  if (!Array.isArray(questions) || questions.length === 0) return [];
  const used = new Set(usedIds);
  const short = (q) => (q.text || "").length <= FINAL.SHORT_QUESTION_CHARS;
  const fresh = cryptoShuffle(questions.filter((q) => !used.has(q.id) && !playedBefore.has(q.id)));
  const ordered = [
    ...fresh.filter(short),
    ...fresh.filter((q) => !short(q)),
    ...cryptoShuffle(questions.filter((q) => !used.has(q.id) && playedBefore.has(q.id))),
    ...cryptoShuffle(questions.filter((q) => used.has(q.id))),
  ];
  const deck = [];
  for (let i = 0; deck.length < size; i++) {
    deck.push(toRoundQuestion(ordered[i % ordered.length]));
  }
  return deck;
}

function getFinalDeck(categoryId, usedIds) {
  const questions = uniqueByText(store.getPlayableQuestions(categoryId));
  return pickFinalDeck(questions, usedIds, FINAL.DECK_SIZE, playedSet(categoryId, questions));
}

module.exports = {
  getRounds,
  uniqueByText,
  markPlayed,
  pickFinalDeck,
  getFinalDeck,
  pickRounds,
  pickRoundsByDifficulty,
  roundPlan,
  normalizeGameDifficulty,
  toRoundQuestion,
  categoryReadiness,
  NOT_ENOUGH_MESSAGE,
};
