import { useEffect, useMemo, useRef, useState } from "react";
import "./MathRushMinigame.css";

/**
 * "Матем-Раш" — server-authoritative arithmetic sprint.
 *
 * The server (server/minigames/mathRush.js) owns the questions, scoring and the
 * clock. This component only renders and forwards taps.
 *
 * Events in:  mathRush:go { playStartAt, playEndAt, serverNow }
 *             mathRush:question { seq, text, options, score, prev? }   (mobile, per-player)
 *             mathRush:scores { scoresById }                            (live leaderboard)
 * Event out:  minigameEvent { name: "mathRush:answer", data: { seq, choice } }
 */
export default function MathRushMinigame({
  socket,
  uiMode = "mobile",
  isActive,
  myPlayerId,
  namesById = {},
  results,
  onSceneDone,
  onVideoStartedAt,
}) {
  const isDisplay = uiMode === "display";
  const [go, setGo] = useState(null); // { playStartAt, playEndAt, offset }
  const [question, setQuestion] = useState(null);
  const [liveScores, setLiveScores] = useState({});
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState(null); // "correct" | "wrong" | null
  const flashTimer = useRef(null);
  const sceneDoneRef = useRef(false);

  // Display: ask the server for the shared clock shortly after mount.
  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = setTimeout(() => onVideoStartedAt(), 300);
    return () => clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return;
    const onGo = (d) => {
      if (!d || !Number.isFinite(Number(d.playStartAt))) return;
      setGo({
        playStartAt: Number(d.playStartAt),
        playEndAt: Number(d.playEndAt),
        offset: Number(d.serverNow ?? Date.now()) - Date.now(),
      });
    };
    const onQuestion = (d) => {
      setQuestion(d);
      if (d?.prev) {
        setFlash(d.prev.correct ? "correct" : "wrong");
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 260);
      }
    };
    const onScores = (d) => setLiveScores(d?.scoresById || {});
    socket.on("mathRush:go", onGo);
    socket.on("mathRush:question", onQuestion);
    socket.on("mathRush:scores", onScores);
    return () => {
      socket.off("mathRush:go", onGo);
      socket.off("mathRush:question", onQuestion);
      socket.off("mathRush:scores", onScores);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [socket]);

  // 10fps clock for the countdown / timer
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, []);

  const serverNow = go ? Date.now() + go.offset : 0;
  const beforeStart = go && serverNow < go.playStartAt;
  const ended = go && serverNow >= go.playEndAt;
  const countdownNum = beforeStart
    ? Math.max(1, Math.ceil((go.playStartAt - serverNow) / 1000))
    : null;
  const secsLeft = go ? Math.max(0, Math.ceil((go.playEndAt - serverNow) / 1000)) : 0;
  void tick;

  // End screen once results arrive.
  useEffect(() => {
    if (!results || results.minigameId !== "mathRush" || !isDisplay) return;
    if (sceneDoneRef.current) return;
    const t = setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, 6500);
    return () => clearTimeout(t);
  }, [results, isDisplay, onSceneDone]);

  const answer = (idx) => {
    if (!question || ended || beforeStart) return;
    socket?.emit("minigameEvent", {
      name: "mathRush:answer",
      data: { seq: question.seq, choice: idx },
    });
  };

  const ranked = useMemo(() => {
    const src =
      results && results.minigameScores
        ? results.minigameScores
        : liveScores;
    return Object.entries(src)
      .map(([id, score]) => ({ id, score, name: namesById[id] || "Гравець" }))
      .sort((a, b) => b.score - a.score);
  }, [results, liveScores, namesById]);

  // ---------------------------------------------------------------- end screen
  if (results && results.minigameId === "mathRush") {
    const loserId = (results.loserIds || [])[0];
    const medals = ["🥇", "🥈", "🥉"];
    const saved = (results.savedFailerIds || []).map((id) => namesById[id] || "Гравець");
    return (
      <section className={`mathrush-root ${isDisplay ? "mathrush-display" : "mathrush-mobile"}`}>
        <div className="mathrush-end">
          <h2 className="mathrush-title">МАТЕМ-РАШ ЗАВЕРШЕНО!</h2>
          <ol className="mathrush-podium">
            {ranked.map((r, i) => (
              <li
                key={r.id}
                className={r.id === loserId ? "mathrush-podium-loser" : ""}
              >
                <span className="mathrush-medal">
                  {r.id === loserId ? "💀" : medals[i] || "•"}
                </span>
                <span className="mathrush-podium-name">{r.name}</span>
                <span className="mathrush-podium-score">{r.score}</span>
              </li>
            ))}
          </ol>
          {loserId && (
            <p className="mathrush-verdict">
              {namesById[loserId] || "Гравець"} втрачає життя!
            </p>
          )}
          {saved.length > 0 && (
            <p className="mathrush-saved">
              {saved.join(", ")} помилив{saved.length > 1 ? "ись" : "ся"} у питанні,
              але вижив{saved.length > 1 ? "ли" : ""} у Матем-Раші.
            </p>
          )}
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- not started
  if (!isActive || !go) {
    return (
      <section className={`mathrush-root ${isDisplay ? "mathrush-display" : "mathrush-mobile"}`}>
        <div className="mathrush-wait">
          {isDisplay ? "Матем-Раш — приготуйтесь…" : "Дивіться на головний екран"}
        </div>
      </section>
    );
  }

  // ------------------------------------------------ instruction + 3-2-1 countdown
  if (countdownNum != null) {
    return (
      <section className={`mathrush-root ${isDisplay ? "mathrush-display" : "mathrush-mobile"}`}>
        <div className="mathrush-instruction">
          <h3>МАТЕМ-РАШ</h3>
          <p>На екрані з'являється приклад: <b>7 + 8 = ?</b></p>
          <p>Тисни правильну відповідь із чотирьох — і одразу з'явиться наступний приклад.</p>
          <p><b>+1 бал</b> за кожну правильну відповідь. За неправильну бал не втрачається.</p>
          <p>Хто набере <b>найменше балів</b> — втрачає життя.</p>
        </div>
        {countdownNum <= 3 ? (
          <div className="mathrush-countdown">{countdownNum}</div>
        ) : (
          <div className="mathrush-getready">Приготуйся… {countdownNum}</div>
        )}
      </section>
    );
  }

  // ---------------------------------------------------------------- playing
  return (
    <section
      className={`mathrush-root ${isDisplay ? "mathrush-display" : "mathrush-mobile"} ${
        flash ? `mathrush-flash-${flash}` : ""
      }`}
    >
      <div className="mathrush-topbar">
        <span className="mathrush-timer">⏱ {secsLeft}</span>
        {!isDisplay && question && (
          <span className="mathrush-score">✓ {question.score}</span>
        )}
      </div>

      {ended ? (
        <div className="mathrush-wait">Час вийшов! Підрахунок…</div>
      ) : isDisplay ? (
        <div className="mathrush-board">
          <h3 className="mathrush-title">МАТЕМ-РАШ</h3>
          <ol className="mathrush-scoreboard">
            {ranked.map((r) => (
              <li key={r.id}>
                <span>{r.name}</span>
                <span className="mathrush-scoreboard-score">{r.score}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : question ? (
        <div className="mathrush-play">
          <div className="mathrush-equation">{question.text} = ?</div>
          <div className="mathrush-options">
            {question.options.map((opt, i) => (
              <button
                key={`${question.seq}-${i}`}
                type="button"
                className="mathrush-option"
                onClick={() => answer(i)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mathrush-wait">…</div>
      )}
    </section>
  );
}
