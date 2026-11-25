const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.EXAM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "exam-test-"));
const store = require("./content/store");
const exam = require("./exam");
const { create, start, answer, finish, studentView, teacherView, toCSV, startStudent } = exam._internal;

test("grade12: the share of right answers on the 12-point scale, never below 1", () => {
  assert.equal(exam.grade12(20, 20), 12);
  assert.equal(exam.grade12(19, 20), 11);
  assert.equal(exam.grade12(10, 20), 6);
  assert.equal(exam.grade12(1, 20), 1);
  assert.equal(exam.grade12(0, 20), 1);
  assert.equal(exam.grade12(0, 0), 0);
});

function someCategory(min) {
  return store.getPublicCategories().find((c) => c.questionCount >= min);
}
function addStudent(e, name) {
  const s = { id: name, token: "t", name, socketId: null, joinedAt: Date.now(), order: null, answerOrders: null, answers: [], startedAt: null, finishedAt: null };
  e.students.set(s.id, s);
  if (e.status === "running") startStudent(e, s);
  return s;
}
/** The shown index of the right answer for the student's current question (test-only peek). */
function rightShown(e, s) {
  const qi = s.order[s.answers.length];
  return s.answerOrders[qi].indexOf(e.questions[qi].correct);
}

test("a test: same questions for all, no answer key on the phone, grades and stats at the end", () => {
  const cat = someCategory(6);
  const { exam: e, error } = create({ categoryId: cat.id, count: 5, timeLimitMin: 0 });
  assert.ok(!error, error);
  assert.equal(e.questions.length, 5);
  const a = addStudent(e, "Аня");
  const b = addStudent(e, "Богдан");
  assert.equal(studentView(e, a).phase, "waiting");
  start(e);
  const v = studentView(e, a);
  assert.equal(v.phase, "question");
  assert.equal(v.question.options.length, e.questions[a.order[0]].answers.length);
  assert.ok(!JSON.stringify(v).includes("correct"), "no answer key while running");

  // Аня: all right; Богдан: all wrong but one
  for (let i = 0; i < 5; i++) assert.deepEqual(answer(e, a, i, rightShown(e, a)), { ok: true });
  assert.equal(answer(e, a, 5, 0).error, "closed"); // done
  for (let i = 0; i < 5; i++) {
    const r = rightShown(e, b);
    answer(e, b, i, i === 0 ? r : (r + 1) % e.questions[b.order[i]].answers.length);
    if (i === 0) assert.equal(answer(e, b, 0, 0).stale, true); // a resent tap for an old question is ignored
  }
  const ra = studentView(e, a).result;
  assert.equal(ra.grade, 12);
  assert.equal(ra.correct, 5);
  assert.equal(studentView(e, a).review, undefined, "no right answers before the test is over");
  const rb = studentView(e, b).result;
  assert.equal(rb.correct, 1);
  assert.equal(rb.grade, exam.grade12(1, 5));

  finish(e, "test");
  const fa = studentView(e, a);
  assert.equal(fa.review.length, 5);
  assert.ok(fa.review.every((r) => r.correct));
  const t = teacherView(e);
  assert.equal(t.students.length, 2);
  assert.equal(t.questions.length, 5);
  assert.ok(t.questions.every((q) => q.answered === 2));
  const csv = toCSV(e);
  assert.ok(csv.includes("Аня") && csv.includes("Оцінка (12)"));
});

test("time is up / the teacher ends it: unanswered questions count as not right", () => {
  const cat = someCategory(4);
  const { exam: e } = create({ categoryId: cat.id, count: 4 });
  const s = addStudent(e, "Віка");
  start(e);
  answer(e, s, 0, rightShown(e, s));
  finish(e, "time");
  const r = studentView(e, s).result;
  assert.equal(r.answered, 1);
  assert.equal(r.unanswered, 3);
  assert.equal(r.grade, exam.grade12(1, 4));
  assert.equal(answer(e, s, 1, 0).error, "closed");
});

test("a student who joins late starts at once", () => {
  const cat = someCategory(3);
  const { exam: e } = create({ categoryId: cat.id, count: 3 });
  start(e);
  const s = addStudent(e, "Гліб");
  assert.equal(studentView(e, s).phase, "question");
});
