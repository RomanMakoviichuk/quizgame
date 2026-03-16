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

/** Повертає один випадковий елемент з масиву (crypto для сильного рандому, без упереджень). */
function pickRandom(questions) {
  if (!questions.length) return null;
  if (questions.length === 1) return questions[0];
  const idx = crypto.randomInt(0, questions.length);
  return questions[idx];
}

function getRounds(selectedDifficulty = "") {
  const difficulty = normalizeDifficulty(selectedDifficulty);
  const rounds = [];
  for (let i = 1; i <= TOTAL_ROUNDS; i++) {
    const roundQuestions = loadRoundQuestions(i);
    const filtered = roundQuestions.filter(
      (q) => normalizeDifficulty(q.difficulty) === difficulty
    );
    const q = pickRandom(filtered);
    rounds.push({
      roundIndex: i,
      question: q
        ? {
            id: q.id,
            text: q.text,
            options: q.options || [],
            correctIndex: q.correctIndex ?? 0,
          }
        : null,
      audioSrc:
        q && q.audioFile
          ? `/assets/questions/audio/round${i}/${q.audioFile}`
          : null,
    });
  }
  return rounds;
}

module.exports = { getRounds, loadRoundQuestions, normalizeDifficulty };
