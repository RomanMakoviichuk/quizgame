/**
 * First-run seed for the question database.
 *
 * Builds an initial content.json from the legacy per-round decks
 * (client/public/assets/questions/round1.json … round9.json) so the game is
 * playable the moment the server starts. Everything lands in one active
 * category, "Загальні знання"; a few empty example categories are added
 * (inactive) as a starting point for the admin.
 *
 * After this runs once, the file is owned by the admin panel — the seed is
 * never applied again.
 */
const fs = require("fs");
const path = require("path");
const { QUESTIONS_DIR, TOTAL_ROUNDS, QUESTION_DIFFICULTIES } = require("../config");
const { newId, nowIso, makeSlug, normalizeDifficulty } = require("./util");

function loadLegacyRound(roundIndex) {
  const file = path.join(QUESTIONS_DIR, `round${roundIndex}.json`);
  try {
    const arr = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function legacyToQuestion(raw, categoryId, order) {
  const options = Array.isArray(raw.options) ? raw.options.slice(0, 4) : [];
  while (options.length < 4) options.push("");
  const correctIndex =
    Number.isInteger(raw.correctIndex) && raw.correctIndex >= 0 && raw.correctIndex < 4
      ? raw.correctIndex
      : 0;
  const ts = nowIso();
  return {
    id: newId("q"),
    categoryId,
    type: "single",
    text: String(raw.text || "").trim(),
    difficulty: normalizeDifficulty(raw.difficulty),
    isActive: true,
    order,
    answers: options.map((text, i) => ({
      id: newId("a"),
      text: String(text).trim(),
      isCorrect: i === correctIndex,
    })),
    explanation: null,
    mediaUrl: null,
    tags: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

const EXAMPLE_CATEGORIES = [
  { name: "Захист України", icon: "🇺🇦", description: "Питання про ЗСУ, військову техніку, історію українського війська та оборону України." },
  { name: "Математика", icon: "🧮", description: "Арифметика, геометрія, логічні задачі." },
  { name: "Географія", icon: "🌍", description: "Країни, столиці, річки, гори, кордони." },
  { name: "Відомі люди", icon: "👤", description: "Історичні постаті, науковці, митці, спортсмени." },
  { name: "Історія", icon: "📚", description: "Світова та українська історія." },
  { name: "Наука", icon: "🔬", description: "Фізика, хімія, біологія, астрономія." },
];

function buildSeed() {
  const ts = nowIso();

  const general = {
    id: newId("cat"),
    name: "Загальні знання",
    slug: "zahalni-znannia",
    description: "Різнопланові питання з усіх тем. Стартовий набір.",
    icon: "🎯",
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  };

  const categories = [general];
  const usedSlugs = new Set([general.slug]);
  for (const ex of EXAMPLE_CATEGORIES) {
    let slug = makeSlug(ex.name);
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${makeSlug(ex.name)}-${n++}`;
    usedSlugs.add(slug);
    categories.push({
      id: newId("cat"),
      name: ex.name,
      slug,
      description: ex.description,
      icon: ex.icon,
      isActive: false,
      createdAt: ts,
      updatedAt: ts,
    });
  }

  const questions = [];
  const seenText = new Set();
  let order = 0;
  for (let r = 1; r <= TOTAL_ROUNDS; r++) {
    for (const raw of loadLegacyRound(r)) {
      const q = legacyToQuestion(raw, general.id, order);
      if (!q.text || q.answers.some((a) => !a.text)) continue;
      const key = q.text.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      questions.push(q);
      order++;
    }
  }

  return { version: 1, categories, questions };
}

module.exports = { buildSeed, QUESTION_DIFFICULTIES };
