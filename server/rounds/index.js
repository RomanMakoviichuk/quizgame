/**
 * 10 раундів: для кожного раунду питання тільки з відповідного файлу і тільки обраної складності.
 * - Раунд 1 → тільки round1.json, раунд 2 → round2.json, …, раунд 10 → round10.json.
 * - Обрано «Легкий» (easy) → тільки питання з difficulty: "easy" з масиву цього раунду.
 * - Випадковий вибір через crypto для максимальної рандомізації (щоб не випадав завжди один і той самий номер).
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const QUESTIONS_DIR = path.join(__dirname, "..", "..", "client", "public", "assets", "questions");
const TOTAL_ROUNDS = 10;

/** Питання тільки з файлу roundN.json для раунду N (round1.json → раунд 1, round2.json → раунд 2, …). */
function loadRoundQuestions(roundIndex) {
  const filePath = path.join(QUESTIONS_DIR, `round${roundIndex}.json`);
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const arr = JSON.parse(data);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

const VALID_DIFFICULTIES = ["easy", "medium", "hard"];

function normalizeDifficulty(d) {
  if (d == null) return "easy";
  const s = String(d).trim().toLowerCase();
  return VALID_DIFFICULTIES.includes(s) ? s : "easy";
}

// Deck (bag) of questions to avoid repeating the same question across games.
// Key: `${roundIndex}-${difficulty}`
const questionDecks = new Map();

function shuffleWithCrypto(arr) {
  // Fisher-Yates shuffle with crypto-based randomInt
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function getQuestionDeck(roundIndex, difficulty) {
  const key = `${roundIndex}-${difficulty}`;
  let deck = questionDecks.get(key);
  if (!deck || deck.length === 0) {
    const allQuestions = loadRoundQuestions(roundIndex);
    const filtered = allQuestions.filter(
      (q) => normalizeDifficulty(q.difficulty) === difficulty
    );
    deck = shuffleWithCrypto(filtered);
    questionDecks.set(key, deck);
  }
  return deck;
}

function pickFromDeck(roundIndex, difficulty) {
  if (!difficulty) difficulty = "easy";
  const deck = getQuestionDeck(roundIndex, difficulty);
  const q = deck.pop() || null;
  questionDecks.set(`${roundIndex}-${difficulty}`, deck);
  return q;
}

function getRounds(selectedDifficulty = "") {
  const difficulty = normalizeDifficulty(selectedDifficulty);
  const rounds = [];
  for (let i = 1; i <= TOTAL_ROUNDS; i++) {
    // Smart random: take next question from the shuffled deck
    // to avoid showing the same question in consecutive games.
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
