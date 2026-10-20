/**
 * Game-side question selection. Runs in its own process (node --test isolates
 * files), so pointing CONTENT_FILE at a temp file here is safe.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const TMP = path.join(
  os.tmpdir(),
  `quizgame-game-${crypto.randomBytes(6).toString("hex")}.json`
);
process.env.CONTENT_FILE = TMP;

const test = require("node:test");
const assert = require("node:assert/strict");

const store = require("./store");
const { getRounds, pickRounds, categoryReadiness, NOT_ENOUGH_MESSAGE } = require("../questions");
const { TOTAL_ROUNDS } = require("../config");

test.after(() => { try { fs.unlinkSync(TMP); } catch {} });

function seed({ geoCount = 12, otherCount = 12, geoActive = true } = {}) {
  const mkQ = (categoryId, n, prefix) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        id: `q_${prefix}_${i}`,
        categoryId,
        type: "single",
        text: `${prefix} питання ${i}?`,
        difficulty: null,
        isActive: true,
        order: i,
        answers: [
          { id: `a_${prefix}_${i}_0`, text: `${prefix}-A${i}`, isCorrect: false },
          { id: `a_${prefix}_${i}_1`, text: `${prefix}-B${i}`, isCorrect: true },
          { id: `a_${prefix}_${i}_2`, text: `${prefix}-C${i}`, isCorrect: false },
          { id: `a_${prefix}_${i}_3`, text: `${prefix}-D${i}`, isCorrect: false },
        ],
        explanation: null, mediaUrl: null, tags: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }
    return out;
  };
  store._reset({
    version: 1,
    categories: [
      { id: "cat_geo", name: "Географія", slug: "geo", description: null, icon: "🌍", isActive: geoActive, createdAt: "x", updatedAt: "x" },
      { id: "cat_math", name: "Математика", slug: "math", description: null, icon: "🧮", isActive: true, createdAt: "x", updatedAt: "x" },
    ],
    questions: [
      ...mkQ("cat_geo", geoCount, "geo"),
      ...mkQ("cat_math", otherCount, "math"),
    ],
  });
}

// --------------------------------------------------------------- pickRounds

test("pickRounds: exactly TOTAL_ROUNDS unique questions, no repeats", () => {
  const qs = Array.from({ length: 30 }, (_, i) => ({
    id: `q${i}`,
    text: `q${i}`,
    answers: [
      { id: `${i}a`, text: "a", isCorrect: false },
      { id: `${i}b`, text: "b", isCorrect: true },
      { id: `${i}c`, text: "c", isCorrect: false },
      { id: `${i}d`, text: "d", isCorrect: false },
    ],
  }));
  const { rounds } = pickRounds(qs, TOTAL_ROUNDS);
  assert.equal(rounds.length, TOTAL_ROUNDS);
  const ids = rounds.map((r) => r.question.id);
  assert.equal(new Set(ids).size, TOTAL_ROUNDS, "all questions unique");
});

test("pickRounds: not enough questions -> clear error, no rounds", () => {
  const few = Array.from({ length: 5 }, (_, i) => ({
    id: `q${i}`, text: `q${i}`,
    answers: [
      { id: "a", text: "a", isCorrect: true },
      { id: "b", text: "b", isCorrect: false },
      { id: "c", text: "c", isCorrect: false },
      { id: "d", text: "d", isCorrect: false },
    ],
  }));
  const res = pickRounds(few, TOTAL_ROUNDS);
  assert.equal(res.error, NOT_ENOUGH_MESSAGE);
  assert.equal(res.available, 5);
  assert.equal(res.rounds, undefined);
});

test("pickRounds: answers are shuffled but correctIndex stays truthful", () => {
  const q = {
    id: "q1",
    text: "Яка столиця України?",
    answers: [
      { id: "a1", text: "Київ", isCorrect: true },
      { id: "a2", text: "Львів", isCorrect: false },
      { id: "a3", text: "Одеса", isCorrect: false },
      { id: "a4", text: "Харків", isCorrect: false },
    ],
  };
  const positions = new Set();
  for (let i = 0; i < 200; i++) {
    const { rounds } = pickRounds([q, q, q, q, q, q, q, q, q], 9);
    for (const r of rounds) {
      assert.equal(r.question.options.length, 4);
      assert.equal(r.question.options[r.question.correctIndex], "Київ");
      positions.add(r.question.correctIndex);
    }
  }
  assert.ok(positions.size > 1, "correct answer is not pinned to one slot");
});

// ----------------------------------------------------------------- getRounds

test("getRounds: builds 9 rounds from the chosen category only", () => {
  seed({ geoCount: 20, otherCount: 20 });
  const { rounds, error } = getRounds("cat_geo");
  assert.equal(error, undefined);
  assert.equal(rounds.length, 9);
  for (const r of rounds) {
    assert.match(r.question.id, /^q_geo_/, "only geo questions");
    for (const opt of r.question.options) assert.match(opt, /^geo-/);
  }
});

test("getRounds: questions from other categories never leak in", () => {
  seed({ geoCount: 30, otherCount: 30 });
  for (let i = 0; i < 25; i++) {
    const { rounds } = getRounds("cat_geo");
    assert.ok(rounds.every((r) => r.question.id.startsWith("q_geo_")));
  }
});

test("getRounds: too few active questions -> error message", () => {
  seed({ geoCount: 4 });
  const res = getRounds("cat_geo");
  assert.equal(res.error, NOT_ENOUGH_MESSAGE);
});

test("getRounds: inactive category is refused", () => {
  seed({ geoCount: 20, geoActive: false });
  const res = getRounds("cat_geo");
  assert.ok(res.error);
});

test("getRounds: inactive questions are excluded from selection", () => {
  seed({ geoCount: 12 });
  const raw = store._raw();
  // deactivate 5 of the 12 geo questions -> only 7 playable -> not enough
  raw.questions.filter((q) => q.categoryId === "cat_geo").slice(0, 5).forEach((q) => { q.isActive = false; });
  const res = getRounds("cat_geo");
  assert.equal(res.error, NOT_ENOUGH_MESSAGE);
  assert.equal(res.available, 7);
});

test("categoryReadiness reports availability vs. the 9-question minimum", () => {
  seed({ geoCount: 9, otherCount: 3 });
  assert.deepEqual(categoryReadiness("cat_geo"), { available: 9, needed: 9, ok: true });
  assert.deepEqual(categoryReadiness("cat_math"), { available: 3, needed: 9, ok: false });
});

// ------------------------------------------------------------ difficulty

const { pickRoundsByDifficulty, roundPlan, normalizeGameDifficulty } = require("../questions");

const mkQ = (n, difficulty) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${difficulty || "none"}${i}`,
    text: `${difficulty} ${i}?`,
    difficulty,
    answers: [
      { text: "a", isCorrect: true },
      { text: "b", isCorrect: false },
      { text: "c", isCorrect: false },
      { text: "d", isCorrect: false },
    ],
  }));
const levelOf = (rounds) => rounds.map((r) => r.question.id.replace(/\d+$/, ""));

test("difficulty: easy / medium / hard draw only that level when there are enough", () => {
  const qs = [...mkQ(12, "easy"), ...mkQ(12, "medium"), ...mkQ(12, "hard")];
  for (const d of ["easy", "medium", "hard"]) {
    const { rounds } = pickRoundsByDifficulty(qs, d, TOTAL_ROUNDS);
    assert.deepEqual(levelOf(rounds), Array(TOTAL_ROUNDS).fill(d));
    assert.equal(new Set(rounds.map((r) => r.question.id)).size, TOTAL_ROUNDS, "no repeats");
  }
});

test("difficulty: mixed climbs easy -> medium -> hard", () => {
  assert.deepEqual(roundPlan("mixed", 9), ["easy", "easy", "easy", "medium", "medium", "medium", "hard", "hard", "hard"]);
  const qs = [...mkQ(5, "easy"), ...mkQ(5, "medium"), ...mkQ(5, "hard")];
  const { rounds } = pickRoundsByDifficulty(qs, "mixed", 9);
  assert.deepEqual(levelOf(rounds), ["easy", "easy", "easy", "medium", "medium", "medium", "hard", "hard", "hard"]);
});

test("difficulty: a short level is filled from the nearest one; no level -> medium", () => {
  const qs = [...mkQ(3, "hard"), ...mkQ(4, "medium"), ...mkQ(6, "easy")];
  const { rounds } = pickRoundsByDifficulty(qs, "hard", 9);
  assert.deepEqual(levelOf(rounds), ["hard", "hard", "hard", "medium", "medium", "medium", "medium", "easy", "easy"]);
  const none = mkQ(9, null);
  assert.equal(pickRoundsByDifficulty(none, "medium", 9).rounds.length, 9);
  assert.ok(pickRoundsByDifficulty(mkQ(8, "easy"), "easy", 9).error, "too few questions overall");
});

test("difficulty: unknown values fall back to mixed", () => {
  assert.equal(normalizeGameDifficulty("HARD"), "hard");
  assert.equal(normalizeGameDifficulty("nightmare"), "mixed");
  assert.equal(normalizeGameDifficulty(undefined), "mixed");
});

test("pickRoundsByDifficulty takes questions played before only when nothing else is left", () => {
  const qs = Array.from({ length: 12 }, (_, i) => ({
    id: `q${i}`,
    text: `Q${i}`,
    difficulty: "easy",
    answers: [{ text: "a", isCorrect: true }, { text: "b" }, { text: "c" }, { text: "d" }],
  }));
  const played = new Set(qs.slice(0, 3).map((q) => q.id));
  const { rounds } = pickRoundsByDifficulty(qs, "easy", 9, played);
  assert.ok(rounds.every((r) => !played.has(r.question.id)));
});
