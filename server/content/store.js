/**
 * The question database.
 *
 * A single JSON file ({ version, categories[], questions[] }) with atomic
 * writes (write to a temp file, then rename). One process owns it; the admin
 * panel mutates it, the game reads from it. This replaces the old static
 * roundN.json decks and, unlike the in-memory rooms, it survives a restart.
 *
 * Data model (future-proofed — see FUTURE EXTENSIBILITY in the brief):
 *
 *   Category { id, name, slug, description, icon, isActive, createdAt, updatedAt }
 *   Question { id, categoryId, type:"single", text, difficulty|null, isActive,
 *              order, answers:[{ id, text, isCorrect }],
 *              explanation|null, mediaUrl|null, tags:[], createdAt, updatedAt }
 *
 * `type`, `explanation`, `mediaUrl`, `tags` are stored but unused today; they
 * exist so image/audio/true-false/tag features can be added without a migration.
 */
const fs = require("fs");
const path = require("path");

const {
  ANSWERS_PER_QUESTION,
  QUESTION_DIFFICULTIES,
} = require("../config");
const { newId, nowIso, makeSlug, normalizeDifficulty, cryptoShuffle } = require("./util");
const { parseCsv, toCsv } = require("./csv");
const { buildSeed } = require("./seed");

const QUESTION_TYPES = ["single"]; // extend later: "multiple", "boolean", "text"

function createStore(filePath) {
  let data = null;

  // ---------------------------------------------------------------- persistence

  function ensureLoaded() {
    if (data) return;
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        data = {
          version: parsed.version || 1,
          categories: Array.isArray(parsed.categories) ? parsed.categories : [],
          questions: Array.isArray(parsed.questions) ? parsed.questions : [],
        };
        return;
      } catch (e) {
        // Corrupt file — keep a backup, fall through to a fresh seed.
        try {
          fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
        } catch {}
      }
    }
    data = buildSeed();
    persist();
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  function mutate(fn) {
    ensureLoaded();
    const result = fn();
    persist();
    return result;
  }

  // ---------------------------------------------------------------- categories

  function serializeCategory(c) {
    return { ...c };
  }

  function listCategories({ activeOnly = false } = {}) {
    ensureLoaded();
    return data.categories
      .filter((c) => (activeOnly ? c.isActive : true))
      .map(serializeCategory)
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }

  function getCategory(id) {
    ensureLoaded();
    return data.categories.find((c) => c.id === id) || null;
  }

  function getCategoryBySlug(slug) {
    ensureLoaded();
    return data.categories.find((c) => c.slug === slug) || null;
  }

  function uniqueSlug(base, exceptId) {
    let slug = makeSlug(base);
    let candidate = slug;
    let n = 2;
    while (
      data.categories.some((c) => c.slug === candidate && c.id !== exceptId)
    ) {
      candidate = `${slug}-${n++}`;
    }
    return candidate;
  }

  function validateCategoryInput(input, { id } = {}) {
    const errors = [];
    const name = String(input.name || "").trim();
    if (!name) errors.push("Назва категорії обов'язкова.");
    if (name.length > 80) errors.push("Назва задовга (макс. 80 символів).");
    if (input.slug) {
      const slug = makeSlug(input.slug);
      if (data.categories.some((c) => c.slug === slug && c.id !== id)) {
        errors.push(`Ідентифікатор (slug) «${slug}» вже зайнятий.`);
      }
    }
    return errors;
  }

  function createCategory(input) {
    return mutate(() => {
      const errors = validateCategoryInput(input);
      if (errors.length) return { errors };
      const ts = nowIso();
      const cat = {
        id: newId("cat"),
        name: String(input.name).trim(),
        slug: uniqueSlug(input.slug || input.name),
        description: String(input.description || "").trim() || null,
        icon: String(input.icon || "").trim() || null,
        isActive: input.isActive !== false,
        createdAt: ts,
        updatedAt: ts,
      };
      data.categories.push(cat);
      return { category: serializeCategory(cat) };
    });
  }

  function updateCategory(id, input) {
    return mutate(() => {
      const cat = data.categories.find((c) => c.id === id);
      if (!cat) return { notFound: true };
      const errors = validateCategoryInput({ ...cat, ...input }, { id });
      if (errors.length) return { errors };
      if (input.name != null) cat.name = String(input.name).trim();
      if (input.slug != null) cat.slug = uniqueSlug(input.slug || cat.name, id);
      if (input.description !== undefined)
        cat.description = String(input.description || "").trim() || null;
      if (input.icon !== undefined)
        cat.icon = String(input.icon || "").trim() || null;
      if (input.isActive != null) cat.isActive = !!input.isActive;
      cat.updatedAt = nowIso();
      return { category: serializeCategory(cat) };
    });
  }

  function countQuestionsInCategory(categoryId) {
    ensureLoaded();
    return data.questions.filter((q) => q.categoryId === categoryId).length;
  }

  /**
   * Safe delete. Refuses if the category still holds questions unless
   * `force: true`, which cascade-deletes them. Returns { questionCount } on a
   * refusal so the caller can show "This category contains N questions.".
   */
  function deleteCategory(id, { force = false } = {}) {
    return mutate(() => {
      const idx = data.categories.findIndex((c) => c.id === id);
      if (idx === -1) return { notFound: true };
      const questionCount = countQuestionsInCategory(id);
      if (questionCount > 0 && !force) {
        return { blocked: true, questionCount };
      }
      data.questions = data.questions.filter((q) => q.categoryId !== id);
      data.categories.splice(idx, 1);
      return { deleted: true, questionCount };
    });
  }

  // ----------------------------------------------------------------- questions

  function serializeQuestion(q) {
    return {
      ...q,
      answers: q.answers.map((a) => ({ ...a })),
      correctAnswerId: (q.answers.find((a) => a.isCorrect) || {}).id || null,
    };
  }

  /** Question as the game client should never see the answer key. */
  function normalizeAnswersInput(rawAnswers) {
    const list = Array.isArray(rawAnswers) ? rawAnswers : [];
    return list.map((a) => ({
      id: a && a.id ? String(a.id) : newId("a"),
      text: String((a && a.text) != null ? a.text : "").trim(),
      isCorrect: !!(a && a.isCorrect),
    }));
  }

  /**
   * Validate a create/update payload. `correctAnswerId` (if given) wins over
   * per-answer `isCorrect` flags. Returns { errors:[], answers:[] }.
   */
  function validateQuestionInput(input, { partial = false } = {}) {
    ensureLoaded();
    const errors = [];

    const text = input.text != null ? String(input.text).trim() : undefined;
    if (!partial || input.text !== undefined) {
      if (!text) errors.push("Текст питання обов'язковий.");
      else if (text.length > 500) errors.push("Текст питання задовгий (макс. 500).");
    }

    if (!partial || input.categoryId !== undefined) {
      if (!input.categoryId) errors.push("Не вказана категорія.");
      else if (!data.categories.some((c) => c.id === input.categoryId))
        errors.push("Категорію не знайдено.");
    }

    if (input.type !== undefined && !QUESTION_TYPES.includes(input.type)) {
      errors.push(`Непідтримуваний тип питання: ${input.type}.`);
    }

    if (input.difficulty !== undefined && input.difficulty !== null && input.difficulty !== "") {
      if (!QUESTION_DIFFICULTIES.includes(String(input.difficulty).toLowerCase()))
        errors.push(
          `Складність має бути одним із: ${QUESTION_DIFFICULTIES.join(", ")}.`
        );
    }

    let answers = null;
    if (!partial || input.answers !== undefined || input.correctAnswerId !== undefined) {
      answers = normalizeAnswersInput(input.answers);
      if (answers.length !== ANSWERS_PER_QUESTION) {
        errors.push(
          `Питання повинно мати рівно ${ANSWERS_PER_QUESTION} варіанти відповіді.`
        );
      }
      if (answers.some((a) => !a.text)) {
        errors.push("Усі варіанти відповіді мають бути заповнені.");
      }

      if (input.correctAnswerId) {
        answers = answers.map((a) => ({
          ...a,
          isCorrect: a.id === input.correctAnswerId,
        }));
        if (!answers.some((a) => a.isCorrect)) {
          errors.push("Вказаний правильний варіант не знайдено серед відповідей.");
        }
      }
      const correctCount = answers.filter((a) => a.isCorrect).length;
      if (correctCount !== 1) {
        errors.push("Має бути рівно одна правильна відповідь.");
      }
    }

    return { errors, answers, text };
  }

  function createQuestion(input) {
    return mutate(() => {
      const { errors, answers } = validateQuestionInput(input);
      if (errors.length) return { errors };
      const ts = nowIso();
      const maxOrder = data.questions
        .filter((q) => q.categoryId === input.categoryId)
        .reduce((m, q) => Math.max(m, q.order || 0), -1);
      const q = {
        id: newId("q"),
        categoryId: input.categoryId,
        type: input.type || "single",
        text: String(input.text).trim(),
        difficulty: normalizeDifficulty(input.difficulty),
        isActive: input.isActive !== false,
        order: Number.isFinite(input.order) ? input.order : maxOrder + 1,
        answers,
        explanation: String(input.explanation || "").trim() || null,
        mediaUrl: String(input.mediaUrl || "").trim() || null,
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        createdAt: ts,
        updatedAt: ts,
      };
      data.questions.push(q);
      return { question: serializeQuestion(q) };
    });
  }

  function updateQuestion(id, input) {
    return mutate(() => {
      const q = data.questions.find((x) => x.id === id);
      if (!q) return { notFound: true };

      const merged = {
        categoryId: input.categoryId ?? q.categoryId,
        text: input.text ?? q.text,
        answers: input.answers ?? q.answers,
        correctAnswerId: input.correctAnswerId,
        type: input.type ?? q.type,
        difficulty: input.difficulty !== undefined ? input.difficulty : q.difficulty,
      };
      const { errors, answers } = validateQuestionInput(merged);
      if (errors.length) return { errors };

      q.categoryId = merged.categoryId;
      q.text = String(merged.text).trim();
      q.type = merged.type || "single";
      q.difficulty = normalizeDifficulty(merged.difficulty);
      q.answers = answers;
      if (input.isActive != null) q.isActive = !!input.isActive;
      if (input.order != null && Number.isFinite(input.order)) q.order = input.order;
      if (input.explanation !== undefined)
        q.explanation = String(input.explanation || "").trim() || null;
      if (input.mediaUrl !== undefined)
        q.mediaUrl = String(input.mediaUrl || "").trim() || null;
      if (input.tags !== undefined)
        q.tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
      q.updatedAt = nowIso();
      return { question: serializeQuestion(q) };
    });
  }

  function deleteQuestion(id) {
    return mutate(() => {
      const idx = data.questions.findIndex((q) => q.id === id);
      if (idx === -1) return { notFound: true };
      data.questions.splice(idx, 1);
      return { deleted: true };
    });
  }

  function duplicateQuestion(id) {
    return mutate(() => {
      const src = data.questions.find((q) => q.id === id);
      if (!src) return { notFound: true };
      const ts = nowIso();
      const copy = {
        ...src,
        id: newId("q"),
        text: `${src.text} (копія)`,
        order: (src.order || 0) + 1,
        answers: src.answers.map((a) => ({ ...a, id: newId("a") })),
        tags: [...(src.tags || [])],
        createdAt: ts,
        updatedAt: ts,
      };
      const at = data.questions.findIndex((q) => q.id === id);
      data.questions.splice(at + 1, 0, copy);
      return { question: serializeQuestion(copy) };
    });
  }

  function getQuestion(id) {
    ensureLoaded();
    const q = data.questions.find((x) => x.id === id);
    return q ? serializeQuestion(q) : null;
  }

  /**
   * Server-side paginated / filtered list for the admin table.
   *   { categoryId, status: "active"|"inactive"|"all", search, page, pageSize, sort }
   */
  function listQuestions(opts = {}) {
    ensureLoaded();
    const {
      categoryId = null,
      status = "all",
      search = "",
      page = 1,
      pageSize = 25,
      sort = "created_desc",
    } = opts;

    const needle = String(search || "").trim().toLowerCase();
    let items = data.questions.filter((q) => {
      if (categoryId && q.categoryId !== categoryId) return false;
      if (status === "active" && !q.isActive) return false;
      if (status === "inactive" && q.isActive) return false;
      if (needle) {
        const hay = (
          q.text +
          " " +
          q.answers.map((a) => a.text).join(" ")
        ).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    const catName = (cid) =>
      (data.categories.find((c) => c.id === cid) || {}).name || "—";

    const sorters = {
      created_desc: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
      created_asc: (a, b) => (a.createdAt > b.createdAt ? 1 : -1),
      text_asc: (a, b) => a.text.localeCompare(b.text, "uk"),
      category_asc: (a, b) =>
        catName(a.categoryId).localeCompare(catName(b.categoryId), "uk"),
      order_asc: (a, b) => (a.order || 0) - (b.order || 0),
    };
    items.sort(sorters[sort] || sorters.created_desc);

    const total = items.length;
    const ps = Math.max(1, Math.min(200, Number(pageSize) || 25));
    const totalPages = Math.max(1, Math.ceil(total / ps));
    const p = Math.max(1, Math.min(totalPages, Number(page) || 1));
    const start = (p - 1) * ps;

    return {
      items: items.slice(start, start + ps).map((q) => ({
        ...serializeQuestion(q),
        categoryName: catName(q.categoryId),
      })),
      total,
      page: p,
      pageSize: ps,
      totalPages,
    };
  }

  // --------------------------------------------------------------------- stats

  function stats() {
    ensureLoaded();
    const perCategory = data.categories
      .map((c) => {
        const qs = data.questions.filter((q) => q.categoryId === c.id);
        return {
          id: c.id,
          name: c.name,
          icon: c.icon,
          isActive: c.isActive,
          total: qs.length,
          active: qs.filter((q) => q.isActive).length,
        };
      })
      .sort((a, b) => b.total - a.total);

    return {
      totalCategories: data.categories.length,
      activeCategories: data.categories.filter((c) => c.isActive).length,
      inactiveCategories: data.categories.filter((c) => !c.isActive).length,
      totalQuestions: data.questions.length,
      activeQuestions: data.questions.filter((q) => q.isActive).length,
      perCategory,
    };
  }

  // ------------------------------------------------------------ gameplay reads

  /** Active questions in a category, answer key included (server-only). */
  function getPlayableQuestions(categoryId) {
    ensureLoaded();
    return data.questions
      .filter((q) => q.categoryId === categoryId && q.isActive)
      .map(serializeQuestion);
  }

  /** Active categories for the game's "select category" screen. */
  function getPublicCategories() {
    ensureLoaded();
    return data.categories
      .filter((c) => c.isActive)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        icon: c.icon,
        description: c.description,
        questionCount: data.questions.filter(
          (q) => q.categoryId === c.id && q.isActive
        ).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }

  // ------------------------------------------------------------ import/export

  const CSV_HEADER = [
    "category",
    "question",
    "answer1",
    "answer2",
    "answer3",
    "answer4",
    "correctAnswer",
    "difficulty",
    "active",
  ];

  function exportJSON() {
    ensureLoaded();
    return {
      version: data.version || 1,
      exportedAt: nowIso(),
      categories: data.categories.map(serializeCategory),
      questions: data.questions.map(serializeQuestion),
    };
  }

  function exportCSV({ categoryId = null } = {}) {
    ensureLoaded();
    const catName = (cid) =>
      (data.categories.find((c) => c.id === cid) || {}).name || "";
    const rows = data.questions
      .filter((q) => (categoryId ? q.categoryId === categoryId : true))
      .map((q) => {
        const correct = q.answers.find((a) => a.isCorrect);
        return {
          category: catName(q.categoryId),
          question: q.text,
          answer1: q.answers[0] ? q.answers[0].text : "",
          answer2: q.answers[1] ? q.answers[1].text : "",
          answer3: q.answers[2] ? q.answers[2].text : "",
          answer4: q.answers[3] ? q.answers[3].text : "",
          correctAnswer: correct ? correct.text : "",
          difficulty: q.difficulty || "",
          active: q.isActive ? "true" : "false",
        };
      });
    return toCsv(CSV_HEADER, rows);
  }

  /**
   * Validate every row first; insert nothing unless the whole batch is valid.
   * New category names are created on the fly. Returns
   *   { ok, inserted, createdCategories, errors:[{ row, message }] }
   */
  function importRows(rows, { createMissingCategories = true } = {}) {
    return mutate(() => {
      const errors = [];
      const staged = [];
      const pendingCategories = new Map(); // lowerName -> {name}

      const findCategory = (name) => {
        const key = String(name || "").trim().toLowerCase();
        const existing = data.categories.find(
          (c) => c.name.toLowerCase() === key || c.slug === makeSlug(name)
        );
        return existing || null;
      };

      rows.forEach((raw, i) => {
        const rowNo = raw.__row || i + 1;
        const catName = String(raw.category || "").trim();
        const text = String(raw.question || "").trim();
        const answerTexts = [raw.answer1, raw.answer2, raw.answer3, raw.answer4].map(
          (a) => String(a == null ? "" : a).trim()
        );
        const correct = String(raw.correctAnswer || "").trim();
        const difficulty = normalizeDifficulty(raw.difficulty);
        const active =
          raw.active === undefined || raw.active === ""
            ? true
            : /^(1|true|yes|так|активн)/i.test(String(raw.active).trim());

        if (!catName) {
          errors.push({ row: rowNo, message: "не вказана категорія." });
          return;
        }
        if (!text) {
          errors.push({ row: rowNo, message: "порожній текст питання." });
          return;
        }
        const filled = answerTexts.filter((a) => a.length > 0);
        if (filled.length !== ANSWERS_PER_QUESTION) {
          errors.push({
            row: rowNo,
            message: `питання повинно мати рівно ${ANSWERS_PER_QUESTION} відповіді (знайдено ${filled.length}).`,
          });
          return;
        }
        if (!correct) {
          errors.push({ row: rowNo, message: "не вказана правильна відповідь." });
          return;
        }
        const matchIdx = answerTexts.findIndex(
          (a) => a.toLowerCase() === correct.toLowerCase()
        );
        if (matchIdx === -1) {
          errors.push({
            row: rowNo,
            message: "правильна відповідь не збігається з жодним варіантом.",
          });
          return;
        }
        if (raw.difficulty && !difficulty) {
          errors.push({
            row: rowNo,
            message: `невідома складність «${raw.difficulty}».`,
          });
          return;
        }

        let category = findCategory(catName);
        if (!category) {
          if (!createMissingCategories) {
            errors.push({
              row: rowNo,
              message: `категорію «${catName}» не знайдено.`,
            });
            return;
          }
          pendingCategories.set(catName.toLowerCase(), { name: catName });
        }

        staged.push({
          rowNo,
          categoryName: catName,
          categoryId: category ? category.id : null,
          text,
          answerTexts,
          correctIdx: matchIdx,
          difficulty,
          active,
        });
      });

      if (errors.length) {
        return { ok: false, inserted: 0, createdCategories: 0, errors };
      }

      // Commit: create categories, then questions.
      const ts = nowIso();
      const createdNames = [];
      for (const { name } of pendingCategories.values()) {
        const cat = {
          id: newId("cat"),
          name,
          slug: uniqueSlug(name),
          description: null,
          icon: null,
          isActive: true,
          createdAt: ts,
          updatedAt: ts,
        };
        data.categories.push(cat);
        createdNames.push(name);
      }
      const catIdByName = {};
      for (const c of data.categories) catIdByName[c.name.toLowerCase()] = c.id;

      let order = data.questions.reduce((m, q) => Math.max(m, q.order || 0), -1);
      for (const s of staged) {
        const categoryId = s.categoryId || catIdByName[s.categoryName.toLowerCase()];
        order += 1;
        data.questions.push({
          id: newId("q"),
          categoryId,
          type: "single",
          text: s.text,
          difficulty: s.difficulty,
          isActive: s.active,
          order,
          answers: s.answerTexts.map((t, idx) => ({
            id: newId("a"),
            text: t,
            isCorrect: idx === s.correctIdx,
          })),
          explanation: null,
          mediaUrl: null,
          tags: [],
          createdAt: ts,
          updatedAt: ts,
        });
      }

      return {
        ok: true,
        inserted: staged.length,
        createdCategories: createdNames.length,
        createdCategoryNames: createdNames,
        errors: [],
      };
    });
  }

  function importCSV(csvText, opts) {
    const { rows } = parseCsv(csvText);
    return importRows(rows, opts);
  }

  function importJSON(payload, opts) {
    // Accept either our export shape or a bare array of CSV-like rows.
    let rows = [];
    if (Array.isArray(payload)) {
      rows = payload;
    } else if (payload && Array.isArray(payload.questions)) {
      const catNameById = {};
      for (const c of payload.categories || []) catNameById[c.id] = c.name;
      rows = payload.questions.map((q, i) => {
        const answers = q.answers || [];
        const correct = answers.find((a) => a.isCorrect) || {};
        return {
          __row: i + 1,
          category: catNameById[q.categoryId] || q.categoryName || "",
          question: q.text,
          answer1: answers[0] ? answers[0].text : "",
          answer2: answers[1] ? answers[1].text : "",
          answer3: answers[2] ? answers[2].text : "",
          answer4: answers[3] ? answers[3].text : "",
          correctAnswer: correct.text || "",
          difficulty: q.difficulty || "",
          active: q.isActive === false ? "false" : "true",
        };
      });
    }
    return importRows(rows, opts);
  }

  // ---------------------------------------------------------------- test hooks

  function _reset(seed) {
    data = seed || buildSeed();
    persist();
  }
  function _raw() {
    ensureLoaded();
    return data;
  }

  return {
    // categories
    listCategories,
    getCategory,
    getCategoryBySlug,
    createCategory,
    updateCategory,
    deleteCategory,
    countQuestionsInCategory,
    // questions
    listQuestions,
    getQuestion,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    duplicateQuestion,
    validateQuestionInput,
    // dashboard
    stats,
    // gameplay
    getPlayableQuestions,
    getPublicCategories,
    // io
    exportJSON,
    exportCSV,
    importRows,
    importCSV,
    importJSON,
    CSV_HEADER,
    cryptoShuffle,
    // tests
    _reset,
    _raw,
  };
}

// Default singleton bound to the configured file.
const { CONTENT_FILE } = require("../config");
const defaultStore = createStore(CONTENT_FILE);

module.exports = defaultStore;
module.exports.createStore = createStore;
module.exports.QUESTION_TYPES = QUESTION_TYPES;
