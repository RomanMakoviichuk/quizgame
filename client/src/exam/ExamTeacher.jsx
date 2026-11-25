import { useCallback, useEffect, useMemo, useState } from "react";
import "./exam.css";
import { SERVER_URL, connectExam, call, readJSON, writeJSON, gradeLevel, gradeScale, fmtDuration } from "./examApi";

/**
 * The teacher's page (/teacher, on the classroom computer / projector):
 * admin password → choose category, number of questions, time → the code for
 * the students → live progress → grades (12-point), per-question statistics, CSV.
 */
const ADMIN = "quizgame_exam_admin";
const TEACHER = "quizgame_exam_teacher";

async function api(path, token, opts = {}) {
  const r = await fetch(`${SERVER_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  if (r.status === 401) throw Object.assign(new Error("auth"), { auth: true });
  return r;
}

async function downloadCsv(url, token, fallbackName) {
  const r = await api(url, token);
  if (!r.ok) throw new Error("Не вдалося завантажити");
  const blob = await r.blob();
  const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default function ExamTeacher() {
  const [adminToken, setAdminToken] = useState(() => readJSON(ADMIN)?.token || null);
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [exam, setExam] = useState(null); // teacher view from the server
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  const [lanIp, setLanIp] = useState(null);

  const logout = useCallback(() => {
    writeJSON(ADMIN, null);
    setAdminToken(null);
  }, []);

  const applyExam = (v) => {
    setExam(v);
    if (v && Number.isFinite(v.serverNow)) setOffset(v.serverNow - Date.now());
  };

  useEffect(() => {
    const s = connectExam();
    setSocket(s);
    s.on("connect", async () => {
      setConnected(true);
      const saved = readJSON(TEACHER);
      if (!saved) return;
      const r = await call(s, "exam:teacherResume", saved);
      if (r.error) {
        if (r.error !== "timeout") writeJSON(TEACHER, null);
        return;
      }
      applyExam(r.state);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("exam:teacherState", applyExam);
    fetch(`${SERVER_URL}/api/exam/lan`)
      .then((r) => r.json())
      .then((d) => setLanIp(d.ips?.[0] || null))
      .catch(() => {});
    return () => s.close();
  }, []);

  useEffect(() => {
    if (exam?.status !== "running") return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [exam?.status]);

  // where the students go: this page's address, but a LAN IP instead of "localhost"
  const studentUrl = useMemo(() => {
    const { hostname, port, protocol } = window.location;
    const local = hostname === "localhost" || hostname === "127.0.0.1";
    const host = local && lanIp ? lanIp : hostname;
    return `${protocol}//${host}${port ? `:${port}` : ""}/test`;
  }, [lanIp]);

  if (!adminToken) return <Login onToken={(t) => (writeJSON(ADMIN, { token: t }), setAdminToken(t))} />;

  const top = (
    <header className="ex-top ex-top-wide">
      <span className="ex-brand">Перевірка знань · вчитель</span>
      <span className="ex-top-right">
        <span className={`ex-dot ${connected ? "on" : ""}`} title={connected ? "На зв'язку" : "Немає зв'язку"} />
        <a className="ex-link" href="/">
          До гри
        </a>
        <button className="ex-link" type="button" onClick={logout}>
          Вийти
        </button>
      </span>
    </header>
  );

  if (!exam)
    return (
      <div className="ex-root ex-teacher">
        {top}
        <Setup
          adminToken={adminToken}
          onAuthLost={logout}
          onCreate={async (opts) => {
            const r = await call(socket, "exam:create", { ...opts, adminToken });
            if (r.error === "auth") {
              logout();
              return "Сесія завершилась — увійдіть ще раз.";
            }
            if (r.error) return r.error === "timeout" ? "Немає зв'язку з сервером." : r.error;
            writeJSON(TEACHER, { code: r.code, teacherToken: r.teacherToken });
            applyExam(r.state);
            return null;
          }}
        />
      </div>
    );

  const close = async () => {
    if (exam.status !== "finished" && !window.confirm("Закрити тест? Він буде завершений для всіх учнів.")) return;
    await call(socket, "exam:close", {});
    writeJSON(TEACHER, null);
    setExam(null);
  };

  return (
    <div className="ex-root ex-teacher">
      {top}
      {exam.status === "lobby" && <Lobby exam={exam} studentUrl={studentUrl} socket={socket} onClose={close} />}
      {exam.status === "running" && <Running exam={exam} offset={offset} studentUrl={studentUrl} socket={socket} />}
      {exam.status === "finished" && <Finished exam={exam} onClose={close} />}
    </div>
  );
}

// ---------------------------------------------------------------- login

function Login({ onToken }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const r = await fetch(`${SERVER_URL}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
      const d = await r.json();
      if (!r.ok || !d.token) return setErr(d.error || "Невірний пароль.");
      onToken(d.token);
    } catch {
      setErr("Немає зв'язку з сервером.");
    }
  };
  return (
    <div className="ex-root ex-teacher">
      <form className="ex-card ex-join ex-narrow" onSubmit={submit}>
        <h1>Перевірка знань</h1>
        <p className="ex-muted">Вхід для вчителя — пароль адмін-панелі.</p>
        <label>
          Пароль
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        {err && <p className="ex-error">{err}</p>}
        <button className="ex-btn primary">Увійти</button>
        <a className="ex-link" href="/">
          ← До гри
        </a>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- setup + history

function Setup({ adminToken, onCreate, onAuthLost }) {
  const [cats, setCats] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [count, setCount] = useState(20);
  const [timeLimitMin, setTime] = useState(0);
  const [showReview, setShowReview] = useState(true);
  const [players, setPlayers] = useState(0);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/categories`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.categories || []).filter((c) => c.questionCount > 0);
        setCats(list);
        const pref = list.find((c) => /контрол|тест|вашк/i.test(c.name)) || list[0];
        if (pref) setCategoryId(pref.id);
      })
      .catch(() => setErr("Не вдалося завантажити категорії."));
    api("/api/admin/exams", adminToken)
      .then((r) => r.json())
      .then((d) => setHistory(d.exams || []))
      .catch((e) => (e.auth ? onAuthLost() : setHistory([])));
  }, [adminToken, onAuthLost]);

  const cat = cats.find((c) => c.id === categoryId);
  const max = cat?.questionCount || 0;
  const n = Math.min(count || 0, max);

  const submit = async (e) => {
    e.preventDefault();
    if (!cat) return;
    setBusy(true);
    setErr((await onCreate({ categoryId, count: n, timeLimitMin, showReview, players, title: title.trim() })) || "");
    setBusy(false);
  };

  return (
    <div className="ex-page">
      <form className="ex-card ex-setup" onSubmit={submit}>
        <h1>Новий тест</h1>
        <label>
          Категорія питань
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.questionCount})
              </option>
            ))}
          </select>
        </label>
        <label>
          Назва тесту <span className="ex-muted">(необов'язково)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={cat?.name || ""} maxLength={60} />
        </label>
        <div className="ex-row">
          <label>
            Кількість питань
            <input type="number" min={1} max={max} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
            <span className="ex-muted small">
              {max ? `у категорії ${max}${count > max ? ` — буде ${max}` : ""}` : ""}
            </span>
          </label>
          <label>
            Час на тест
            <select value={timeLimitMin} onChange={(e) => setTime(Number(e.target.value))}>
              <option value={0}>без обмеження</option>
              {[5, 10, 15, 20, 25, 30, 40, 45].map((m) => (
                <option key={m} value={m}>
                  {m} хв
                </option>
              ))}
            </select>
          </label>
          <label>
            Кількість учнів
            <select value={players} onChange={(e) => setPlayers(Number(e.target.value))}>
              <option value={0}>будь-яка</option>
              {Array.from({ length: 39 }, (_, i) => i + 2).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="ex-muted small">{players ? "зайвих не пустить; тест завершиться, щойно всі дадуть відповіді" : ""}</span>
          </label>
        </div>
        <label className="ex-check">
          <input type="checkbox" checked={showReview} onChange={(e) => setShowReview(e.target.checked)} />
          Після завершення тесту показати учням їхні помилки й правильні відповіді
        </label>
        <p className="ex-muted small">
          Кожен учень отримує ті самі {n || "…"} питань, але в іншому порядку і з перемішаними варіантами. Питання без відповіді рахуються як неправильні.
        </p>
        {n > 0 && (
          <>
            <p className="ex-muted small">Шкала оцінок для {n} питань (правильних → бал):</p>
            <div className="ex-scale">
              {gradeScale(n).map((r) => (
                <span key={r.grade}>
                  {r.from === r.to ? r.from : `${r.from}–${r.to}`} → <b>{r.grade}</b>
                </span>
              ))}
            </div>
          </>
        )}
        {err && <p className="ex-error">{err}</p>}
        <button className="ex-btn primary" disabled={!cat || busy}>
          {busy ? "Створюємо…" : "Створити тест"}
        </button>
      </form>

      <div className="ex-card ex-history">
        <h2>Попередні тести</h2>
        {history == null && <p className="ex-muted">Завантаження…</p>}
        {history && !history.length && <p className="ex-muted">Ще не було жодного тесту.</p>}
        {history && history.length > 0 && (
          <table className="ex-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тест</th>
                <th>Учнів</th>
                <th>Сер. бал</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{fmtDate(h.createdAt)}</td>
                  <td>
                    {h.title}
                    {h.status !== "finished" && <span className="ex-tag">триває</span>}
                  </td>
                  <td>{h.students}</td>
                  <td>{h.avgGrade ?? "—"}</td>
                  <td>
                    <button
                      className="ex-link"
                      type="button"
                      onClick={() => downloadCsv(`/api/admin/exams/${h.id}/results.csv`, adminToken, `${h.id}.csv`).catch((e) => (e.auth ? onAuthLost() : alert(e.message)))}
                    >
                      CSV
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lobby

function Lobby({ exam, studentUrl, socket, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="ex-page">
      <div className="ex-card ex-lobby">
        <p className="ex-muted">
          {exam.categoryName} · {exam.count} питань · {exam.timeLimitMin ? `${exam.timeLimitMin} хв` : "без обмеження часу"}
          {exam.players ? ` · ${exam.players} учнів` : ""}
        </p>
        <h1>{exam.title}</h1>
        <div className="ex-join-info">
          <div>
            <span className="ex-muted">Відкрийте на телефоні</span>
            <b className="ex-url">{studentUrl.replace(/^https?:\/\//, "")}</b>
          </div>
          <div>
            <span className="ex-muted">Код тесту</span>
            <b className="ex-code">{exam.code}</b>
          </div>
        </div>
        <div className="ex-actions">
          <button
            className="ex-btn primary big"
            type="button"
            disabled={busy || exam.students.length === 0}
            onClick={async () => {
              setBusy(true);
              await call(socket, "exam:start", {});
              setBusy(false);
            }}
          >
            {exam.players && exam.students.length >= exam.players
              ? `Усі ${exam.players} на місці — почати тест`
              : `Почати тест (${exam.students.length}${exam.players ? `/${exam.players}` : ""})`}
          </button>
          <button className="ex-link" type="button" onClick={onClose}>
            Скасувати
          </button>
        </div>
        <p className="ex-muted small">Учні, які приєднаються пізніше, почнуть одразу.</p>
      </div>
      <div className="ex-card">
        <h2>
          Учні ({exam.students.length}
          {exam.players ? `/${exam.players}` : ""})
        </h2>
        {!exam.students.length && <p className="ex-muted">Поки нікого…</p>}
        <ul className="ex-names">
          {[...exam.students]
            .sort((a, b) => a.name.localeCompare(b.name, "uk"))
            .map((s) => (
              <li key={s.id} className={s.online ? "" : "off"}>
                {s.name}
                <button className="ex-x" type="button" title="Прибрати" onClick={() => call(socket, "exam:kick", { studentId: s.id })}>
                  ×
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- running

function Running({ exam, offset, studentUrl, socket }) {
  const left = exam.endsAt ? Math.max(0, exam.endsAt - (Date.now() + offset)) : null;
  const done = exam.students.filter((s) => s.done).length;
  const list = [...exam.students].sort((a, b) => a.name.localeCompare(b.name, "uk"));
  return (
    <div className="ex-page">
      <div className="ex-card ex-running-head">
        <div>
          <h1>{exam.title}</h1>
          <p className="ex-muted">
            Код <b>{exam.code}</b> · {studentUrl.replace(/^https?:\/\//, "")}
          </p>
        </div>
        <div className="ex-big-stats">
          <div>
            <b>
              {done}/{Math.max(exam.students.length, exam.players || 0)}
            </b>
            <span>завершили</span>
          </div>
          {left != null && (
            <div className={left < 60000 ? "hot" : ""}>
              <b>{fmtDuration(left)}</b>
              <span>залишилось</span>
            </div>
          )}
        </div>
        <button
          className="ex-btn danger"
          type="button"
          onClick={() => {
            const notDone = exam.students.length - done;
            if (notDone && !window.confirm(`Ще ${notDone} учн. не завершили. Завершити тест для всіх?`)) return;
            call(socket, "exam:finish", {});
          }}
        >
          Завершити тест
        </button>
      </div>
      <div className="ex-card">
        <table className="ex-table">
          <thead>
            <tr>
              <th>Учень</th>
              <th>Прогрес</th>
              <th>✓</th>
              <th>✗</th>
              <th>Оцінка</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className={s.online || s.done ? "" : "off"}>
                <td>
                  {s.name}
                  {!s.online && !s.done && <span className="ex-tag warn">офлайн</span>}
                </td>
                <td>
                  <div className="ex-progress small">
                    <span style={{ width: `${(s.answered / s.total) * 100}%` }} />
                  </div>
                  <span className="ex-muted small">
                    {s.answered}/{s.total}
                    {s.done ? " ✔" : ""}
                  </span>
                </td>
                <td className="ok">{s.correct}</td>
                <td className="bad">{s.wrong}</td>
                <td>{s.done ? <b>{s.grade}</b> : <span className="ex-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- results

function Finished({ exam, onClose }) {
  const [sort, setSort] = useState("name");
  const [open, setOpen] = useState(null);
  const list = [...exam.students].sort((a, b) =>
    sort === "grade" ? b.grade - a.grade || a.name.localeCompare(b.name, "uk") : a.name.localeCompare(b.name, "uk")
  );
  const n = exam.students.length;
  const avg = n ? exam.students.reduce((t, s) => t + s.grade, 0) / n : 0;
  const avgPct = n ? Math.round(exam.students.reduce((t, s) => t + s.percent, 0) / n) : 0;
  const levels = [
    ["високий (10–12)", (g) => g >= 10],
    ["достатній (7–9)", (g) => g >= 7 && g <= 9],
    ["середній (4–6)", (g) => g >= 4 && g <= 6],
    ["початковий (1–3)", (g) => g <= 3],
  ].map(([label, f]) => [label, exam.students.filter((s) => f(s.grade)).length]);
  const hardest = [...exam.questions].filter((q) => q.answered).sort((a, b) => a.percent - b.percent);
  const csvUrl = `/api/exam/${exam.code}/results.csv?t=${encodeURIComponent(readJSON(TEACHER)?.teacherToken || "")}`;
  const student = open && exam.students.find((s) => s.id === open);

  return (
    <div className="ex-page">
      <div className="ex-card ex-running-head">
        <div>
          <p className="ex-muted">
            {exam.categoryName} · {fmtDate(exam.startedAt)}
          </p>
          <h1>{exam.title} — результати</h1>
        </div>
        <div className="ex-big-stats">
          <div>
            <b>{n}</b>
            <span>учнів</span>
          </div>
          <div>
            <b>{avg.toFixed(1)}</b>
            <span>середній бал</span>
          </div>
          <div>
            <b>{avgPct}%</b>
            <span>правильних</span>
          </div>
        </div>
        <div className="ex-actions col">
          <button className="ex-btn primary" type="button" onClick={() => downloadCsv(csvUrl, null, `${exam.id}.csv`).catch((e) => alert(e.message))}>
            Завантажити CSV (Excel)
          </button>
          <button className="ex-link" type="button" onClick={onClose}>
            Новий тест
          </button>
        </div>
      </div>

      <div className="ex-card ex-levels">
        {levels.map(([label, k]) => (
          <div key={label}>
            <b>{k}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="ex-card">
        <div className="ex-card-head">
          <h2>Учні</h2>
          <span className="ex-sort">
            Сортувати:{" "}
            <button type="button" className={sort === "name" ? "on" : ""} onClick={() => setSort("name")}>
              за ім'ям
            </button>
            <button type="button" className={sort === "grade" ? "on" : ""} onClick={() => setSort("grade")}>
              за оцінкою
            </button>
          </span>
        </div>
        <table className="ex-table">
          <thead>
            <tr>
              <th>Учень</th>
              <th>Оцінка</th>
              <th>✓ прав.</th>
              <th>✗ неправ.</th>
              <th>Без відп.</th>
              <th>%</th>
              <th>Час</th>
              <th>По питаннях</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className="click" onClick={() => setOpen(s.id)}>
                <td>{s.name}</td>
                <td>
                  <b className={`ex-g g${Math.ceil(s.grade / 3)}`}>{s.grade}</b>
                </td>
                <td className="ok">{s.correct}</td>
                <td className="bad">{s.wrong}</td>
                <td>{s.unanswered || ""}</td>
                <td>{s.percent}%</td>
                <td>{fmtDuration(s.timeMs)}</td>
                <td>
                  <span className="ex-marks">
                    {s.marks.map((m, i) => (
                      <i key={i} className={m == null ? "" : m ? "ok" : "bad"} title={`Питання ${i + 1}`} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ex-card">
        <h2>Питання: від найважчого</h2>
        <table className="ex-table ex-qstats">
          <thead>
            <tr>
              <th>№</th>
              <th>Питання</th>
              <th>Правильно</th>
              <th>Найчастіша помилка</th>
            </tr>
          </thead>
          <tbody>
            {hardest.map((q) => (
              <tr key={q.n}>
                <td>{q.n}</td>
                <td>
                  {q.text}
                  <div className="ex-muted small">✓ {q.correctText}</div>
                </td>
                <td>
                  <div className={`ex-pct ${q.percent < 50 ? "bad" : q.percent < 75 ? "mid" : "ok"}`}>
                    <span style={{ width: `${q.percent}%` }} />
                    <b>{q.percent}%</b>
                  </div>
                  <span className="ex-muted small">
                    {q.correct} з {q.answered}
                  </span>
                </td>
                <td>{q.topWrong ? `${q.topWrong.text} (${q.topWrong.count})` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {student && (
        <div className="ex-modal" onClick={() => setOpen(null)}>
          <div className="ex-card" onClick={(e) => e.stopPropagation()}>
            <div className="ex-card-head">
              <h2>{student.name}</h2>
              <button className="ex-x" type="button" onClick={() => setOpen(null)}>
                ×
              </button>
            </div>
            <p>
              Оцінка <b>{student.grade}</b> ({gradeLevel(student.grade)} рівень) · {student.correct} з {student.total} правильних · {fmtDuration(student.timeMs)}
            </p>
            <ol className="ex-detail">
              {exam.questions.map((q, i) => (
                <li key={q.n} className={student.marks[i] == null ? "skip" : student.marks[i] ? "ok" : "bad"}>
                  <span>{student.marks[i] == null ? "—" : student.marks[i] ? "✓" : "✗"}</span> {q.text}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
