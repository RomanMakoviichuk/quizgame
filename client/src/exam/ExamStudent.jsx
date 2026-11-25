import { useEffect, useRef, useState } from "react";
import "./exam.css";
import { connectExam, call, readJSON, writeJSON, gradeLevel, fmtDuration } from "./examApi";

/**
 * The student's page (/test, on a phone): code + name → wait → the questions one by
 * one (pick, then «Відповісти») → the grade. The seat is remembered, so a reload,
 * a locked screen or a lost Wi-Fi brings the student back to the same question.
 */
const SESSION = "quizgame_exam_session";
const LETTERS = "АБВГДЕЖ";

export default function ExamStudent() {
  const params = new URLSearchParams(window.location.search);
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [st, setSt] = useState(null); // the server's view of me
  const [code, setCode] = useState(params.get("code") || readJSON(SESSION)?.code || "");
  const [name, setName] = useState(readJSON("quizgame_exam_name") || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null);
  const [sending, setSending] = useState(false);
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  const stRef = useRef(null);

  const apply = (view) => {
    if (!view) return;
    stRef.current = view;
    setSt(view);
    if (Number.isFinite(view.serverNow)) setOffset(view.serverNow - Date.now());
  };

  useEffect(() => {
    const s = connectExam();
    setSocket(s);
    const resume = async () => {
      const saved = readJSON(SESSION);
      if (!saved) return;
      const r = await call(s, "exam:resume", saved);
      if (r.error) {
        if (r.error !== "timeout") writeJSON(SESSION, null);
        return;
      }
      apply(r.state);
    };
    s.on("connect", () => {
      setConnected(true);
      resume();
    });
    s.on("disconnect", () => setConnected(false));
    s.on("exam:state", apply);
    s.on("exam:kicked", () => {
      writeJSON(SESSION, null);
      setSt(null);
      setError("Вчитель прибрав вас із тесту. Увійдіть ще раз з правильним ім'ям.");
    });
    // a phone that slept: the connection may be stale — take the state again
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (s.connected) resume();
      else s.connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      s.close();
    };
  }, []);

  // a new question: nothing picked yet
  const qKey = st?.phase === "question" ? st.position : -1;
  useEffect(() => {
    setPicked(null);
    setSending(false);
  }, [qKey]);

  // the countdown, when the test has a time limit
  useEffect(() => {
    if (!st?.endsAt || st.phase !== "question") return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [st?.endsAt, st?.phase]);

  const join = async (e) => {
    e.preventDefault();
    if (!socket || busy) return;
    setError("");
    const c = code.trim();
    const n = name.replace(/\s+/g, " ").trim();
    if (!/^\d{4,5}$/.test(c)) return setError("Код — це 4 цифри з екрана вчителя.");
    if (n.length < 3) return setError("Вкажіть прізвище та ім'я.");
    setBusy(true);
    const r = await call(socket, "exam:join", { code: c, name: n });
    setBusy(false);
    if (r.error) return setError(r.error === "timeout" ? "Немає зв'язку з сервером. Спробуйте ще раз." : r.error);
    writeJSON(SESSION, { code: r.code, studentId: r.studentId, token: r.token });
    writeJSON("quizgame_exam_name", n);
    apply(r.state);
  };

  const send = async () => {
    if (picked == null || sending || !st) return;
    setSending(true);
    const r = await call(socket, "exam:answer", { position: st.position, choice: picked });
    if (r.error === "no-seat" || r.error === "timeout") {
      // the connection came back without the seat yet: take it and try once more
      const saved = readJSON(SESSION);
      if (saved) {
        const back = await call(socket, "exam:resume", saved);
        if (!back.error) {
          apply(back.state);
          if (back.state?.phase === "question" && back.state.position === st.position) {
            const again = await call(socket, "exam:answer", { position: st.position, choice: picked });
            if (!again.error) return;
          } else return;
        }
      }
      setSending(false);
      setError("Немає зв'язку. Перевірте інтернет і натисніть ще раз.");
      return;
    }
    setError("");
    if (r.stale) {
      // this phone was behind: take the current state
      const saved = readJSON(SESSION);
      const back = saved ? await call(socket, "exam:resume", saved) : null;
      if (back && !back.error) apply(back.state);
      setSending(false);
      return;
    }
    if (!r.ok) setSending(false); // "closed": the final state is on its way
    // ok: the next question arrives as exam:state
  };

  const leave = () => {
    writeJSON(SESSION, null);
    setSt(null);
    setError("");
  };

  // ---------------------------------------------------------------- screens
  const header = (
    <header className="ex-top">
      <span className="ex-brand">Перевірка знань</span>
      <span className={`ex-dot ${connected ? "on" : ""}`} title={connected ? "На зв'язку" : "Немає зв'язку"} />
    </header>
  );

  if (!st) {
    return (
      <div className="ex-root ex-student">
        {header}
        <form className="ex-card ex-join" onSubmit={join}>
          <h1>Вхід у тест</h1>
          <label>
            Код тесту
            <input inputMode="numeric" autoComplete="off" maxLength={5} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="1234" />
          </label>
          <label>
            Прізвище та ім'я
            <input autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Шевченко Тарас" />
          </label>
          {error && <p className="ex-error">{error}</p>}
          <button className="ex-btn primary" disabled={busy || !connected}>
            {connected ? (busy ? "Входимо…" : "Увійти") : "З'єднання…"}
          </button>
        </form>
      </div>
    );
  }

  if (st.phase === "waiting") {
    return (
      <div className="ex-root ex-student">
        {header}
        <div className="ex-card ex-center">
          {st.categoryName !== st.title && <p className="ex-muted">{st.categoryName}</p>}
          <h1>{st.title}</h1>
          <p className="ex-name">{st.name}</p>
          <div className="ex-spinner" />
          <p>Очікуйте — вчитель скоро почне тест.</p>
          <p className="ex-muted small">Питань: {st.total}. Відповідь не можна змінити після «Відповісти».</p>
          <button className="ex-link" onClick={leave} type="button">Це не я — вийти</button>
        </div>
      </div>
    );
  }

  if (st.phase === "question") {
    const q = st.question;
    const left = st.endsAt ? Math.max(0, st.endsAt - (Date.now() + offset)) : null;
    return (
      <div className="ex-root ex-student">
        {header}
        <div className="ex-card ex-q">
          <div className="ex-q-head">
            <span>
              Питання <b>{st.position + 1}</b> з {st.total}
            </span>
            {left != null && <span className={`ex-timer ${left < 60000 ? "hot" : ""}`}>⏱ {fmtDuration(left)}</span>}
          </div>
          <div className="ex-progress">
            <span style={{ width: `${(st.position / st.total) * 100}%` }} />
          </div>
          <h2 className="ex-q-text">{q.text}</h2>
          <div className="ex-options">
            {q.options.map((o, i) => (
              <button key={i} type="button" className={`ex-option ${picked === i ? "picked" : ""}`} onClick={() => !sending && setPicked(i)}>
                <span className="ex-letter">{LETTERS[i]}</span>
                <span className="ex-opt-text">{o}</span>
              </button>
            ))}
          </div>
          {error && <p className="ex-error">{error}</p>}
          <button className="ex-btn primary ex-send" disabled={picked == null || sending} onClick={send} type="button">
            {sending ? "Надсилаємо…" : st.position + 1 === st.total ? "Відповісти й завершити" : "Відповісти"}
          </button>
        </div>
      </div>
    );
  }

  // done
  const r = st.result;
  return (
    <div className="ex-root ex-student">
      {header}
      <div className="ex-card ex-center ex-done">
        <p className="ex-muted">{st.title}</p>
        <p className="ex-name">{st.name}</p>
        <div className={`ex-grade g${Math.ceil(r.grade / 3)}`}>
          <b>{r.grade}</b>
          <span>з 12</span>
        </div>
        <p className="ex-level">Рівень: {gradeLevel(r.grade)}</p>
        <div className="ex-stats">
          <div className="ok">
            <b>{r.correct}</b>
            <span>правильних</span>
          </div>
          <div className="bad">
            <b>{r.wrong}</b>
            <span>неправильних</span>
          </div>
          {r.unanswered > 0 && (
            <div className="skip">
              <b>{r.unanswered}</b>
              <span>без відповіді</span>
            </div>
          )}
        </div>
        <p className="ex-muted">
          {r.percent}% правильних · час {fmtDuration(r.timeMs)}
        </p>
        {!st.examOver && <p className="ex-muted small">Правильні відповіді з'являться тут, коли вчитель завершить тест.</p>}
      </div>
      {st.review && (
        <div className="ex-card ex-review">
          <h3>Розбір відповідей</h3>
          <ol>
            {st.review.map((it) => (
              <li key={it.n} className={it.correct ? "ok" : "bad"}>
                <p className="ex-review-q">{it.text}</p>
                {it.correct ? (
                  <p>✓ {it.correctText}</p>
                ) : (
                  <>
                    <p className="yours">✗ {it.yours ?? "без відповіді"}</p>
                    <p className="right">✓ {it.correctText}</p>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {st.examOver && (
        <button className="ex-link" onClick={leave} type="button">
          Вийти
        </button>
      )}
    </div>
  );
}
