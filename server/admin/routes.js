/**
 * REST API.
 *
 *   Public (gameplay):
 *     GET  /api/categories                 active categories for the host picker
 *
 *   Admin (bearer token from POST /api/admin/login):
 *     POST   /api/admin/login              { password } -> { token }
 *     POST   /api/admin/logout
 *     GET    /api/admin/stats
 *     GET    /api/admin/categories
 *     POST   /api/admin/categories
 *     PUT    /api/admin/categories/:id
 *     DELETE /api/admin/categories/:id?force=1
 *     GET    /api/admin/questions?category=&status=&search=&page=&pageSize=&sort=
 *     GET    /api/admin/questions/:id
 *     POST   /api/admin/questions
 *     PUT    /api/admin/questions/:id
 *     DELETE /api/admin/questions/:id
 *     POST   /api/admin/questions/:id/duplicate
 *     GET    /api/admin/export?format=csv|json&category=
 *     POST   /api/admin/import            { format:"csv"|"json", data, createMissingCategories? }
 *     GET    /api/admin/meta              difficulties / question types / answer count
 *
 * Admin CRUD and gameplay reads are deliberately separate: the game only ever
 * hits GET /api/categories and never sees the answer key over HTTP.
 */
const express = require("express");
const store = require("../content/store");
const { categoryReadiness } = require("../questions");
const {
  ANSWERS_PER_QUESTION,
  QUESTION_DIFFICULTIES,
  MIN_QUESTIONS_PER_GAME,
} = require("../config");
const { login, logout, requireAuth } = require("./auth");
const { QUESTION_TYPES } = require("../content/store");

const router = express.Router();

// ------------------------------------------------------------------ public

router.get("/api/categories", (_req, res) => {
  const cats = store.getPublicCategories().map((c) => ({
    ...c,
    playable: c.questionCount >= MIN_QUESTIONS_PER_GAME,
    minQuestions: MIN_QUESTIONS_PER_GAME,
  }));
  res.json({ categories: cats });
});

// ------------------------------------------------------------------ admin auth

router.post("/api/admin/login", (req, res) => {
  const result = login(req.body && req.body.password);
  if (!result) return res.status(401).json({ error: "Невірний пароль." });
  res.json(result);
});

router.post("/api/admin/logout", requireAuth, (req, res) => {
  logout(req.adminToken);
  res.json({ ok: true });
});

// Everything below requires a token.
router.use("/api/admin", requireAuth);

router.get("/api/admin/meta", (_req, res) => {
  res.json({
    difficulties: QUESTION_DIFFICULTIES,
    questionTypes: QUESTION_TYPES,
    answersPerQuestion: ANSWERS_PER_QUESTION,
    minQuestionsPerGame: MIN_QUESTIONS_PER_GAME,
    csvHeader: store.CSV_HEADER,
  });
});

router.get("/api/admin/stats", (_req, res) => {
  res.json(store.stats());
});

// ------------------------------------------------------------ categories

router.get("/api/admin/categories", (_req, res) => {
  const cats = store.listCategories().map((c) => {
    const r = categoryReadiness(c.id);
    return {
      ...c,
      questionCount: store.countQuestionsInCategory(c.id),
      activeQuestionCount: r.available,
      playable: r.ok,
    };
  });
  res.json({ categories: cats });
});

router.post("/api/admin/categories", (req, res) => {
  const result = store.createCategory(req.body || {});
  if (result.errors) return res.status(400).json({ errors: result.errors });
  res.status(201).json({ category: result.category });
});

router.put("/api/admin/categories/:id", (req, res) => {
  const result = store.updateCategory(req.params.id, req.body || {});
  if (result.notFound) return res.status(404).json({ error: "Категорію не знайдено." });
  if (result.errors) return res.status(400).json({ errors: result.errors });
  res.json({ category: result.category });
});

router.delete("/api/admin/categories/:id", (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  const result = store.deleteCategory(req.params.id, { force });
  if (result.notFound) return res.status(404).json({ error: "Категорію не знайдено." });
  if (result.blocked) {
    return res.status(409).json({
      error: `Ця категорія містить ${result.questionCount} питань. Спочатку перемістіть або видаліть питання.`,
      questionCount: result.questionCount,
      requiresForce: true,
    });
  }
  res.json({ ok: true, deletedQuestions: result.questionCount });
});

// -------------------------------------------------------------- questions

router.get("/api/admin/questions", (req, res) => {
  const result = store.listQuestions({
    categoryId: req.query.category || null,
    status: req.query.status || "all",
    search: req.query.search || "",
    page: Number(req.query.page) || 1,
    pageSize: Number(req.query.pageSize) || 25,
    sort: req.query.sort || "created_desc",
  });
  res.json(result);
});

router.get("/api/admin/questions/:id", (req, res) => {
  const q = store.getQuestion(req.params.id);
  if (!q) return res.status(404).json({ error: "Питання не знайдено." });
  res.json({ question: q });
});

router.post("/api/admin/questions", (req, res) => {
  const result = store.createQuestion(req.body || {});
  if (result.errors) return res.status(400).json({ errors: result.errors });
  res.status(201).json({ question: result.question });
});

router.put("/api/admin/questions/:id", (req, res) => {
  const result = store.updateQuestion(req.params.id, req.body || {});
  if (result.notFound) return res.status(404).json({ error: "Питання не знайдено." });
  if (result.errors) return res.status(400).json({ errors: result.errors });
  res.json({ question: result.question });
});

router.delete("/api/admin/questions/:id", (req, res) => {
  const result = store.deleteQuestion(req.params.id);
  if (result.notFound) return res.status(404).json({ error: "Питання не знайдено." });
  res.json({ ok: true });
});

router.post("/api/admin/questions/:id/duplicate", (req, res) => {
  const result = store.duplicateQuestion(req.params.id);
  if (result.notFound) return res.status(404).json({ error: "Питання не знайдено." });
  res.status(201).json({ question: result.question });
});

// ------------------------------------------------------------- import/export

router.get("/api/admin/export", (req, res) => {
  const format = (req.query.format || "json").toLowerCase();
  const categoryId = req.query.category || null;
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="quizgame-questions.csv"'
    );
    return res.send(store.exportCSV({ categoryId }));
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="quizgame-content.json"'
  );
  res.send(JSON.stringify(store.exportJSON(), null, 2));
});

router.post("/api/admin/import", (req, res) => {
  const body = req.body || {};
  const format = (body.format || "csv").toLowerCase();
  const opts = { createMissingCategories: body.createMissingCategories !== false };
  let result;
  try {
    if (format === "csv") {
      result = store.importCSV(String(body.data || ""), opts);
    } else {
      const payload =
        typeof body.data === "string" ? JSON.parse(body.data) : body.data;
      result = store.importJSON(payload, opts);
    }
  } catch (e) {
    return res.status(400).json({ error: "Не вдалося розібрати файл: " + e.message });
  }
  if (!result.ok) {
    return res.status(422).json({
      ok: false,
      inserted: 0,
      errors: result.errors,
    });
  }
  res.json(result);
});

module.exports = router;
