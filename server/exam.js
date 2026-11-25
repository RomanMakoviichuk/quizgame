/**
 * «Перевірка знань» — a test mode for a class, separate from the party game:
 * no videos, no minigames, no lives. Every student goes through the same N
 * questions of one category at their own pace on their phone (each in their
 * own order, answers shuffled per student), the teacher watches the progress
 * live and gets every student's grade on the 12-point scale plus statistics.
 *
 *   teacher  /teacher   (admin password)   exam:create · exam:teacherResume · exam:start · exam:finish · exam:kick · exam:close
 *   student  /test                         exam:join · exam:resume · exam:answer
 *
 * The answer key never leaves the server while the test runs. A student sees
 * the right answers only after the teacher ended the test (if allowed).
 *
 * Exams are saved to server/data/exams/<id>.json on every change, so a server
 * restart in the middle of a lesson loses nothing; a finished exam also gets a
 * <id>.csv next to it. These files hold students' names: keep them off git.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./content/store");
const { isValid: isAdminToken } = require("./admin/auth");
const { getRoom } = require("./rooms");

const DIR = process.env.EXAM_DIR || path.join(__dirname, "data", "exams");
const MAX_STUDENTS = 80;
const NAME_MAX = 60;
const KEEP_DAYS = 120; // finished exams older than this are not loaded any more (files stay)

const exams = new Map(); // code -> exam

// ---------------------------------------------------------------- helpers

const rid = (n = 16) => crypto.randomBytes(n).toString("hex");
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const cleanName = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);

/** 12-point scale: the share of right answers × 12, rounded; never below 1. */
function grade12(correct, total) {
  if (!total) return 0;
  return Math.max(1, Math.min(12, Math.round((correct / total) * 12)));
}

function newCode() {
  for (let i = 0; i < 200; i++) {
    const c = String(crypto.randomInt(1000, 10000));
    // never the code of a game room: students type both into the same field
    if (!exams.has(c) && !getRoom(c)) return c;
  }
  return String(crypto.randomInt(10000, 100000));
}

// ---------------------------------------------------------------- persistence

const saveTimers = new Map();
function save(exam, now = false) {
  const write = () => {
    saveTimers.delete(exam.id);
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const file = path.join(DIR, `${exam.id}.json`);
      fs.writeFileSync(file + ".tmp", JSON.stringify(toDisk(exam)));
      fs.renameSync(file + ".tmp", file);
      if (exam.status === "finished") fs.writeFileSync(path.join(DIR, `${exam.id}.csv`), "﻿" + toCSV(exam));
    } catch (e) {
      console.error("[exam] save failed:", e.message);
    }
  };
  clearTimeout(saveTimers.get(exam.id));
  if (now) return write();
  saveTimers.set(exam.id, setTimeout(write, 800));
}

function toDisk(exam) {
  const { timer, teacherSocketId, ...rest } = exam;
  return {
    ...rest,
    students: [...exam.students.values()].map(({ socketId, ...s }) => s),
  };
}

function loadAll() {
  let files = [];
  try {
    files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
      if (raw.status === "finished" && (raw.finishedAt || 0) < cutoff) continue;
      if (exams.has(raw.code)) continue;
      const exam = { ...raw, students: new Map(raw.students.map((s) => [s.id, { ...s, socketId: null }])), teacherSocketId: null, timer: null };
      exams.set(exam.code, exam);
      armTimer(exam);
    } catch (e) {
      console.error(`[exam] cannot load ${f}:`, e.message);
    }
  }
}

// ---------------------------------------------------------------- results

function studentResult(exam, s) {
  const total = exam.questions.length;
  const correct = s.answers.filter((a) => a.correct).length;
  const answered = s.answers.length;
  const wrong = answered - correct;
  const done = !!s.finishedAt || exam.status === "finished";
  const end = s.finishedAt || (exam.status === "finished" ? exam.finishedAt : null);
  return {
    total,
    answered,
    correct,
    wrong,
    unanswered: total - answered,
    percent: total ? Math.round((correct / total) * 100) : 0,
    grade: grade12(correct, total),
    done,
    timeMs: s.startedAt && end ? end - s.startedAt : null,
  };
}

/** Per question: how many answered it, how many right, the most chosen wrong answer. */
function questionStats(exam) {
  const all = [...exam.students.values()];
  return exam.questions.map((q, qi) => {
    const picks = new Array(q.answers.length).fill(0);
    let answered = 0;
    let correct = 0;
    for (const s of all)
      for (const a of s.answers)
        if (a.q === qi) {
          answered++;
          if (a.correct) correct++;
          picks[a.choice]++;
        }
    let topWrong = null;
    q.answers.forEach((text, i) => {
      if (i !== q.correct && picks[i] > 0 && (!topWrong || picks[i] > topWrong.count)) topWrong = { text, count: picks[i] };
    });
    return {
      n: qi + 1,
      text: q.text,
      correctText: q.answers[q.correct],
      answered,
      correct,
      percent: answered ? Math.round((correct / answered) * 100) : null,
      topWrong,
    };
  });
}

function toCSV(exam) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [];
  rows.push(["Тест", exam.title].map(esc).join(";"));
  rows.push(["Категорія", exam.categoryName].map(esc).join(";"));
  rows.push(["Дата", new Date(exam.startedAt || exam.createdAt).toLocaleString("uk-UA")].map(esc).join(";"));
  rows.push(["Питань", exam.questions.length].map(esc).join(";"));
  rows.push("");
  const qh = exam.questions.map((_, i) => `П${i + 1}`);
  rows.push(["№", "Учень", "Оцінка (12)", "Правильних", "Неправильних", "Без відповіді", "%", "Час (хв)", ...qh].map(esc).join(";"));
  const list = [...exam.students.values()].sort((a, b) => a.name.localeCompare(b.name, "uk"));
  list.forEach((s, i) => {
    const r = studentResult(exam, s);
    const byQ = exam.questions.map((_, qi) => {
      const a = s.answers.find((x) => x.q === qi);
      return a ? (a.correct ? "+" : "-") : "";
    });
    rows.push([i + 1, s.name, r.grade, r.correct, r.wrong, r.unanswered, r.percent, r.timeMs ? (r.timeMs / 60000).toFixed(1) : "", ...byQ].map(esc).join(";"));
  });
  rows.push("");
  rows.push(["Статистика питань"].map(esc).join(";"));
  rows.push(["№", "Питання", "Правильна відповідь", "Відповіли", "Правильно", "%", "Найчастіша помилка"].map(esc).join(";"));
  for (const q of questionStats(exam))
    rows.push([q.n, q.text, q.correctText, q.answered, q.correct, q.percent ?? "", q.topWrong ? `${q.topWrong.text} (${q.topWrong.count})` : ""].map(esc).join(";"));
  return rows.join("\r\n");
}

// ---------------------------------------------------------------- views

function teacherView(exam) {
  const students = [...exam.students.values()].map((s) => ({
    id: s.id,
    name: s.name,
    online: !!s.socketId,
    joinedAt: s.joinedAt,
    ...studentResult(exam, s),
    // which questions (in the exam's order) this student got right / wrong
    marks: exam.questions.map((_, qi) => {
      const a = s.answers.find((x) => x.q === qi);
      return a ? (a.correct ? 1 : 0) : null;
    }),
  }));
  return {
    code: exam.code,
    id: exam.id,
    title: exam.title,
    categoryName: exam.categoryName,
    status: exam.status,
    count: exam.questions.length,
    timeLimitMin: exam.timeLimitMin,
    showReview: exam.showReview,
    players: exam.players || 0,
    createdAt: exam.createdAt,
    startedAt: exam.startedAt,
    endsAt: exam.endsAt,
    finishedAt: exam.finishedAt,
    serverNow: Date.now(),
    students,
    questions: questionStats(exam),
  };
}

function studentView(exam, s) {
  const base = {
    code: exam.code,
    title: exam.title,
    categoryName: exam.categoryName,
    status: exam.status,
    name: s.name,
    total: exam.questions.length,
    position: s.answers.length,
    endsAt: exam.endsAt,
    serverNow: Date.now(),
  };
  if (exam.status === "running" && !s.finishedAt) {
    const qi = s.order[s.answers.length];
    const q = exam.questions[qi];
    const ord = s.answerOrders[qi];
    return { ...base, phase: "question", question: { text: q.text, options: ord.map((i) => q.answers[i]) } };
  }
  if (exam.status === "lobby") return { ...base, phase: "waiting" };
  const view = { ...base, phase: "done", result: studentResult(exam, s), examOver: exam.status === "finished" };
  // the right answers only once the test is over for everybody (no passing them on)
  if (exam.status === "finished" && exam.showReview)
    view.review = s.order.map((qi, k) => {
      const q = exam.questions[qi];
      const a = s.answers.find((x) => x.q === qi);
      return {
        n: k + 1,
        text: q.text,
        yours: a ? q.answers[a.choice] : null,
        correctText: q.answers[q.correct],
        correct: !!a?.correct,
      };
    });
  return view;
}

// ---------------------------------------------------------------- flow

function armTimer(exam) {
  clearTimeout(exam.timer);
  exam.timer = null;
  if (exam.status !== "running" || !exam.endsAt) return;
  exam.timer = setTimeout(() => finish(exam, "time"), Math.max(0, exam.endsAt - Date.now()));
}

let io = null;
function pushTeacher(exam) {
  if (io && exam.teacherSocketId) io.to(exam.teacherSocketId).emit("exam:teacherState", teacherView(exam));
}
function pushStudent(exam, s) {
  if (io && s.socketId) io.to(s.socketId).emit("exam:state", studentView(exam, s));
}
function pushAll(exam) {
  pushTeacher(exam);
  for (const s of exam.students.values()) pushStudent(exam, s);
}

function startStudent(exam, s) {
  if (s.order) return;
  s.order = shuffle(exam.questions.map((_, i) => i));
  s.answerOrders = exam.questions.map((q) => shuffle(q.answers.map((_, i) => i)));
  s.startedAt = Date.now();
}

function finish(exam, why) {
  if (exam.status === "finished") return;
  exam.status = "finished";
  exam.finishedAt = Date.now();
  clearTimeout(exam.timer);
  exam.timer = null;
  console.log(`[exam] ${exam.code} finished (${why}), ${exam.students.size} students`);
  save(exam, true);
  pushAll(exam);
}

function create({ categoryId, count, timeLimitMin, showReview, title, players }) {
  const cat = store.getCategory(categoryId);
  if (!cat) return { error: "Категорію не знайдено." };
  const pool = store.getPlayableQuestions(categoryId).filter((q) => q.answers.length >= 2 && q.answers.some((a) => a.isCorrect));
  if (!pool.length) return { error: "У цій категорії немає питань." };
  const n = Math.max(1, Math.min(pool.length, Math.floor(Number(count) || 20)));
  const chosen = shuffle(pool).slice(0, n);
  const exam = {
    id: `${new Date().toISOString().slice(0, 10)}_${rid(4)}`,
    code: newCode(),
    title: cleanName(title) || cat.name,
    categoryId,
    categoryName: cat.name,
    status: "lobby",
    timeLimitMin: Math.max(0, Math.min(240, Math.floor(Number(timeLimitMin) || 0))),
    showReview: showReview !== false,
    // how many students take the test (0 = any number): nobody extra can join,
    // and the test ends by itself once all of them have finished
    players: Math.max(0, Math.min(MAX_STUDENTS, Math.floor(Number(players) || 0))),
    createdAt: Date.now(),
    startedAt: null,
    endsAt: null,
    finishedAt: null,
    teacherToken: rid(),
    // a snapshot: editing the question later does not change this test
    questions: chosen.map((q) => ({
      id: q.id,
      text: q.text,
      answers: q.answers.map((a) => a.text),
      correct: q.answers.findIndex((a) => a.isCorrect),
    })),
    students: new Map(),
    teacherSocketId: null,
    timer: null,
  };
  exams.set(exam.code, exam);
  save(exam);
  console.log(`[exam] ${exam.code} created: ${exam.categoryName}, ${n} questions`);
  return { exam };
}

function start(exam) {
  if (exam.status !== "lobby") return;
  exam.status = "running";
  exam.startedAt = Date.now();
  exam.endsAt = exam.timeLimitMin ? exam.startedAt + exam.timeLimitMin * 60000 : null;
  for (const s of exam.students.values()) startStudent(exam, s);
  armTimer(exam);
  save(exam);
  pushAll(exam);
}

/** A test for a set number of students is over once that many have answered everything. */
function allDone(exam) {
  if (!exam.players) return false;
  let done = 0;
  for (const st of exam.students.values()) if (st.finishedAt) done++;
  return done >= exam.players;
}

function answer(exam, s, position, choice) {
  if (exam.status !== "running" || s.finishedAt) return { error: "closed" };
  // the phone says which question it answers: a resent tap for an old one is ignored
  if (Number(position) !== s.answers.length) return { ok: true, stale: true };
  const qi = s.order[s.answers.length];
  const q = exam.questions[qi];
  const shown = Number(choice);
  if (!Number.isInteger(shown) || shown < 0 || shown >= q.answers.length) return { error: "choice" };
  const orig = s.answerOrders[qi][shown];
  s.answers.push({ q: qi, choice: orig, correct: orig === q.correct, at: Date.now() });
  if (s.answers.length >= exam.questions.length) s.finishedAt = Date.now();
  if (s.finishedAt && allDone(exam)) {
    finish(exam, "all-done"); // saves and pushes everybody
    return { ok: true };
  }
  save(exam);
  pushStudent(exam, s);
  pushTeacher(exam);
  return { ok: true };
}

// ---------------------------------------------------------------- sockets

function register(ioServer) {
  io = ioServer;
  loadAll();

  io.on("connection", (socket) => {
    const ack = (cb) => (typeof cb === "function" ? cb : () => {});
    const teacherExam = () => {
      const e = exams.get(socket.examCode);
      return e && socket.examTeacher && e.teacherSocketId === socket.id ? e : null;
    };

    // ---------------- teacher
    socket.on("exam:create", (data, cb) => {
      const reply = ack(cb);
      if (!isAdminToken(data?.adminToken)) return reply({ error: "auth" });
      const { exam, error } = create(data || {});
      if (error) return reply({ error });
      exam.teacherSocketId = socket.id;
      socket.examCode = exam.code;
      socket.examTeacher = true;
      reply({ code: exam.code, teacherToken: exam.teacherToken, state: teacherView(exam) });
    });

    socket.on("exam:teacherResume", (data, cb) => {
      const reply = ack(cb);
      const exam = exams.get(String(data?.code || ""));
      if (!exam || data?.teacherToken !== exam.teacherToken) return reply({ error: "notfound" });
      exam.teacherSocketId = socket.id;
      socket.examCode = exam.code;
      socket.examTeacher = true;
      reply({ state: teacherView(exam) });
    });

    socket.on("exam:start", (_d, cb) => {
      const exam = teacherExam();
      if (!exam) return ack(cb)({ error: "notfound" });
      start(exam);
      ack(cb)({ ok: true });
    });

    socket.on("exam:finish", (_d, cb) => {
      const exam = teacherExam();
      if (!exam) return ack(cb)({ error: "notfound" });
      finish(exam, "teacher");
      ack(cb)({ ok: true });
    });

    socket.on("exam:kick", (data, cb) => {
      const exam = teacherExam();
      if (!exam) return ack(cb)({ error: "notfound" });
      const s = exam.students.get(String(data?.studentId || ""));
      if (s) {
        if (s.socketId && io) io.to(s.socketId).emit("exam:kicked");
        exam.students.delete(s.id);
        save(exam);
        pushTeacher(exam);
      }
      ack(cb)({ ok: true });
    });

    socket.on("exam:close", (_d, cb) => {
      const exam = teacherExam();
      if (!exam) return ack(cb)({ error: "notfound" });
      if (exam.status !== "finished") finish(exam, "closed");
      exams.delete(exam.code); // the files stay (history in the admin panel)
      socket.examCode = null;
      ack(cb)({ ok: true });
    });

    // ---------------- student
    socket.on("exam:join", (data, cb) => {
      const reply = ack(cb);
      const exam = exams.get(String(data?.code || "").trim());
      if (!exam) return reply({ error: "Тест з таким кодом не знайдено." });
      if (exam.status === "finished") return reply({ error: "Цей тест уже завершено." });
      const name = cleanName(data?.name);
      if (name.length < 2) return reply({ error: "Вкажіть прізвище та ім'я." });
      const same = [...exam.students.values()].find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (same) {
        // the same student lost the page (cleared browser, other phone): back to their own test,
        // with their answers — but only while that seat is not on line anywhere else
        if (same.socketId && io?.sockets.sockets.get(same.socketId)?.connected)
          return reply({ error: "Учень з таким ім'ям уже в тесті. Додайте ініціал або номер." });
        same.socketId = socket.id;
        same.token = rid();
        socket.examCode = exam.code;
        socket.examStudentId = same.id;
        save(exam);
        pushTeacher(exam);
        return reply({ code: exam.code, studentId: same.id, token: same.token, state: studentView(exam, same) });
      }
      if (exam.students.size >= MAX_STUDENTS) return reply({ error: "У тесті вже максимум учнів." });
      if (exam.players && exam.students.size >= exam.players)
        return reply({ error: `У тесті вже ${exam.players} з ${exam.players} учнів — вільних місць немає.` });
      const s = { id: rid(6), token: rid(), name, socketId: socket.id, joinedAt: Date.now(), order: null, answerOrders: null, answers: [], startedAt: null, finishedAt: null };
      exam.students.set(s.id, s);
      if (exam.status === "running") startStudent(exam, s); // came late: starts right away
      socket.examCode = exam.code;
      socket.examStudentId = s.id;
      save(exam);
      pushTeacher(exam);
      reply({ code: exam.code, studentId: s.id, token: s.token, state: studentView(exam, s) });
    });

    socket.on("exam:resume", (data, cb) => {
      const reply = ack(cb);
      const exam = exams.get(String(data?.code || ""));
      const s = exam?.students.get(String(data?.studentId || ""));
      if (!exam || !s || s.token !== data?.token) return reply({ error: "notfound" });
      s.socketId = socket.id;
      socket.examCode = exam.code;
      socket.examStudentId = s.id;
      pushTeacher(exam);
      reply({ state: studentView(exam, s) });
    });

    socket.on("exam:answer", (data, cb) => {
      const reply = ack(cb);
      const exam = exams.get(socket.examCode);
      const s = exam?.students.get(socket.examStudentId);
      if (!exam || !s || s.socketId !== socket.id) return reply({ error: "no-seat" });
      reply(answer(exam, s, data?.position, data?.choice));
    });

    socket.on("disconnect", () => {
      const exam = exams.get(socket.examCode);
      if (!exam) return;
      if (socket.examTeacher && exam.teacherSocketId === socket.id) exam.teacherSocketId = null;
      const s = exam.students.get(socket.examStudentId);
      if (s && s.socketId === socket.id) {
        s.socketId = null;
        pushTeacher(exam);
      }
    });
  });
}

// ---------------------------------------------------------------- history (admin)

function listSaved() {
  let files = [];
  try {
    files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
      const students = e.students || [];
      const total = (e.questions || []).length;
      const grades = students.map((s) => grade12((s.answers || []).filter((a) => a.correct).length, total));
      out.push({
        id: e.id,
        code: e.code,
        title: e.title,
        categoryName: e.categoryName,
        status: e.status,
        createdAt: e.createdAt,
        finishedAt: e.finishedAt,
        questions: total,
        students: students.length,
        avgGrade: grades.length ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10 : null,
      });
    } catch {
      /* a broken file: skipped */
    }
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** CSV of a saved exam by id (admin), or of a live one by code + teacher token. */
function csvFor({ id, code, teacherToken }) {
  if (code) {
    const exam = exams.get(String(code));
    if (!exam || exam.teacherToken !== teacherToken) return null;
    return { name: `${exam.id}.csv`, body: "﻿" + toCSV(exam) };
  }
  if (!/^[\w-]+$/.test(String(id || ""))) return null;
  const live = [...exams.values()].find((e) => e.id === id);
  if (live) return { name: `${id}.csv`, body: "﻿" + toCSV(live) };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8"));
    const exam = { ...raw, students: new Map(raw.students.map((s) => [s.id, s])) };
    return { name: `${id}.csv`, body: "﻿" + toCSV(exam) };
  } catch {
    return null;
  }
}

/** Is there a test students can still join under this code? (the game's join field asks) */
function isJoinable(code) {
  const exam = exams.get(String(code || ""));
  return !!exam && exam.status !== "finished";
}

module.exports = { isJoinable, register, listSaved, csvFor, grade12, _internal: { exams, create, start, answer, finish, studentView, teacherView, toCSV, questionStats, startStudent } };
