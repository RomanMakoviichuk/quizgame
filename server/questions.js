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
  const level = levelOf;
  const pools = { easy: [], medium: [], hard: [] };
  // pop() takes from the end: played ones first in the array, new ones last
  const shuffled = cryptoShuffle(questions);
  for (const q of [...shuffled.filter((x) => playedIds.has(x.id)), ...shuffled.filter((x) => !playedIds.has(x.id))])
    pools[level(q)].push(q);
  const chosen = roundPlan(normalizeGameDifficulty(difficulty), count).map((want) => {
    const from = PREFERENCE[want].find((d) => pools[d].length > 0);
    return pools[from].pop();
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
  const questions = store.getPlayableQuestions(categoryId);
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
  const questions = store.getPlayableQuestions(categoryId);
  // no repeats between games (content/usage.js): one log per category + difficulty,
  // each starts over once all its questions have been played
  const kind = (level) => `quiz:${categoryId}:${level}`;
  const played = new Set(["easy", "medium", "hard"].flatMap((l) => [...usage.usedSet(kind(l))]));
  const result = pickRoundsByDifficulty(questions, difficulty, TOTAL_ROUNDS, played);
  if (result.rounds) {
    const byId = new Map(questions.map((q) => [q.id, q]));
    for (const l of ["easy", "medium", "hard"]) {
      const ids = result.rounds.map((r) => r.question.id).filter((id) => levelOf(byId.get(id) || {}) === l);
      if (ids.length) usage.mark(kind(l), ids, questions.filter((q) => levelOf(q) === l).map((q) => q.id));
    }
  }
  return result;
}

/**
 * Pure helper (unit-tested): the final race deck. Questions not played in the
 * main rounds come first (short ones first, for a quick read on the TV); when
 * the category runs dry the already-played ones follow, then the deck cycles.
 * Stays inside the chosen category on purpose.
 */
function pickFinalDeck(questions, usedIds = [], size = FINAL.DECK_SIZE) {
  if (!Array.isArray(questions) || questions.length === 0) return [];
  const used = new Set(usedIds);
  const short = (q) => (q.text || "").length <= FINAL.SHORT_QUESTION_CHARS;
  const fresh = cryptoShuffle(questions.filter((q) => !used.has(q.id)));
  const ordered = [
    ...fresh.filter(short),
    ...fresh.filter((q) => !short(q)),
    ...cryptoShuffle(questions.filter((q) => used.has(q.id))),
  ];
  const deck = [];
  for (let i = 0; deck.length < size; i++) {
    deck.push(toRoundQuestion(ordered[i % ordered.length]));
  }
  return deck;
}

function getFinalDeck(categoryId, usedIds) {
  return pickFinalDeck(store.getPlayableQuestions(categoryId), usedIds);
}

module.exports = {
  getRounds,
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
