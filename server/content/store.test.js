const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { createStore } = require("./store");

function freshStore() {
  const file = path.join(
    os.tmpdir(),
    `quizgame-store-${crypto.randomBytes(6).toString("hex")}.json`
  );
  const store = createStore(file);
  // start from a clean, empty database (not the legacy seed)
  store._reset({ version: 1, categories: [], questions: [] });
  return { store, file, cleanup: () => { try { fs.unlinkSync(file); } catch {} } };
}

function makeCategory(store, over = {}) {
  const r = store.createCategory({ name: "Географія", ...over });
  assert.ok(r.category, JSON.stringify(r));
  return r.category;
}

function fourAnswers(correctIdx = 0) {
  return ["Київ", "Львів", "Одеса", "Харків"].map((text, i) => ({
    text,
    isCorrect: i === correctIdx,
  }));
}

function makeQuestion(store, categoryId, over = {}) {
  const r = store.createQuestion({
    categoryId,
    text: "Яка столиця України?",
    answers: fourAnswers(0),
    ...over,
  });
  assert.ok(r.question, JSON.stringify(r));
  return r.question;
}

// ---------------------------------------------------------------- categories

test("category: create / edit / delete / enable-disable", () => {
  const { store, cleanup } = freshStore();
  try {
    const cat = makeCategory(store, { description: "опис", icon: "🌍" });
    assert.equal(cat.name, "Географія");
    assert.equal(cat.isActive, true);
    assert.ok(cat.slug);
    assert.ok(cat.createdAt && cat.updatedAt);

    const upd = store.updateCategory(cat.id, { name: "Гео", isActive: false });
    assert.equal(upd.category.name, "Гео");
    assert.equal(upd.category.isActive, false);
    assert.notEqual(upd.category.updatedAt, cat.updatedAt);

    const toggled = store.updateCategory(cat.id, { isActive: true });
    assert.equal(toggled.category.isActive, true);

    const del = store.deleteCategory(cat.id);
    assert.equal(del.deleted, true);
    assert.equal(store.getCategory(cat.id), null);
  } finally {
    cleanup();
  }
});

test("category: name is required", () => {
  const { store, cleanup } = freshStore();
  try {
    const r = store.createCategory({ name: "  " });
    assert.ok(r.errors && r.errors.length);
  } finally {
    cleanup();
  }
});

test("category: slugs are unique", () => {
  const { store, cleanup } = freshStore();
  try {
    const a = makeCategory(store, { name: "Наука" });
    const b = makeCategory(store, { name: "Наука" });
    assert.notEqual(a.slug, b.slug);
  } finally {
    cleanup();
  }
});

test("category delete: blocked while it has questions, unless force", () => {
  const { store, cleanup } = freshStore();
  try {
    const cat = makeCategory(store);
    makeQuestion(store, cat.id);
    makeQuestion(store, cat.id, { text: "Друге?" });

    const blocked = store.deleteCategory(cat.id);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.questionCount, 2);
    assert.ok(store.getCategory(cat.id), "category still there");

    const forced = store.deleteCategory(cat.id, { force: true });
    assert.equal(forced.deleted, true);
    assert.equal(forced.questionCount, 2);
    assert.equal(store.listQuestions({ categoryId: cat.id }).total, 0);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------- questions

test("question: create / edit / delete", () => {
  const { store, cleanup } = freshStore();
  try {
    const cat = makeCategory(store);
    const q = makeQuestion(store, cat.id, { difficulty: "easy" });
    assert.equal(q.type, "single");
    assert.equal(q.answers.length, 4);
    assert.equal(q.answers.filter((a) => a.isCorrect).length, 1);
    assert.equal(q.difficulty, "easy");
    assert.ok(q.correctAnswerId);

    const edited = store.updateQuestion(q.id, {
      text: "Змінене питання?",
      correctAnswerId: q.answers[2].id,
    });
    assert.equal(edited.question.text, "Змінене питання?");
    assert.equal(
      edited.question.answers.find((a) => a.isCorrect).id,
      q.answers[2].id
    );

    assert.equal(store.deleteQuestion(q.id).deleted, true);
    assert.equal(store.getQuestion(q.id), null);
  } finally {
    cleanup();
  }
});

test("question validation: exactly 4 answers, exactly 1 correct, text + category required", () => {
  const { store, cleanup } = freshStore();
  try {
    const cat = makeCategory(store);

    let r = store.createQuestion({
      categoryId: cat.id,
      text: "Питання?",
      answers: [{ text: "A", isCorrect: true }, { text: "B" }, { text: "C" }],
    });
    assert.ok(r.errors.some((e) => /рівно 4/.test(e)), "needs 4 answers");

    r = store.createQuestion({
      categoryId: cat.id,
      text: "Питання?",
      answers: fourAnswers(0).map((a) => ({ ...a, isCorrect: true })),
    });
    assert.ok(r.errors.some((e) => /одна правильна/.test(e)), "needs exactly 1 correct");

    r = store.createQuestion({
      categoryId: cat.id,
      text: "Питання?",
      answers: fourAnswers(-1), // none correct
    });
    assert.ok(r.errors.some((e) => /одна правильна/.test(e)));

    r = store.createQuestion({ categoryId: cat.id, text: "", answers: fourAnswers(0) });
    assert.ok(r.errors.some((e) => /Текст питання/.test(e)));

    r = store.createQuestion({ categoryId: "nope", text: "x?", answers: fourAnswers(0) });
    assert.ok(r.errors.some((e) => /категор/i.test(e)));

    r = store.createQuestion({
      categoryId: cat.id,
      text: "Питання?",
      answers: [
        { text: "A", isCorrect: true },
        { text: "", isCorrect: false },
        { text: "C", isCorrect: false },
        { text: "D", isCorrect: false },
      ],
    });
    assert.ok(r.errors.some((e) => /заповнені/.test(e)), "blank answer rejected");
  } finally {
    cleanup();
  }
});

test("question: duplicate makes an independent copy", () => {
  const { store, cleanup } = freshStore();
  try {
    const cat = makeCategory(store);
    const q = makeQuestion(store, cat.id);
    const dup = store.duplicateQuestion(q.id).question;

    assert.notEqual(dup.id, q.id);
    assert.match(dup.text, /копія/);
    assert.equal(dup.answers.length, 4);
    dup.answers.forEach((a, i) => assert.notEqual(a.id, q.answers[i].id));

    store.updateQuestion(dup.id, { text: "Яка столиця Польщі?" });
    assert.equal(store.getQuestion(q.id).text, q.text, "original untouched");
  } finally {
    cleanup();
  }
});

test("questions: filter by category, status, search + pagination", () => {
  const { store, cleanup } = freshStore();
  try {
    const geo = makeCategory(store, { name: "Географія" });
    const math = makeCategory(store, { name: "Математика" });

    for (let i = 0; i < 12; i++) {
      makeQuestion(store, geo.id, { text: `Гео питання ${i}?` });
    }
    makeQuestion(store, math.id, { text: "12 + 8 = ?", answers: [
      { text: "20", isCorrect: true }, { text: "18" }, { text: "21" }, { text: "22" },
    ]});
    const hidden = makeQuestion(store, geo.id, { text: "Прихована гео?", isActive: false });

    const byCat = store.listQuestions({ categoryId: math.id });
    assert.equal(byCat.total, 1);
    assert.equal(byCat.items[0].categoryName, "Математика");

    const active = store.listQuestions({ categoryId: geo.id, status: "active" });
    assert.equal(active.total, 12);
    const inactive = store.listQuestions({ categoryId: geo.id, status: "inactive" });
    assert.equal(inactive.total, 1);
    assert.equal(inactive.items[0].id, hidden.id);

    const search = store.listQuestions({ search: "12 + 8" });
    assert.equal(search.total, 1);

    const page1 = store.listQuestions({ categoryId: geo.id, status: "active", page: 1, pageSize: 5 });
    assert.equal(page1.items.length, 5);
    assert.equal(page1.totalPages, 3);
    const page3 = store.listQuestions({ categoryId: geo.id, status: "active", page: 3, pageSize: 5 });
    assert.equal(page3.items.length, 2);
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------------- stats

test("stats: counts categories and questions", () => {
  const { store, cleanup } = freshStore();
  try {
    const a = makeCategory(store, { name: "A" });
    const b = makeCategory(store, { name: "B", isActive: false });
    makeQuestion(store, a.id);
    makeQuestion(store, a.id, { text: "q2?" });
    makeQuestion(store, a.id, { text: "q3 hidden?", isActive: false });

    const s = store.stats();
    assert.equal(s.totalCategories, 2);
    assert.equal(s.activeCategories, 1);
    assert.equal(s.inactiveCategories, 1);
    assert.equal(s.totalQuestions, 3);
    assert.equal(s.activeQuestions, 2);
    const rowA = s.perCategory.find((c) => c.id === a.id);
    assert.equal(rowA.total, 3);
    assert.equal(rowA.active, 2);
  } finally {
    cleanup();
  }
});

// --------------------------------------------------------------- import/export

test("import CSV: valid rows inserted, categories auto-created", () => {
  const { store, cleanup } = freshStore();
  try {
    const csv =
      "category,question,answer1,answer2,answer3,answer4,correctAnswer,difficulty\n" +
      'Географія,"Яка столиця України?","Київ","Львів","Одеса","Харків","Київ","easy"\n' +
      'Математика,"12 + 8 = ?","20","18","21","22","20","easy"\n';
    const r = store.importCSV(csv);
    assert.equal(r.ok, true);
    assert.equal(r.inserted, 2);
    assert.equal(r.createdCategories, 2);
    assert.equal(store.stats().totalQuestions, 2);
  } finally {
    cleanup();
  }
});

test("import CSV: all-or-nothing with clear row errors", () => {
  const { store, cleanup } = freshStore();
  try {
    makeCategory(store, { name: "Географія" });
    const csv =
      "category,question,answer1,answer2,answer3,answer4,correctAnswer,difficulty\n" +
      'Географія,"Ок питання?","A","B","C","D","A","easy"\n' +
      'Географія,"Замало відповідей?","A","B","","","A","easy"\n' +
      'Географія,"Погана правильна?","A","B","C","D","Z","easy"\n';
    const r = store.importCSV(csv);
    assert.equal(r.ok, false);
    assert.equal(r.inserted, 0);
    assert.equal(r.errors.length, 2);
    assert.equal(r.errors[0].row, 3);
    assert.match(r.errors[0].message, /4 відповід/);
    assert.equal(r.errors[1].row, 4);
    assert.match(r.errors[1].message, /не збігається/);
    assert.equal(store.stats().totalQuestions, 0, "nothing inserted");
  } finally {
    cleanup();
  }
});

test("export → import JSON round-trips", () => {
  const { store, cleanup } = freshStore();
  try {
    const cat = makeCategory(store, { name: "Історія" });
    makeQuestion(store, cat.id, { text: "Рік початку Другої світової?", answers: [
      { text: "1939", isCorrect: true }, { text: "1941" }, { text: "1914" }, { text: "1945" },
    ]});

    const dump = store.exportJSON();

    const { store: store2, cleanup: c2 } = freshStore();
    try {
      const r = store2.importJSON(dump);
      assert.equal(r.ok, true);
      assert.equal(r.inserted, 1);
      const q = store2.listQuestions({ search: "Другої світової" }).items[0];
      assert.equal(q.answers.find((a) => a.isCorrect).text, "1939");
    } finally {
      c2();
    }
  } finally {
    cleanup();
  }
});

// --------------------------------------------------------------- persistence

test("persistence: data survives a reload of the same file", () => {
  const { store, file, cleanup } = freshStore();
  try {
    const cat = makeCategory(store, { name: "Спорт" });
    makeQuestion(store, cat.id);

    const reopened = createStore(file);
    assert.equal(reopened.stats().totalCategories, 1);
    assert.equal(reopened.stats().totalQuestions, 1);
  } finally {
    cleanup();
  }
});
