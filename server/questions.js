/**
 * Question source for the 10 rounds.
 *
 * - Round N draws only from client/public/assets/questions/roundN.json.
 * - Only questions matching the room's chosen difficulty are used.
 * - A per-(round,difficulty) shuffled "deck" is kept in memory so the same
 *   question does not reappear in back-to-back games until the deck is exhausted.
 *   (Cleared on server restart.)
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const {
  QUESTIONS_DIR,
  TOTAL_ROUNDS,
  VALID_DIFFICULTIES,
  DEFAULT_DIFFICULTY,
} = require("./config");

function normalizeDifficulty(d) {
  if (d == null) return DEFAULT_DIFFICULTY;
  const s = String(d).trim().toLowerCase();
  return VALID_DIFFICULTIES.includes(s) ? s : DEFAULT_DIFFICULTY;
}

/** Raw array from roundN.json (round 1 -> round1.json). Empty array on any error. */
function loadRoundQuestions(roundIndex) {
  const filePath = path.join(QUESTIONS_DIR, `round${roundIndex}.json`);
  try {
    const arr = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Key: `${roundIndex}-${difficulty}` -> remaining shuffled questions
const questionDecks = new Map();

function shuffleWithCrypto(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getQuestionDeck(roundIndex, difficulty) {
  const key = `${roundIndex}-${difficulty}`;
  let deck = questionDecks.get(key);
  if (!deck || deck.length === 0) {
    const filtered = loadRoundQuestions(roundIndex).filter(
      (q) => normalizeDifficulty(q.difficulty) === difficulty
    );
    deck = shuffleWithCrypto(filtered);
    questionDecks.set(key, deck);
  }
  return deck;
}

function pickFromDeck(roundIndex, difficulty) {
  const deck = getQuestionDeck(roundIndex, difficulty);
  const q = deck.pop() || null;
  questionDecks.set(`${roundIndex}-${difficulty}`, deck);
  return q;
}

/**
 * Build the full 10-round script for a game at the given difficulty.
 * Each entry: { roundIndex, question | null, audioSrc | null }.
 */
function getRounds(selectedDifficulty) {
  const difficulty = normalizeDifficulty(selectedDifficulty);
  const rounds = [];
  for (let i = 1; i <= TOTAL_ROUNDS; i++) {
    const q = pickFromDeck(i, difficulty);
    const audioSrc =
      q && q.audioFile
        ? `/assets/questions/audio/round${i}/${q.audioFile}`
        : null;
    rounds.push({
      roundIndex: i,
      question: q
        ? {
            id: q.id,
            text: q.text,
            options: q.options || [],
            correctIndex: q.correctIndex ?? 0,
            audioSrc,
          }
        : null,
      audioSrc,
    });
  }
  return rounds;
}

module.exports = { getRounds, loadRoundQuestions, normalizeDifficulty };
