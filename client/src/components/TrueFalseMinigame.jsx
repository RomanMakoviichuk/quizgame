import { memo, useEffect, useMemo, useRef, useState } from "react";
import "./TrueFalseMinigame.css";
import gameClock from "../game/gameClock";
import FadeVideo from "./FadeVideo";

const TOTAL_PLAY_SECONDS = 30;
const FREEZE_SECONDS = 3;
const COUNTDOWN_START_AT_VIDEO_SEC = 12; // 3-2-1 стартує на 12-й секунді відео

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
};

// The statements come from the server with "trueFalseStart" (server/data/trueFalse.json,
// never repeated between games until all have been played). Each phone shuffles
// its own copy, so neighbours don't get the same order.
const FALLBACK_STATEMENTS = [{ text: "Земля обертається навколо Сонця", isTrue: true }];

export default function TrueFalseMinigame({
  isActive,
  canAnswer = true,
  onFinish,
  roundIndex,
  uiMode = "mobile", // "mobile" | "display"
  showVideoBg,
  useVideoClock,
  onVideoStartedAt,
  syncData, // { startedAtTs, serverTime, receivedAt } — server-generated for sync
  socket,
  namesById = {},
  slotsById = {},
  contestantIds = [],
  statements = null,
}) {
  const isDisplay = uiMode === "display";
  const videoRef = useRef(null);
  const didVideoStartRef = useRef(false);
  const countdownStartedRef = useRef(false);
  const finishedRef = useRef(false);
  const freezeTimeoutRef = useRef(null);

  const resolvedShowVideoBg =
    typeof showVideoBg === "boolean"
      ? showVideoBg
      : uiMode === "display";
  // Sync by server timestamp + offset so all devices share the same reference.
  const resolvedUseVideoClock = false;

  // Fallback: if syncData doesn't arrive on mobile within 2.5s, use local time so the game can start.
  const [fallbackSyncData, setFallbackSyncData] = useState(null);
  useEffect(() => {
    if (uiMode !== "mobile" || !isActive || syncData) return;
    const id = gameClock.setTimeout(() => {
      setFallbackSyncData({
        startedAtTs: gameClock.now(),
        serverTime: gameClock.now(),
        receivedAt: gameClock.now(),
      });
    }, 2500);
    return () => gameClock.clearTimeout(id);
  }, [uiMode, isActive, syncData]);

  const resolvedSyncData = syncData ?? fallbackSyncData;

  const serverOffset = useMemo(() => {
    if (resolvedSyncData?.serverTime == null || resolvedSyncData?.receivedAt == null) return null;
    const st = Number(resolvedSyncData.serverTime);
    const ra = Number(resolvedSyncData.receivedAt);
    if (!Number.isFinite(st) || !Number.isFinite(ra)) return null;
    return st - ra; // client_clock + offset ≈ server_clock
  }, [resolvedSyncData?.serverTime, resolvedSyncData?.receivedAt]);

  const [countdownNumber, setCountdownNumber] = useState(null); // 3|2|1|null
  const [gameStarted, setGameStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TOTAL_PLAY_SECONDS);
  const [isFinished, setIsFinished] = useState(false);

  const [isFrozen, setIsFrozen] = useState(false);
  const [score, setScore] = useState(0);
  const [questionIdx, setQuestionIdx] = useState(0);

  const shuffledQuestions = useMemo(
    () => (statements?.length ? shuffle(statements) : FALLBACK_STATEMENTS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roundIndex, statements?.length, statements?.[0]?.text]
  );

  useEffect(() => {
    setCountdownNumber(null);
    setGameStarted(false);
    setTimeLeft(TOTAL_PLAY_SECONDS);
    setIsFrozen(false);
    setScore(0);
    setQuestionIdx(0);
    setFallbackSyncData(null);
    finishedRef.current = false;
    setIsFinished(false);
    countdownStartedRef.current = false;
    didVideoStartRef.current = false;

    const scheduleCountdownStep = (targetTs, fn) => {
      const ms = Math.max(0, targetTs - (gameClock.now() + serverOffset));
      return gameClock.setTimeout(fn, ms);
    };

    if (resolvedUseVideoClock) {
      const v = videoRef.current;
      if (!v) return;

      try {
        v.currentTime = 0;
      } catch {}

      const startCountdownSequence = () => {
        if (countdownStartedRef.current) return;
        countdownStartedRef.current = true;
        setCountdownNumber(3);
        gameClock.setTimeout(() => setCountdownNumber(2), 1000);
        gameClock.setTimeout(() => setCountdownNumber(1), 2000);
        gameClock.setTimeout(() => {
          setCountdownNumber(null);
          setGameStarted(true);
        }, 3000);
      };

      const onTimeUpdate = () => {
        if (!isActive) return;
        if (countdownStartedRef.current) return;
        if (v.currentTime >= COUNTDOWN_START_AT_VIDEO_SEC) {
          startCountdownSequence();
        }
      };

      v.addEventListener("timeupdate", onTimeUpdate);
      v.play().catch(() => {});

      return () => {
        v.removeEventListener("timeupdate", onTimeUpdate);
        try {
          if (freezeTimeoutRef.current) gameClock.clearTimeout(freezeTimeoutRef.current);
        } catch {}
      };
    }

    // Schedule 3-2-1 and game start by server time so all devices stay in sync.
    if (isActive && resolvedSyncData && serverOffset != null) {
      const base = Number(resolvedSyncData.startedAtTs);
      if (!Number.isFinite(base)) return;
      const t0 = base + COUNTDOWN_START_AT_VIDEO_SEC * 1000;
      const ids = [
        scheduleCountdownStep(t0, () => {
          if (!isActive) return;
          if (countdownStartedRef.current) return;
          countdownStartedRef.current = true;
          setCountdownNumber(3);
        }),
        scheduleCountdownStep(t0 + 1000, () => {
          if (!isActive) return;
          setCountdownNumber(2);
        }),
        scheduleCountdownStep(t0 + 2000, () => {
          if (!isActive) return;
          setCountdownNumber(1);
        }),
        scheduleCountdownStep(t0 + 3000, () => {
          if (!isActive) return;
          setCountdownNumber(null);
          setGameStarted(true);
        }),
      ];
      return () => {
        ids.forEach((id) => gameClock.clearTimeout(id));
        try {
          if (freezeTimeoutRef.current) gameClock.clearTimeout(freezeTimeoutRef.current);
        } catch {}
      };
    }

    return () => {
      try {
        if (freezeTimeoutRef.current) gameClock.clearTimeout(freezeTimeoutRef.current);
      } catch {}
    };
  }, [isActive, roundIndex, resolvedUseVideoClock, resolvedSyncData, serverOffset]);

  // Derive timeLeft from server time so all devices show the same value.
  const gameStartTs =
    resolvedSyncData?.startedAtTs != null && Number.isFinite(Number(resolvedSyncData.startedAtTs))
      ? Number(resolvedSyncData.startedAtTs) + COUNTDOWN_START_AT_VIDEO_SEC * 1000 + 3000
      : null; // +3s for 3-2-1 countdown

  useEffect(() => {
    if (!isActive || !gameStarted) return;
    if (gameStartTs == null || serverOffset == null) return;

    const tick = () => {
      const sn = gameClock.now() + serverOffset;
      const elapsed = (sn - gameStartTs) / 1000;
      const left = Math.max(0, Math.ceil(TOTAL_PLAY_SECONDS - elapsed));
      setTimeLeft(left);
    };
    tick();
    const id = gameClock.setInterval(tick, 200);
    return () => gameClock.clearInterval(id);
  }, [isActive, gameStarted, gameStartTs, serverOffset]);

  useEffect(() => {
    if (!isActive) return;
    if (!gameStarted) return;
    if (timeLeft > 0) return;
    if (finishedRef.current) return;
    finishedRef.current = true;
    setIsFinished(true);
    onFinish?.(score);
  }, [isActive, gameStarted, timeLeft, onFinish, score, questionIdx]);

  const currentQ = shuffledQuestions[questionIdx % shuffledQuestions.length];

  // ---- phone: streak, flash, freeze countdown, live progress to the TV
  const [streak, setStreak] = useState(0);
  const [flash, setFlash] = useState(null); // { kind, n }
  const [missed, setMissed] = useState(null); // the statement you got wrong + its truth
  const [, setFrameTick] = useState(0);
  const freezeUntilRef = useRef(0);

  const sendProgress = (nextScore, frozen) => {
    socket?.emit("minigameEvent", { name: "tf:progress", data: { score: nextScore, frozen } });
  };

  // re-render 4x/s while frozen so the thaw counter moves
  useEffect(() => {
    if (!isFrozen) return;
    const id = gameClock.setInterval(() => setFrameTick((t) => t + 1), 250);
    return () => gameClock.clearInterval(id);
  }, [isFrozen]);

  const answer = (pickedIsTrue) => {
    if (!isActive) return;
    if (!canAnswer) return;
    if (!gameStarted) return;
    if (isFrozen) return;
    if (!currentQ) return;

    const correct = pickedIsTrue === currentQ.isTrue;
    setFlash((f) => ({ kind: correct ? "correct" : "wrong", n: (f?.n || 0) + 1 }));
    if (correct) {
      sfx("/assets/sounds/click.mp3", 0.5);
      setStreak((n) => n + 1);
      setScore((s) => s + 1);
      setQuestionIdx((i) => i + 1);
      sendProgress(score + 1, false);
      return;
    }

    sfx("/assets/sounds/beep.mp3", 0.35);
    setStreak(0);
    setMissed({ text: currentQ.text, isTrue: currentQ.isTrue });
    setIsFrozen(true);
    sendProgress(score, true);
    freezeUntilRef.current = gameClock.now() + FREEZE_SECONDS * 1000;
    freezeTimeoutRef.current = gameClock.setTimeout(() => {
      setIsFrozen(false);
      setMissed(null);
      setQuestionIdx((i) => i + 1);
      sendProgress(score, false);
    }, FREEZE_SECONDS * 1000);
  };

  // ---- TV: live scores from the phones
  const [live, setLive] = useState({});
  useEffect(() => {
    if (!socket || !isDisplay) return;
    const onLive = (d) => setLive(d?.byId || {});
    socket.on("trueFalse:live", onLive);
    return () => socket.off("trueFalse:live", onLive);
  }, [socket, isDisplay]);

  // TV: 3-2-1 beeps and a ticking last 5 seconds
  const beepRef = useRef(null);
  const beepKey =
    countdownNumber != null
      ? `c${countdownNumber}`
      : gameStarted && timeLeft > 0 && timeLeft <= 5
      ? `e${timeLeft}`
      : null;
  useEffect(() => {
    if (!isDisplay || !beepKey || beepRef.current === beepKey) return;
    beepRef.current = beepKey;
    sfx("/assets/sounds/beep.mp3", 0.45);
  }, [isDisplay, beepKey]);

  // Fallback: if `onPlay` doesn't fire for some reason, emit a sync timestamp shortly after mount.
  useEffect(() => {
    if (uiMode !== "display") return;
    if (!isActive) return;
    if (didVideoStartRef.current) return;
    if (!onVideoStartedAt) return;

    const id = gameClock.setTimeout(() => {
      if (didVideoStartRef.current) return;
      didVideoStartRef.current = true;
      onVideoStartedAt(gameClock.now());
    }, 500);
    return () => gameClock.clearTimeout(id);
  }, [uiMode, isActive, onVideoStartedAt]);

  const thawIn = isFrozen ? Math.max(1, Math.ceil((freezeUntilRef.current - gameClock.now()) / 1000)) : 0;
  const instructing = isActive && !gameStarted && countdownNumber == null;
  const Brand = ({ small }) => (
    <header className={`tf-brand ${small ? "small" : ""}`}>
      <span className="tf-word-true">ПРАВДА</span>
      <span className="tf-or">чи</span>
      <span className="tf-word-false">БРЕХНЯ</span>
    </header>
  );

  return (
    <section
      className={`tf-root ${isDisplay ? "tf-display" : "tf-mobile"} ${
        flash && !isDisplay ? `tf-flash-${flash.kind}` : ""
      } ${isFrozen ? "tf-frozen" : ""}`}
    >
      {resolvedShowVideoBg && (
        <FadeVideo
          className="tf-video"
          ref={videoRef}
          src="/assets/minigames/true-false/game.mp4"
          autoPlay
          playsInline
          preload="auto"
          muted={false}
          onPlay={() => {
            if (didVideoStartRef.current) return;
            didVideoStartRef.current = true;
            onVideoStartedAt?.(gameClock.now());
          }}
        />
      )}
      {isDisplay ? <div className="tf-vignette" /> : <div className="tf-stage-bg" />}

      {/* ------------------------------------------------ TV */}
      {isDisplay && (
        <>
          {Brand({ small: gameStarted })}

          {instructing && (
            <>
              <aside className="tf-side tf-side-left">
                <div className="tf-rule" style={{ animationDelay: "0.4s" }}>
                  <div className="tf-rule-head">
                    <b className="t">ПРАВДА</b>
                    <span>або</span>
                    <b className="f">БРЕХНЯ</b>
                  </div>
                  <p>тисни на телефоні, поки не скінчиться час</p>
                </div>
                <div className="tf-rule" style={{ animationDelay: "0.9s" }}>
                  <div className="tf-rule-head">
                    <b className="ok">+1</b>
                  </div>
                  <p>за кожну правильну відповідь</p>
                </div>
              </aside>
              <aside className="tf-side tf-side-right">
                <div className="tf-rule" style={{ animationDelay: "1.4s" }}>
                  <div className="tf-rule-head">
                    <b className="ice">❄ 3 с</b>
                  </div>
                  <p>помилка заморожує телефон</p>
                </div>
                <div className="tf-rule" style={{ animationDelay: "1.9s" }}>
                  <div className="tf-rule-head">
                    <b className="bad">💀</b>
                  </div>
                  <p>найменше балів — мінус життя</p>
                </div>
              </aside>
            </>
          )}

          {gameStarted && (
            <>
              <TfTimer timeLeft={timeLeft} total={TOTAL_PLAY_SECONDS} />
              <LiveBoard
                ids={contestantIds}
                live={live}
                namesById={namesById}
                slotsById={slotsById}
                done={timeLeft <= 0}
              />
              {timeLeft <= 0 && <div className="tf-center-msg">Час вийшов! Рахуємо…</div>}
            </>
          )}

          {!isActive && <div className="tf-center-msg">Очікуйте результатів…</div>}
        </>
      )}

      {countdownNumber != null && (
        <div className="tf-countdown" key={countdownNumber}>
          {countdownNumber}
        </div>
      )}

      {/* ------------------------------------------------ phone */}
      {!isDisplay && (
        <div className="tf-phone">
          {!isActive && <p className="tf-wait">Очікуйте старту…</p>}
          {instructing && (
            <div className="tf-phone-intro">
              {Brand({})}
              <p className="tf-wait">Слухай ведучого на головному екрані</p>
              <ul className="tf-phone-rules">
                <li>
                  <b className="ok">+1</b> за правильну
                </li>
                <li>
                  <b className="ice">❄ 3 с</b> заморозка за помилку
                </li>
                <li>
                  <b className="bad">💀</b> найменше балів — мінус життя
                </li>
              </ul>
            </div>
          )}

          {gameStarted && (
            <>
              <div className="tf-phone-bar">
                <div
                  className="tf-phone-bar-fill"
                  style={{ transform: `scaleX(${Math.max(0, timeLeft) / TOTAL_PLAY_SECONDS})` }}
                />
              </div>
              <div className="tf-phone-top">
                <span className={`tf-phone-time ${timeLeft <= 5 ? "hot" : ""}`}>⏱ {timeLeft}</span>
                <span className="tf-streak-slot">
                  {streak >= 3 && (
                    <span key={streak} className="tf-streak">
                      🔥 {streak}
                    </span>
                  )}
                </span>
                <span className="tf-phone-score">✓ {score}</span>
              </div>
            </>
          )}

          {gameStarted && timeLeft <= 0 && (
            <div className="tf-done">
              <p className="tf-done-title">Час вийшов!</p>
              <p className="tf-done-score">{score}</p>
              <p className="tf-wait">правильних відповідей · результат на екрані</p>
            </div>
          )}

          {gameStarted && timeLeft > 0 && currentQ && (
            <>
              <div className="tf-card" key={questionIdx}>
                <span className="tf-card-q">{currentQ.text}</span>
                {flash && (
                  <span key={flash.n} className={`tf-float ${flash.kind}`}>
                    {flash.kind === "correct" ? "+1" : "✕"}
                  </span>
                )}
              </div>
              <div className="tf-buzzers">
                <button
                  className="tf-buzzer tf-buzzer-true"
                  onClick={() => answer(true)}
                  disabled={!canAnswer || isFrozen}
                  type="button"
                >
                  <span className="tf-buzzer-cap">✓</span>
                  <span className="tf-buzzer-label">ПРАВДА</span>
                </button>
                <button
                  className="tf-buzzer tf-buzzer-false"
                  onClick={() => answer(false)}
                  disabled={!canAnswer || isFrozen}
                  type="button"
                >
                  <span className="tf-buzzer-cap">✕</span>
                  <span className="tf-buzzer-label">БРЕХНЯ</span>
                </button>
              </div>
            </>
          )}

          {isFrozen && gameStarted && timeLeft > 0 && canAnswer && (
            <div className="tf-freeze" aria-live="polite">
              <p className="tf-freeze-title">❄ ЗАМОРОЖЕНО</p>
              <p className="tf-freeze-count" key={thawIn}>
                {thawIn}
              </p>
              {missed && (
                <p className="tf-freeze-truth">
                  Насправді це{" "}
                  <b className={missed.isTrue ? "t" : "f"}>{missed.isTrue ? "ПРАВДА" : "БРЕХНЯ"}</b>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- TV parts

const SPRITE = (slot) =>
  `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;

function sfx(src, volume = 0.6) {
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

function TfTimer({ timeLeft, total }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, timeLeft / total));
  return (
    <div className={`tf-timer ${timeLeft <= 5 ? "hot" : ""}`}>
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} className="track" />
        <circle cx="20" cy="20" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span key={timeLeft <= 5 ? timeLeft : "t"}>{Math.max(0, timeLeft)}</span>
    </div>
  );
}

/** Contestants down both sides of the host: live score, ❄ while frozen, 👑 leader. */
const LiveBoard = memo(function LiveBoard({ ids, live, namesById, slotsById, done }) {
  const all = ids.length ? ids : Object.keys(live);
  const ranked = [...all].sort((a, b) => (live[b]?.score ?? 0) - (live[a]?.score ?? 0));
  const leader = ranked[0];
  const half = Math.ceil(all.length / 2);
  const cols = [all.slice(0, half), all.slice(half)];
  return (
    <>
      {cols.map((col, ci) => (
        <div key={ci} className={`tf-board tf-board-${ci ? "right" : "left"}`}>
          {col.map((id) => {
            const st = live[id] || { score: 0, frozen: false };
            const lead = id === leader && st.score > 0;
            return (
              <div key={id} className={`tf-player ${st.frozen && !done ? "frozen" : ""} ${lead ? "lead" : ""}`}>
                <img src={SPRITE(slotsById[id])} alt="" />
                <span className="tf-player-name">{namesById[id] || "Гравець"}</span>
                <span className="tf-player-score" key={st.score}>
                  {st.score}
                </span>
                {st.frozen && !done && <span className="tf-player-ice">❄</span>}
                {lead && <span className="tf-player-crown">👑</span>}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
});
