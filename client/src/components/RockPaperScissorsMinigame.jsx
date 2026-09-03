import { useEffect, useRef, useState } from "react";
import "./RockPaperScissorsMinigame.css";

/**
 * "Камінь-Ножиці-Папір" — server-authoritative elimination minigame.
 * server/minigames/rps.js runs every round; this component only renders and
 * forwards the player's choice.
 *
 * Events in:  rps:go { startAt, serverNow }
 *             rps:round { round, alive, deadlineAt, choiceMs }
 *             rps:locked { round, choice }
 *             rps:progress { round, submitted, total }
 *             rps:reveal { round, choices, winningChoice, continued, eliminated, replay }
 * Event out:  minigameEvent { name: "rps:choose", data: { choice } }
 */
const OPTIONS = [
  { id: "rock", emoji: "🪨", label: "КАМІНЬ" },
  { id: "paper", emoji: "📄", label: "ПАПІР" },
  { id: "scissors", emoji: "✂️", label: "НОЖИЦІ" },
];
const EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };
const LABEL = { rock: "КАМІНЬ", paper: "ПАПІР", scissors: "НОЖИЦІ" };

export default function RockPaperScissorsMinigame({
  socket,
  uiMode = "mobile",
  isActive,
  myPlayerId,
  namesById = {},
  contestantIds = [],
  results,
  onSceneDone,
  onVideoStartedAt,
}) {
  const isDisplay = uiMode === "display";
  const amContestant = contestantIds.includes(myPlayerId);

  const [go, setGo] = useState(null); // { startAt, offset }
  const [round, setRound] = useState(null); // { round, alive }
  const [myChoice, setMyChoice] = useState(null);
  const [progress, setProgress] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [eliminated, setEliminated] = useState(false);
  const [now, setNow] = useState(0);
  const sceneDoneRef = useRef(false);

  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = setTimeout(() => onVideoStartedAt(), 300);
    return () => clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return;
    const onGo = (d) =>
      setGo({
        startAt: Number(d.startAt),
        offset: Number(d.serverNow ?? Date.now()) - Date.now(),
      });
    const onRound = (d) => {
      setRound(d);
      setReveal(null);
      setProgress(null);
      setMyChoice(null);
      if (myPlayerId && Array.isArray(d.alive) && !d.alive.includes(myPlayerId)) {
        setEliminated(true);
      }
    };
    const onLocked = (d) => setMyChoice(d.choice);
    const onProgress = (d) => setProgress(d);
    const onReveal = (d) => {
      setReveal(d);
      if (myPlayerId && (d.eliminated || []).includes(myPlayerId)) setEliminated(true);
    };
    socket.on("rps:go", onGo);
    socket.on("rps:round", onRound);
    socket.on("rps:locked", onLocked);
    socket.on("rps:progress", onProgress);
    socket.on("rps:reveal", onReveal);
    return () => {
      socket.off("rps:go", onGo);
      socket.off("rps:round", onRound);
      socket.off("rps:locked", onLocked);
      socket.off("rps:progress", onProgress);
      socket.off("rps:reveal", onReveal);
    };
  }, [socket, myPlayerId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!results || results.minigameId !== "rps" || !isDisplay) return;
    if (sceneDoneRef.current) return;
    const t = setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, 6500);
    return () => clearTimeout(t);
  }, [results, isDisplay, onSceneDone]);

  const serverNow = go ? now + go.offset : 0;
  const countdownNum =
    go && !round && serverNow < go.startAt
      ? Math.max(1, Math.ceil((go.startAt - serverNow) / 1000))
      : null;
  const choiceSecsLeft =
    round && round.deadlineAt
      ? Math.max(0, Math.ceil((round.deadlineAt - serverNow) / 1000))
      : null;

  const choose = (id) => {
    if (myChoice || eliminated || reveal) return;
    setMyChoice(id); // optimistic
    socket?.emit("minigameEvent", { name: "rps:choose", data: { choice: id } });
  };

  const nm = (id) => namesById[id] || "Гравець";
  const cls = isDisplay ? "rps-display" : "rps-mobile";

  // ---------------------------------------------------------------- end screen
  if (results && results.minigameId === "rps") {
    const winner = results.winnerId;
    const loser = results.lifeLoserId;
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-end">
          <h2 className="rps-title">КАМІНЬ-НОЖИЦІ-ПАПІР</h2>
          {winner && <p className="rps-winner">🏆 {nm(winner)} — переможець!</p>}
          {loser && <p className="rps-verdict">{nm(loser)} вилетів останнім і втрачає життя!</p>}
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- not active
  if (!isActive || !go) {
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-wait">
          {isDisplay ? "Камінь-Ножиці-Папір — приготуйтесь…" : "Дивіться на головний екран"}
        </div>
      </section>
    );
  }

  // ------------------------------------------------ instruction + 3-2-1 countdown
  if (countdownNum != null) {
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-instruction">
          <h3>КАМІНЬ-НОЖИЦІ-ПАПІР</h3>
          <p>🪨 Камінь б'є ножиці · ✂️ Ножиці б'ють папір · 📄 Папір б'є камінь</p>
          <p>Усі обирають одночасно, вибір прихований до розкриття.</p>
          <p>Хто програв раунд — вибуває. Граємо, доки не лишиться один.</p>
          <p>Хто вилетить <b>останнім</b> — втрачає життя.</p>
        </div>
        {countdownNum <= 3 ? (
          <div className="rps-countdown">{countdownNum}</div>
        ) : (
          <div className="rps-getready">Приготуйся… {countdownNum}</div>
        )}
      </section>
    );
  }

  // ---------------------------------------------------------------- reveal
  if (reveal) {
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-reveal">
          <div className="rps-reveal-grid">
            {Object.entries(reveal.choices).map(([id, c]) => (
              <div
                key={id}
                className={`rps-reveal-card ${
                  (reveal.eliminated || []).includes(id) ? "rps-out" : "rps-in"
                }`}
              >
                <span className="rps-reveal-emoji">{EMOJI[c]}</span>
                <span className="rps-reveal-name">{nm(id)}</span>
              </div>
            ))}
          </div>
          {reveal.replay ? (
            <p className="rps-outcome">Нічия — граємо ще раз!</p>
          ) : (
            <>
              <p className="rps-outcome">{LABEL[reveal.winningChoice]} перемагає</p>
              <p className="rps-outcome-sub">
                Далі: {(reveal.continued || []).map(nm).join(", ")}
                {" · "}
                Вилетіли: {(reveal.eliminated || []).map(nm).join(", ")}
              </p>
            </>
          )}
          {!isDisplay && eliminated && <p className="rps-status rps-status-out">ВИЛЕТІВ</p>}
          {!isDisplay && !eliminated && !reveal.replay && (
            <p className="rps-status rps-status-in">ТИ ПРОЙШОВ ДАЛІ!</p>
          )}
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- choosing
  const aliveCount = round?.alive?.length ?? 0;

  if (isDisplay) {
    return (
      <section className={`rps-root ${cls}`}>
        <h3 className="rps-title">КАМІНЬ-НОЖИЦІ-ПАПІР</h3>
        <p className="rps-round-line">
          Раунд {round?.round} · {aliveCount}{" "}
          {aliveCount === 1 ? "гравець" : "гравців"} обирають…
        </p>
        {progress && (
          <p className="rps-progress">
            {progress.submitted} / {progress.total}
          </p>
        )}
        {choiceSecsLeft != null && <p className="rps-timer">⏱ {choiceSecsLeft}</p>}
      </section>
    );
  }

  if (eliminated) {
    return (
      <section className={`rps-root ${cls}`}>
        <p className="rps-status rps-status-out">ВИЛЕТІВ</p>
        <p className="rps-wait">Дивіться на головний екран</p>
      </section>
    );
  }

  if (!amContestant) {
    return (
      <section className={`rps-root ${cls}`}>
        <p className="rps-wait">
          Ти відповів правильно — цей конкурс серед тих, хто помилився.
          Дивись на екран!
        </p>
      </section>
    );
  }

  return (
    <section className={`rps-root ${cls}`}>
      <p className="rps-round-line">Раунд {round?.round}</p>
      {choiceSecsLeft != null && <p className="rps-timer">⏱ {choiceSecsLeft}</p>}
      {myChoice ? (
        <div className="rps-locked">
          <span className="rps-locked-emoji">{EMOJI[myChoice]}</span>
          <p>Вибір зроблено. Чекаємо на інших…</p>
        </div>
      ) : (
        <div className="rps-choices">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className="rps-choice"
              onClick={() => choose(o.id)}
            >
              <span className="rps-choice-emoji">{o.emoji}</span>
              <span className="rps-choice-label">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
