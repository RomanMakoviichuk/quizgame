import { memo, useEffect, useMemo, useRef, useState } from "react";
import "./MathRushMinigame.css";
import gameClock from "../game/gameClock";
import { playVictory } from "../game/victory";

/**
 * "Тупоматика" (id: mathRush) — server-authoritative arithmetic sprint.
 *
 * The server (server/minigames/mathRush.js) owns the questions, scoring and the
 * clock. This component only renders and forwards taps.
 *
 * Events in:  mathRush:go { playStartAt, playEndAt, serverNow }
 *             mathRush:question { seq, text, options, score, prev? }   (mobile, per-player)
 *             mathRush:scores { scoresById }                            (live leaderboard)
 * Event out:  minigameEvent { name: "mathRush:answer", data: { seq, choice } }
 *
 * Scoring (server): +1 for a right answer, −1 for a wrong one.
 */

const TITLE = "ТУПОМАТИКА";
const SPRITE = (slot) =>
  `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const DEAD_SPRITE = (slot) =>
  `/assets/characters/dead/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/sounds/lose/${n}.mp3`);
const MUSIC = "/assets/minigames/math-rush/background.mp3"; // TV, the whole minigame
const MUSIC_VOLUME = 1; // level set by game/loudness.js
const RIGHT_SOUND = "/assets/minigames/math-rush/click.mp3"; // phone, a right answer
const TICK_MS = 250;
const OPTION_COLORS = ["#ff4fa3", "#3fd0ff", "#c6ff4a", "#ffb22e"];
// floating chalk symbols in the background (fixed layout, transform-only motion)
const DOODLES = [
  ["+", 6, 12], ["7", 18, 72], ["−", 30, 28], ["=", 44, 84], ["?", 57, 10], ["3", 70, 62],
  ["+", 82, 22], ["9", 92, 78], ["−", 12, 46], ["5", 38, 56], ["=", 64, 38], ["?", 88, 48],
  ["2", 50, 92], ["8", 24, 92], ["+", 76, 90], ["÷", 4, 80],
];

function sfx(src, volume = 0.6) {
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}
const randomLoseSound = () => LOSE_SOUNDS[Math.floor(Math.random() * LOSE_SOUNDS.length)];

function Backdrop() {
  return (
    <div className="mr-backdrop" aria-hidden="true">
      {DOODLES.map(([ch, x, y], i) => (
        <span
          key={i}
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${-i * 1.3}s`, animationDuration: `${9 + (i % 5)}s` }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

function Title({ small }) {
  return (
    <header className={`mr-head ${small ? "small" : ""}`}>
      <h2 className="mr-title">
        {TITLE.split("").map((c, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.06}s` }}>
            {c}
          </span>
        ))}
      </h2>
      <p className="mr-sub">рахуй швидше, ніж думаєш</p>
    </header>
  );
}

// ---------------------------------------------------------------- live race (TV)

const Race = memo(function Race({ scores, namesById, slotsById }) {
  const prev = useRef({});
  const [bumps, setBumps] = useState({}); // id -> { n, up }: re-keys the "+1" / "−1" pop
  useEffect(() => {
    const next = {};
    for (const [id, s] of Object.entries(scores)) {
      const was = prev.current[id] ?? 0;
      if (was !== s) next[id] = s > was;
    }
    prev.current = { ...scores };
    if (Object.keys(next).length) {
      setBumps((b) => {
        const out = { ...b };
        for (const [id, up] of Object.entries(next)) out[id] = { n: (out[id]?.n || 0) + 1, up };
        return out;
      });
    }
  }, [scores]);

  const rows = Object.entries(scores)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (namesById[a.id] || "").localeCompare(namesById[b.id] || ""));
  const best = Math.max(1, ...rows.map((r) => r.score));
  const order = Object.keys(scores).sort();
  const rankOf = Object.fromEntries(rows.map((r, i) => [r.id, i]));

  return (
    <div className="mr-race" style={{ "--n": Math.max(rows.length, 1) }}>
      {order.map((id) => {
        const rank = rankOf[id];
        const score = scores[id];
        return (
          <div key={id} className={`mr-row ${rank === 0 && score > 0 ? "lead" : ""}`} style={{ "--i": rank }}>
            <span className="mr-rank">{rank + 1}</span>
            <img className="mr-row-sprite" src={SPRITE(slotsById[id])} alt="" />
            <span className="mr-row-name">{namesById[id] || "Гравець"}</span>
            <div className="mr-bar">
              <div className="mr-bar-fill" style={{ transform: `scaleX(${Math.max(0, score) / best})` }} />
            </div>
            <span className={`mr-row-score ${score < 0 ? "neg" : ""}`}>
              {score}
              {bumps[id] ? (
                <span key={bumps[id].n} className={`mr-bump ${bumps[id].up ? "" : "neg"}`}>
                  {bumps[id].up ? "+1" : "−1"}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
});

function TimerRing({ msLeft, totalMs }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const frac = totalMs ? Math.min(1, msLeft / totalMs) : 0;
  const secs = Math.ceil(msLeft / 1000);
  return (
    <div className={`mr-timer ${secs <= 5 ? "hot" : ""}`}>
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} className="track" />
        <circle cx="20" cy="20" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span key={secs <= 5 ? secs : "t"}>{secs}</span>
    </div>
  );
}

// ---------------------------------------------------------------- component

export default function MathRushMinigame({
  socket,
  uiMode = "mobile",
  isActive,
  myPlayerId,
  namesById = {},
  slotsById = {},
  results,
  onSceneDone,
  onVideoStartedAt,
}) {
  const isDisplay = uiMode === "display";
  const [go, setGo] = useState(null); // { playStartAt, playEndAt, offset, maxLevel }
  const [question, setQuestion] = useState(null);
  const [liveScores, setLiveScores] = useState({});
  const [, setTick] = useState(0);
  const [flash, setFlash] = useState(null); // { kind: "correct" | "wrong", n }
  const [streak, setStreak] = useState(0);
  const [sentSeq, setSentSeq] = useState(null);
  const flashTimer = useRef(null);
  const sceneDoneRef = useRef(false);
  const beepRef = useRef(null);
  const startedRef = useRef(false);

  // Display: ask the server for the shared clock shortly after mount.
  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return;
    const onGo = (d) => {
      if (!d || !Number.isFinite(Number(d.playStartAt))) return;
      setGo({
        playStartAt: Number(d.playStartAt),
        playEndAt: Number(d.playEndAt),
        offset: Number(d.serverNow ?? gameClock.now()) - gameClock.now(),
        maxLevel: !!d.maxLevel,
      });
    };
    const onQuestion = (d) => {
      setQuestion(d);
      if (d?.prev) {
        const ok = !!d.prev.correct;
        setFlash((f) => ({ kind: ok ? "correct" : "wrong", n: (f?.n || 0) + 1 }));
        setStreak((s) => (ok ? s + 1 : 0));
        sfx(ok ? RIGHT_SOUND : "/assets/sounds/beep.mp3", ok ? 0.7 : 0.3);
        if (flashTimer.current) gameClock.clearTimeout(flashTimer.current);
        flashTimer.current = gameClock.setTimeout(() => setFlash(null), 420);
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
      if (flashTimer.current) gameClock.clearTimeout(flashTimer.current);
    };
  }, [socket]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  const serverNow = go ? gameClock.now() + go.offset : 0;
  const beforeStart = go && serverNow < go.playStartAt;
  const ended = go && serverNow >= go.playEndAt;
  const countdownNum = beforeStart ? Math.max(1, Math.ceil((go.playStartAt - serverNow) / 1000)) : null;
  const msLeft = go ? Math.max(0, go.playEndAt - serverNow) : 0;
  const secsLeft = Math.ceil(msLeft / 1000);
  const playMs = go ? go.playEndAt - go.playStartAt : 0;

  // TV sounds: 3-2-1 beeps, a start signal, ticking over the last 5 seconds
  const beepKey = countdownNum != null && countdownNum <= 3 ? `c${countdownNum}` : !beforeStart && go && !ended && secsLeft <= 5 ? `e${secsLeft}` : null;
  useEffect(() => {
    if (!isDisplay || !beepKey || beepRef.current === beepKey) return;
    beepRef.current = beepKey;
    sfx("/assets/sounds/beep.mp3", 0.45);
  }, [isDisplay, beepKey]);
  const playing = !!go && !beforeStart && !ended;
  useEffect(() => {
    if (!isDisplay || !playing || startedRef.current) return;
    startedRef.current = true;
    sfx("/assets/sounds/bell.mp3", 0.5);
  }, [isDisplay, playing]);

  // End screen once results arrive.
  const isResults = !!results && results.minigameId === "mathRush";

  // TV: background music for the whole minigame (follows the game pause, fades out at the end)
  const musicOn = isDisplay && (isActive || isResults);
  useEffect(() => {
    if (!musicOn) return undefined;
    const a = new Audio(MUSIC);
    a.loop = true;
    a.volume = MUSIC_VOLUME;
    const play = () => a.play().catch(() => {});
    if (!gameClock.isPaused()) play();
    const unsub = gameClock.subscribe((paused) => (paused ? a.pause() : play()));
    return () => {
      unsub();
      const fade = window.setInterval(() => {
        a.volume = Math.max(0, a.volume - MUSIC_VOLUME / 8);
        if (a.volume <= 0.001) {
          window.clearInterval(fade);
          a.pause();
        }
      }, 80);
    };
  }, [musicOn]);
  useEffect(() => {
    if (!isResults) return;
    const loserId = (results.loserIds || [])[0];
    if (isDisplay) {
      playVictory(0.5);
      if (loserId) {
        const t = gameClock.setTimeout(() => sfx(randomLoseSound(), 0.8), 1600);
        return () => gameClock.clearTimeout(t);
      }
    } else if (loserId && loserId === myPlayerId) {
      sfx(randomLoseSound(), 0.8);
    }
  }, [isResults, isDisplay, results, myPlayerId]);
  useEffect(() => {
    if (!isResults || !isDisplay || sceneDoneRef.current) return;
    const t = gameClock.setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, 9000);
    return () => gameClock.clearTimeout(t);
  }, [isResults, isDisplay, onSceneDone]);

  const answer = (idx) => {
    if (!question || ended || beforeStart || sentSeq === question.seq) return;
    setSentSeq(question.seq);
    socket?.emit("minigameEvent", { name: "mathRush:answer", data: { seq: question.seq, choice: idx } });
  };

  const ranked = useMemo(
    () =>
      Object.entries(isResults ? results.minigameScores || {} : liveScores)
        .map(([id, score]) => ({ id, score, name: namesById[id] || "Гравець" }))
        .sort((a, b) => b.score - a.score),
    [isResults, results, liveScores, namesById]
  );

  const cls = `mr-root ${isDisplay ? "mr-display" : "mr-mobile"}`;

  // ---------------------------------------------------------------- end screen
  if (isResults) {
    const loserId = (results.loserIds || [])[0];
    const winnerId = results.bonusWinnerId || null;
    const saved = (results.savedFailerIds || []).map((id) => namesById[id] || "Гравець");
    const top = ranked.slice(0, 3);
    const podium = [top[1], top[0], top[2]].filter(Boolean);
    const rest = ranked.slice(3);

    if (!isDisplay) {
      const place = ranked.findIndex((r) => r.id === myPlayerId);
      const me = ranked[place];
      const my = results.stats?.[myPlayerId];
      return (
        <section className={`${cls} mr-phone-end`}>
          <Backdrop />
          <Title small />
          {me ? (
            <div className={`mr-me-result ${myPlayerId === loserId ? "bad" : ""}`}>
              <p className="mr-me-place">{place + 1} місце</p>
              <p className="mr-me-score">{me.score} балів</p>
              {my && (
                <div className="mr-me-stats">
                  <span className="ok">✓ {my.score + my.wrong}</span>
                  <span className="bad">✕ {my.wrong}</span>
                </div>
              )}
              {myPlayerId === loserId && <p className="mr-status bad">ТИ ВТРАЧАЄШ ЖИТТЯ</p>}
              {myPlayerId === winnerId && <p className="mr-status good">ПЕРЕМОГА · +1 БАЛ</p>}
            </div>
          ) : (
            <p className="mr-wait">Дивись на головний екран</p>
          )}
          <ol className="mr-mini-board">
            {ranked.map((r, i) => (
              <li key={r.id} className={`${r.id === myPlayerId ? "me" : ""} ${r.id === loserId ? "loser" : ""}`}>
                <span>{i + 1}</span>
                <b>{r.name}</b>
                <em>{r.score}</em>
              </li>
            ))}
          </ol>
        </section>
      );
    }

    return (
      <section className={`${cls} mr-end-screen`}>
        <Backdrop />
        <Title small />
        <div className="mr-podium">
          {podium.map((r) => {
            const place = ranked.indexOf(r);
            return (
              <div key={r.id} className={`mr-step p${place + 1} ${r.id === loserId ? "loser" : ""}`}>
                {place === 0 && <div className="mr-crown">👑</div>}
                <img
                  className="mr-step-sprite"
                  src={r.id === loserId ? DEAD_SPRITE(slotsById[r.id]) : SPRITE(slotsById[r.id])}
                  alt=""
                />
                <div className="mr-step-block">
                  <span className="mr-step-place">{place + 1}</span>
                  <span className="mr-step-name">{r.name}</span>
                  <span className="mr-step-score">{r.score}</span>
                  {r.id === winnerId && <span className="mr-step-bonus">+10 балів</span>}
                </div>
              </div>
            );
          })}
        </div>
        {rest.length > 0 && (
          <div className="mr-rest">
            {rest.map((r, i) => (
              <div key={r.id} className={`mr-chip ${r.id === loserId ? "loser" : ""}`} style={{ animationDelay: `${0.6 + i * 0.08}s` }}>
                <span>{i + 4}</span>
                <img src={r.id === loserId ? DEAD_SPRITE(slotsById[r.id]) : SPRITE(slotsById[r.id])} alt="" />
                <b>{r.name}</b>
                <em>{r.score}</em>
              </div>
            ))}
          </div>
        )}
        {loserId && (
          <p className="mr-verdict">
            💀 {namesById[loserId] || "Гравець"} — найменше балів, мінус життя!
          </p>
        )}
        {saved.length > 0 && (
          <p className="mr-saved">
            Помилка в питанні, але Тупоматика врятувала: <b>{saved.join(", ")}</b>
          </p>
        )}
      </section>
    );
  }

  // ---------------------------------------------------------------- not started
  if (!isActive || !go) {
    return (
      <section className={cls}>
        <Backdrop />
        <Title />
        <p className="mr-wait">{isDisplay ? "Приготуйтесь рахувати…" : "Дивіться на головний екран"}</p>
      </section>
    );
  }

  // ------------------------------------------------ rules + 3-2-1 countdown
  if (countdownNum != null) {
    return (
      <section className={`${cls} mr-prep`}>
        <Backdrop />
        <Title small={!isDisplay} />
        <div className="mr-demo">
          <span className="mr-demo-eq">7 + 8 = ?</span>
          <div className="mr-demo-opts">
            {[14, 15, 16, 13].map((n, i) => (
              <span key={n} className={n === 15 ? "right" : ""} style={{ "--c": OPTION_COLORS[i] }}>
                {n}
              </span>
            ))}
          </div>
        </div>
        <div className="mr-rule-cards">
          <div className="mr-rule" style={{ animationDelay: "0.1s" }}>
            <b>⚡</b>
            <span>Тисни правильну відповідь — одразу наступний приклад</span>
          </div>
          {go?.maxLevel && (
            <div className="mr-rule" style={{ animationDelay: "0.18s" }}>
              <b>×</b>
              <span>Максимальний рівень: є множення до 15 × 15!</span>
            </div>
          )}
          <div className="mr-rule" style={{ animationDelay: "0.25s" }}>
            <b>±1</b>
            <span>+1 за правильну відповідь, −1 за помилку — не тисни навмання!</span>
          </div>
          <div className="mr-rule bad" style={{ animationDelay: "0.4s" }}>
            <b>💀</b>
            <span>Найменше балів — мінус життя</span>
          </div>
          <div className="mr-rule good" style={{ animationDelay: "0.55s" }}>
            <b>👑</b>
            <span>Найбільше — +10 балів у рейтинг, решта, хто вцілів, — +5</span>
          </div>
        </div>
        {countdownNum <= 3 ? (
          <div className="mr-countdown" key={countdownNum}>
            {countdownNum}
          </div>
        ) : (
          <div className="mr-getready">Старт за {countdownNum}…</div>
        )}
      </section>
    );
  }

  // ---------------------------------------------------------------- playing (TV)
  if (isDisplay) {
    return (
      <section className={cls}>
        <Backdrop />
        <div className="mr-topbar">
          <Title small />
          <TimerRing msLeft={msLeft} totalMs={playMs} />
        </div>
        {ended ? (
          <p className="mr-banner">Час вийшов! Рахуємо…</p>
        ) : (
          <Race scores={liveScores} namesById={namesById} slotsById={slotsById} />
        )}
      </section>
    );
  }

  // ---------------------------------------------------------------- playing (phone)
  return (
    <section className={`${cls} ${flash ? `mr-flash-${flash.kind}` : ""}`}>
      <Backdrop />
      <div className="mr-phone-bar">
        <div className="mr-phone-bar-fill" style={{ transform: `scaleX(${playMs ? msLeft / playMs : 0})` }} />
      </div>
      <div className="mr-phone-top">
        <span className={`mr-phone-time ${secsLeft <= 5 ? "hot" : ""}`}>⏱ {secsLeft}</span>
        <span className={`mr-phone-score ${(question?.score ?? 0) < 0 ? "neg" : ""}`}>★ {question?.score ?? 0}</span>
      </div>
      {ended ? (
        <p className="mr-banner">Час вийшов!</p>
      ) : question ? (
        <div className="mr-play">
          <div className="mr-streak-slot">
            {streak >= 3 && (
              <span key={streak} className="mr-streak">
                🔥 {streak} поспіль
              </span>
            )}
          </div>
          <div className="mr-eq-card" key={question.seq}>
            {question.text} = ?
            {flash && (
              <span key={flash.n} className={`mr-float ${flash.kind}`}>
                {flash.kind === "correct" ? "+1" : "−1"}
              </span>
            )}
          </div>
          <div className="mr-options">
            {question.options.map((opt, i) => (
              <button
                key={`${question.seq}-${i}`}
                type="button"
                className="mr-option"
                style={{ "--c": OPTION_COLORS[i], animationDelay: `${i * 0.03}s` }}
                disabled={sentSeq === question.seq}
                onClick={() => answer(i)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mr-wait">…</p>
      )}
    </section>
  );
}
