import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./PerfectSecondMinigame.css";
import gameClock from "../game/gameClock";
import { playVictory, randomVictory } from "../game/victory";

/**
 * «Ідеальна секунда» (id: perfectSecond). Server-authoritative
 * (server/minigames/perfectSecond.js): the server runs the rounds, keeps every
 * stop and scores. This component renders and stamps the taps.
 *
 * Time: both the TV and the phones sync to the server clock with ps:ping/ps:pong
 * (the shortest round trip wins), so the TV draws the timer from the shared
 * `startAt` and a phone sends its tap as server time. The phone never shows the
 * running time — only the TV does, until it vanishes.
 *
 * Events in:  ps:go { introEndsAt, rounds, targetMs, limitMs, serverNow }
 *             ps:round { round, of, level, hint, hideMs, countdownAt, startAt, hideAt, endAt, serverNow }
 *             ps:progress { round, stoppedIds }   ps:ack { round }   ps:pong { t, s }
 *             ps:roundResult { round, rows: [{ id, ms, err, place, points }], totals, ranked, nextAt }
 * Events out: minigameEvent ps:stop { round, at } | ps:hello | ps:ping { t }
 *             minigameDisplayEvent ps:hello | ps:ping (the TV)
 * Results:    results.perfectSecond { targetMs, rounds: [{ round, level, rows }], totals, errSum, ranked, winnerId }
 */

const DIR = "/assets/minigames/perfect-second";
// optional files of this minigame (see its README.md); the shared sounds stand in until they exist
const SOUND = {
  music: `${DIR}/background.mp3`, // a soft bed under the whole minigame
  tension: `${DIR}/tension.mp3`, // looped while the timer is hidden
  beep: "/assets/sounds/beep.mp3",
  start: `${DIR}/start.mp3`,
  tick: "/assets/sounds/click.mp3",
  hide: `${DIR}/hide.mp3`,
  land: "/assets/sounds/click.mp3",
  sweep: `${DIR}/sweep.mp3`, // the needle runs along the result's scale
  perfect: `${DIR}/perfect.mp3`, // somebody within 0.1 s
  result: "/assets/sounds/result.mp3",
};
const FALLBACK = {
  [SOUND.start]: "/assets/sounds/bell.mp3",
  [SOUND.hide]: "/assets/sounds/knife-slice.mp3",
  get [SOUND.perfect]() {
    return randomVictory();
  },
};
const SPRITE = (slot) => `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/sounds/lose/${n}.mp3`);
const TICK_MS = 100;
const FINAL_SCENE_MS = 13000; // the final board on the TV, then the game goes on
const SCALE = { from: 7500, to: 12500 }; // the round result's time line (ms)
const SWEEP = { DELAY: 700, MS: 3000 }; // the needle runs along it; a pin drops as it passes that time
const TICKS = Array.from({ length: (SCALE.to - SCALE.from) / 100 + 1 }, (_, i) => SCALE.from + i * 100);
const pos = (ms) => Math.max(0, Math.min(1, (ms - SCALE.from) / (SCALE.to - SCALE.from)));
/** Stack the pins that would overlap: left to right, each into the lowest lane with room. */
function withLanes(pins, gap = 0.075, maxLanes = 4) {
  const lastX = [];
  return [...pins]
    .sort((a, b) => a.x - b.x)
    .map((p, i) => {
      let lane = lastX.findIndex((x) => p.x - x >= gap);
      if (lane < 0) lane = lastX.length < maxLanes ? lastX.length : i % maxLanes;
      lastX[lane] = p.x;
      return { ...p, lane };
    });
}
const HOST_LINE = "Зараз перевіримо, чи є у вас відчуття часу. Ваше завдання — зупинити час рівно на десяти секундах!";

/** A one-shot effect; `maxMs` fades it out after that long (a long file under a short animation). */
function sfx(src, volume = 0.6, maxMs = 0) {
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.onerror = () => FALLBACK[src] && sfx(FALLBACK[src], volume, maxMs);
    a.play().catch(() => {});
    if (maxMs > 0) {
      window.setTimeout(() => {
        const fade = window.setInterval(() => {
          a.volume = Math.max(0, a.volume - volume / 6);
          if (a.volume <= 0.001) {
            window.clearInterval(fade);
            a.pause();
          }
        }, 50);
      }, maxMs);
    }
  } catch {
    /* audio unavailable */
  }
}

const secs = (ms) => (ms / 1000).toFixed(2);
const diffText = (ms, target) => {
  const d = ms - target;
  if (d === 0) return "ІДЕАЛЬНО!";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} мс · ${d > 0 ? "пізно" : "рано"}`;
};
const placeWord = (p) => (p === 1 ? "🥇" : p === 2 ? "🥈" : p === 3 ? "🥉" : `${p}`);

/**
 * The server clock on this device: offset = server − local, from the ping with
 * the shortest round trip (a burst on mount, on every round and after a pause).
 */
function useServerClock(socket, isDisplay, enabled) {
  const offsetRef = useRef(null);
  const samples = useRef([]);
  const pending = useRef(new Map());

  const burst = useCallback(
    (n = 5) => {
      if (!socket || !enabled) return;
      for (let i = 0; i < n; i++) {
        window.setTimeout(() => {
          const t = gameClock.now() + Math.random() / 1000; // unique key
          pending.current.set(t, performance.now());
          socket.emit(isDisplay ? "minigameDisplayEvent" : "minigameEvent", { name: "ps:ping", data: { t } });
        }, i * 120);
      }
    },
    [socket, isDisplay, enabled]
  );

  useEffect(() => {
    if (!socket || !enabled) return undefined;
    const onPong = (d) => {
      const sentAt = pending.current.get(d?.t);
      if (sentAt == null || !Number.isFinite(Number(d?.s))) return;
      pending.current.delete(d.t);
      const rtt = performance.now() - sentAt;
      samples.current = [...samples.current.slice(-11), { rtt, offset: Number(d.s) - (d.t + rtt / 2) }];
      offsetRef.current = samples.current.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
    };
    socket.on("ps:pong", onPong);
    burst(6);
    const unsub = gameClock.subscribe((paused) => {
      if (paused) return;
      samples.current = []; // the two clocks paused a little apart: measure again
      burst(4);
    });
    return () => {
      socket.off("ps:pong", onPong);
      unsub();
    };
  }, [socket, enabled, burst]);

  /** A rough offset from a payload's serverNow, until a ping has answered. */
  const seed = useCallback((serverNow) => {
    if (offsetRef.current == null && Number.isFinite(Number(serverNow))) offsetRef.current = Number(serverNow) - gameClock.now();
  }, []);
  const now = useCallback(() => gameClock.now() + (offsetRef.current ?? 0), []);
  return useMemo(() => ({ now, seed, burst }), [now, seed, burst]);
}

/** The big running timer (TV): its own animation frame loop for smooth hundredths. */
function RunningTimer({ clock, startAt, hideAt }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const t = Math.max(0, Math.min(hideAt - startAt, clock.now() - startAt));
      if (ref.current) ref.current.textContent = secs(t);
      raf = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(raf);
  }, [clock, startAt, hideAt]);
  return <div className="ps-digits" ref={ref} />;
}

function Title({ small }) {
  return (
    <header className={`ps-head ${small ? "small" : ""}`}>
      <span className="ps-kicker">⏱ мінігра</span>
      <h2 className="ps-title">
        ІДЕАЛЬНА <em>СЕКУНДА</em>
      </h2>
    </header>
  );
}

function Lives({ n }) {
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return <p className="ps-lives dead">💀 Життів не лишилось — тепер ти привид</p>;
  return (
    <div className="ps-lives">
      <span>Залишилось життів</span>
      <b>{"❤".repeat(Math.min(10, n))}</b>
    </div>
  );
}

// ---------------------------------------------------------------- component

export default function PerfectSecondMinigame({
  socket,
  uiMode = "mobile",
  isActive,
  myPlayerId,
  namesById = {},
  slotsById = {},
  contestantIds = [],
  results,
  onSceneDone,
  onVideoStartedAt,
}) {
  const isDisplay = uiMode === "display";
  const amContestant = contestantIds.includes(myPlayerId);
  const clock = useServerClock(socket, isDisplay, isDisplay || amContestant);
  const [go, setGo] = useState(null);
  const [round, setRound] = useState(null);
  const [roundResults, setRoundResults] = useState({}); // round -> payload
  const [stopped, setStopped] = useState([]);
  const [acked, setAcked] = useState({}); // round -> true (this phone's stop is in)
  const [pressed, setPressed] = useState({}); // round -> true (tapped, waiting for the ack)
  const [, setTick] = useState(0);
  const soundRef = useRef({});
  const sceneDoneRef = useRef(false);
  const finalT0 = useRef(null);

  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return undefined;
    const { seed, burst } = clock;
    const onGo = (d) => {
      if (!Number.isFinite(Number(d?.introEndsAt))) return;
      seed(d.serverNow);
      setGo(d);
    };
    const onRound = (d) => {
      if (!Number.isFinite(Number(d?.startAt))) return;
      seed(d.serverNow);
      setRound((r) => {
        if (r?.round !== d.round) burst(3); // refine the clock while the 3-2-1 runs
        return d;
      });
    };
    const onProgress = (d) => setStopped(Array.isArray(d?.stoppedIds) ? d.stoppedIds : []);
    const onAck = (d) => d?.round && setAcked((a) => ({ ...a, [d.round]: true }));
    const onResult = (d) => d?.round && setRoundResults((m) => ({ ...m, [d.round]: d }));
    socket.on("ps:go", onGo);
    socket.on("ps:round", onRound);
    socket.on("ps:progress", onProgress);
    socket.on("ps:ack", onAck);
    socket.on("ps:roundResult", onResult);
    return () => {
      socket.off("ps:go", onGo);
      socket.off("ps:round", onRound);
      socket.off("ps:progress", onProgress);
      socket.off("ps:ack", onAck);
      socket.off("ps:roundResult", onResult);
    };
  }, [socket, clock]);

  // a (re)opened page asks for the state: the TV always, a phone when it plays
  useEffect(() => {
    if (!isActive || !socket) return;
    if (isDisplay) socket.emit("minigameDisplayEvent", { name: "ps:hello", data: {} });
    else if (amContestant) socket.emit("minigameEvent", { name: "ps:hello", data: {} });
  }, [isActive, socket, isDisplay, amContestant]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  // ---------------------------------------------------------------- phase
  const isFinal = !!results && results.minigameId === "perfectSecond" && !!results.perfectSecond;
  if (isFinal && finalT0.current == null) finalT0.current = gameClock.now();
  const now = clock.now();
  const result = round ? roundResults[round.round] : null;
  const phase = isFinal
    ? "final"
    : !go
      ? "wait"
      : !round
        ? "prep"
        : result
          ? "result"
          : now < round.startAt
            ? "countdown"
            : now < round.hideAt
              ? "visible"
              : now < round.endAt
                ? "hidden"
                : "closing";
  const countdown = phase === "countdown" ? Math.max(1, Math.ceil((round.startAt - now) / 1000)) : null;
  const target = go?.targetMs || round?.targetMs || 10000;

  // ---------------------------------------------------------------- sounds (TV)
  // a soft bed under the whole minigame, from the rules to the final board
  const musicOn = isDisplay && phase !== "wait";
  useEffect(() => {
    if (!musicOn) return undefined;
    return loop(SOUND.music, 0.22);
  }, [musicOn]);
  const tensionOn = isDisplay && phase === "hidden";
  useEffect(() => {
    if (!tensionOn) return undefined;
    return loop(SOUND.tension, 0.7);
  }, [tensionOn]);

  const visibleSec = phase === "visible" ? Math.floor((now - round.startAt) / 1000) : null;
  const soundKey = !isDisplay || !round
    ? null
    : phase === "countdown"
      ? `${round.round}c${countdown}`
      : phase === "visible"
        ? `${round.round}v${visibleSec}`
        : phase === "hidden"
          ? `${round.round}h`
          : phase === "result"
            ? `${round.round}r`
            : null;
  useEffect(() => {
    if (!soundKey || soundRef.current[soundKey]) return;
    soundRef.current[soundKey] = true;
    if (soundKey.includes("c")) sfx(SOUND.beep, 0.45);
    else if (soundKey.endsWith("v0")) sfx(SOUND.start, 0.55);
    else if (soundKey.includes("v")) sfx(SOUND.tick, 0.25);
    else if (soundKey.endsWith("h")) sfx(SOUND.hide, 0.7);
    else if (soundKey.endsWith("r")) {
      sfx(SOUND.result, 0.45);
      gameClock.setTimeout(() => sfx(SOUND.sweep, 0.5, SWEEP.MS), SWEEP.DELAY); // fades out as the needle reaches the end
      const rows = (result?.rows || []).filter((r) => r.ms != null);
      rows.forEach((r) => gameClock.setTimeout(() => sfx(SOUND.land, 0.35), SWEEP.DELAY + pos(r.ms) * SWEEP.MS));
      if (rows.length) gameClock.setTimeout(() => rows.some((r) => r.err <= 100) ? sfx(SOUND.perfect, 0.45) : playVictory(0.5), SWEEP.DELAY + SWEEP.MS + 250);
    }
  }, [soundKey, result]);

  const amLoser = isFinal && (results.loserIds || []).includes(myPlayerId);
  useEffect(() => {
    if (!isFinal || soundRef.current.final) return;
    soundRef.current.final = true;
    if (isDisplay) {
      sfx(SOUND.result, 0.45);
      if ((results.loserIds || []).length) gameClock.setTimeout(() => sfx(LOSE_SOUNDS[Math.floor(Math.random() * 4)], 0.8), 2600);
    } else if (amLoser) gameClock.setTimeout(() => sfx(LOSE_SOUNDS[Math.floor(Math.random() * 4)], 0.8), 1200);
  }, [isFinal, isDisplay, amLoser, results]);
  useEffect(() => {
    if (!isFinal || !isDisplay || sceneDoneRef.current) return undefined;
    const t = gameClock.setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, FINAL_SCENE_MS);
    return () => gameClock.clearTimeout(t);
  }, [isFinal, isDisplay, onSceneDone]);

  // ---------------------------------------------------------------- the tap (phone)
  const canStop = !isDisplay && amContestant && round && !result && !acked[round.round] && !pressed[round.round] && (phase === "visible" || phase === "hidden");
  const onStop = (e) => {
    if (!canStop) return;
    // the moment of the touch itself, not of this handler (the event may wait for a busy frame)
    const ts = Number(e?.timeStamp) || 0;
    const lagRaw = ts > 1e12 ? Date.now() - ts : performance.now() - ts;
    const lag = Number.isFinite(lagRaw) ? Math.max(0, Math.min(200, lagRaw)) : 0;
    const at = clock.now() - lag;
    setPressed((p) => ({ ...p, [round.round]: true }));
    socket?.emit("minigameEvent", { name: "ps:stop", data: { round: round.round, at } });
    try {
      navigator.vibrate?.(40);
    } catch {
      /* no vibration */
    }
  };

  const nm = (id) => namesById[id] || "Гравець";
  const cls = `ps-root ${isDisplay ? "ps-display" : "ps-mobile"}`;
  const levelTag = round && (
    <span className="ps-round-tag">
      Раунд {round.round}/{round.of} · {round.level}
    </span>
  );

  // ================================================================== final
  if (phase === "final") {
    const f = results.perfectSecond;
    const loserIds = results.loserIds || [];
    const shielded = (f.lowestIds || []).filter((id) => !loserIds.includes(id)); // lowest, but answered the quiz right
    const place = (id) => 1 + f.ranked.filter((x) => f.totals[x] > f.totals[id] || (f.totals[x] === f.totals[id] && f.errSum[x] < f.errSum[id])).length;
    if (!isDisplay) {
      if (!f.ranked.includes(myPlayerId)) {
        return (
          <section className={cls}>
            <Title small />
            <p className="ps-muted">Дивись результати на головному екрані!</p>
          </section>
        );
      }
      const lost = loserIds.includes(myPlayerId);
      const won = f.winnerId === myPlayerId;
      return (
        <section className={`${cls} ${lost ? "lost" : won ? "won" : ""}`}>
          <Title small />
          <p className="ps-score">
            <b>{f.totals[myPlayerId] || 0}</b> балів
          </p>
          <p className="ps-place">
            {place(myPlayerId)} місце з {f.ranked.length}
          </p>
          <div className="ps-my-rounds">
            {f.rounds.map((r) => {
              const row = r.rows.find((x) => x.id === myPlayerId);
              return (
                <span key={r.round}>
                  <small>Р{r.round}</small>
                  <b>{row?.ms != null ? secs(row.ms) : "—"}</b>
                  <i>+{row?.points || 0}</i>
                </span>
              );
            })}
          </div>
          <p className={`ps-big ${lost ? "bad" : won ? "good" : ""}`}>
            {lost ? "МІНУС ЖИТТЯ" : won ? "ГОДИННИК У ГОЛОВІ!" : shielded.includes(myPlayerId) ? "ОСТАННІЙ, АЛЕ 🛡 ВІКТОРИНА ВРЯТУВАЛА" : loserIds.length || shielded.length ? "ТИ В БЕЗПЕЦІ" : "НІЧИЯ — ВСІ ЖИВІ"}
          </p>
          {lost && (
            <>
              <p className="ps-life">−1 ❤</p>
              {/* the server takes the life only after this scene, so count it in here */}
              <Lives n={Number(results.livesById?.[myPlayerId]) - 1} />
            </>
          )}
        </section>
      );
    }
    return (
      <section className={`${cls} ps-final`}>
        <Title small />
        <div className="ps-board">
          <div className="ps-board-row head">
            <span />
            <span />
            <span className="ps-board-name">Гравець</span>
            {f.rounds.map((r) => (
              <span key={r.round} className="ps-board-cell">
                Р{r.round}
              </span>
            ))}
            <span className="ps-board-total">Разом</span>
          </div>
          {f.ranked.map((id, k) => {
            const lost = loserIds.includes(id);
            const won = f.winnerId === id;
            return (
              <div key={id} className={`ps-board-row ${lost || shielded.includes(id) ? "lost" : ""} ${won ? "top" : ""}`} style={{ "--k": f.ranked.length - k }}>
                <span className="ps-board-place">{placeWord(place(id))}</span>
                <img className="ps-ava" src={SPRITE(slotsById[id])} alt="" />
                <span className="ps-board-name">
                  {won && "👑 "}
                  {nm(id)}
                </span>
                {f.rounds.map((r) => {
                  const row = r.rows.find((x) => x.id === id);
                  return (
                    <span key={r.round} className={`ps-board-cell ${row?.place === 1 ? "best" : ""}`}>
                      <b>{row?.ms != null ? secs(row.ms) : "—"}</b>
                      <i>+{row?.points || 0}</i>
                    </span>
                  );
                })}
                <span className="ps-board-total">{f.totals[id] || 0}</span>
                {lost && <span className="ps-board-minus">−1 ❤</span>}
                {shielded.includes(id) && <span className="ps-board-minus shield">🛡</span>}
              </div>
            );
          })}
        </div>
        <p className={`ps-verdict ${loserIds.length ? "" : "draw"}`}>
          {loserIds.length
            ? `Найгірше відчуття часу: ${loserIds.map(nm).join(", ")} — мінус життя!`
            : shielded.length
              ? `Найгірше відчуття часу: ${shielded.map(nm).join(", ")} — але правильна відповідь у вікторині рятує життя!`
              : "Однаковий результат у всіх — ніхто не втрачає життя!"}
        </p>
      </section>
    );
  }

  // ================================================================== phone
  if (!isDisplay) {
    if (!amContestant) {
      return (
        <section className={cls}>
          <Title />
          <p className="ps-muted">Цього разу ти глядач. Дивись на головний екран!</p>
        </section>
      );
    }
    if (phase === "wait" || phase === "prep") {
      return (
        <section className={cls}>
          <Title />
          <div className="ps-phone-hint">
            <b>👀 Дивись на головний екран</b>
            <span>Таймер зникне — рахуй подумки й тисни СТОП рівно на 10.00</span>
          </div>
        </section>
      );
    }
    if (phase === "countdown") {
      return (
        <section className={cls}>
          {levelTag}
          <div className="ps-countdown" key={countdown}>
            {countdown}
          </div>
          <p className="ps-status">Приготуйся…</p>
        </section>
      );
    }
    if (phase === "result") {
      const row = result.rows.find((r) => r.id === myPlayerId);
      return (
        <section className={`${cls} ps-phone-result ${row?.place === 1 ? "won" : ""}`}>
          {levelTag}
          {row?.ms != null ? (
            <>
              <p className="ps-my-time">{secs(row.ms)}</p>
              <p className={`ps-diff ${row.err <= 100 ? "good" : row.err >= 1000 ? "bad" : ""}`}>{diffText(row.ms, target)}</p>
              <p className="ps-place">
                {placeWord(row.place)} {row.place > 3 ? "місце" : ""} · <b>+{row.points}</b>
              </p>
            </>
          ) : (
            <p className="ps-big bad">Не зупинив 😬 · +0</p>
          )}
          <p className="ps-total">
            Разом: <b>{result.totals?.[myPlayerId] || 0}</b>
          </p>
        </section>
      );
    }
    const done = acked[round.round] || pressed[round.round];
    if (done || phase === "closing") {
      return (
        <section className={`${cls} ps-phone-locked`}>
          {levelTag}
          <div className="ps-lock-card">
            <span className="ps-lock-icon">{done ? "✅" : "⏰"}</span>
            <b>{done ? "Час зафіксовано!" : "Час вийшов"}</b>
            <small>{done ? "Результат — коли зупиняться всі" : "Цей раунд без балів"}</small>
          </div>
        </section>
      );
    }
    return (
      <section className={`${cls} ps-phone-live ${phase}`}>
        {levelTag}
        <p className="ps-status">{phase === "visible" ? "Слідкуй за таймером на екрані" : "Рахуй подумки…"}</p>
        <button type="button" className="ps-stop" onPointerDown={onStop} onClick={(e) => e.preventDefault()}>
          СТОП
        </button>
        <p className="ps-target">Ціль — {secs(target)}</p>
      </section>
    );
  }

  // ================================================================== TV
  if (phase === "wait" || phase === "prep") {
    return (
      <section className={`${cls} ps-prep`}>
        <Title />
        <p className="ps-host">«{HOST_LINE}»</p>
        <div className="ps-rounds">
          {(go?.rounds || []).map((r, i) => (
            <div key={r.index} className="ps-round-card" style={{ "--i": i }}>
              <small>Раунд {r.index}</small>
              <b>{r.level}</b>
              <span>
                таймер зникне на <u>{secs(r.hideMs)}</u>
              </span>
            </div>
          ))}
        </div>
        <div className="ps-rules">
          <span>🎯 Зупини свій час на телефоні рівно на <b>{secs(target)}</b></span>
          <span>⭐ Найточніший +5 · другий +3 · третій +2 · решта +1</span>
          <span className="bad">💀 Найменше балів за 3 раунди — мінус життя</span>
        </div>
      </section>
    );
  }

  if (phase === "result") {
    const rows = result.rows;
    const landed = rows.filter((r) => r.ms != null);
    const pins = withLanes(landed.map((r) => ({ ...r, x: pos(r.ms) })));
    const tx = pos(target);
    const pct = (x) => `${x * 100}%`;
    const finish = SWEEP.DELAY + SWEEP.MS; // the needle reaches the right end
    return (
      <section className={`${cls} ps-result`} style={{ "--sweep": `${SWEEP.MS}ms`, "--sweep-delay": `${SWEEP.DELAY}ms`, "--finish": `${finish}ms` }}>
        <div className="ps-result-top">
          {levelTag}
          <h3 className="ps-result-title">Хто відчув час?</h3>
        </div>
        <div className="ps-ruler" style={{ "--lanes": Math.max(1, ...pins.map((p) => p.lane + 1)) }}>
          {/* accuracy zones around 10.00: perfect ±100 ms, close ±500 ms */}
          <i className="ps-zone near" style={{ left: pct(pos(target - 500)), width: pct(pos(target + 500) - pos(target - 500)) }} />
          <i className="ps-zone perfect" style={{ left: pct(pos(target - 100)), width: pct(pos(target + 100) - pos(target - 100)) }} />
          <div className="ps-ticks">
            {TICKS.map((ms) => (
              <span key={ms} className={`ps-tick ${ms % 1000 === 0 ? "major" : ms % 500 === 0 ? "half" : ""}`} style={{ left: pct(pos(ms)) }}>
                {ms % 1000 === 0 && <b>{secs(ms)}</b>}
              </span>
            ))}
          </div>
          <span className="ps-target-line" style={{ left: pct(tx) }}>
            <em>{secs(target)}</em>
          </span>
          <i className="ps-needle" />
          {pins.map((r) => {
            const best = r.place === 1;
            const edge = r.ms < SCALE.from ? "under" : r.ms > SCALE.to ? "over" : "";
            return (
              <div key={r.id} className={`ps-pin ${best ? "best" : ""} ${edge}`} style={{ left: pct(r.x), "--lane": r.lane, "--at": `${SWEEP.DELAY + r.x * SWEEP.MS}ms` }}>
                <span className="ps-pin-card">
                  {best && <span className="ps-pin-crown">👑</span>}
                  <img src={SPRITE(slotsById[r.id])} alt="" />
                  <em>{secs(r.ms)}</em>
                  <small>{nm(r.id)}</small>
                </span>
                <i className="ps-pin-stem" />
                <b className="ps-pin-dot" />
              </div>
            );
          })}
          {pins
            .filter((r) => r.place === 1)
            .map((r) => (
              <div key={`gap-${r.id}`} className="ps-best-fx" style={{ left: pct(r.x) }}>
                <span className="ps-burst">
                  {Array.from({ length: 14 }, (_, i) => (
                    <i key={i} style={{ "--a": `${(360 / 14) * i}deg`, "--r": `${7 + (i % 3) * 3}vh` }} />
                  ))}
                </span>
              </div>
            ))}
          {pins
            .filter((r) => r.place === 1)
            .slice(0, 1)
            .map((r) => (
              <span key="gap" className="ps-gap" style={{ left: pct(Math.min(r.x, tx)), width: pct(Math.abs(tx - r.x)) }}>
                <em>{r.ms === target ? "ІДЕАЛЬНО!" : `${r.ms > target ? "+" : "−"}${Math.abs(r.ms - target)} мс`}</em>
              </span>
            ))}
        </div>
        <div className={`ps-table ${rows.length > 4 ? "two" : ""}`}>
          {rows.map((r, k) => (
            <div key={r.id} className={`ps-table-row ${r.place === 1 ? "best" : ""} ${r.ms == null ? "miss" : ""}`} style={{ "--k": k }}>
              <span className="ps-table-place">{r.place ? placeWord(r.place) : "—"}</span>
              <img className="ps-ava" src={SPRITE(slotsById[r.id])} alt="" />
              <span className="ps-table-name">{nm(r.id)}</span>
              <span className="ps-table-time">{r.ms != null ? `${secs(r.ms)} с` : "не зупинив"}</span>
              <span className="ps-table-diff">{r.ms != null ? diffText(r.ms, target) : ""}</span>
              <span className="ps-table-pts">+{r.points}</span>
              <span className="ps-table-total">{result.totals?.[r.id] || 0}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // countdown / the round itself
  const hidden = phase === "hidden" || phase === "closing";
  return (
    <section className={`${cls} ps-live ${phase}`}>
      <div className="ps-live-top">
        {levelTag}
        <span className="ps-goal">
          Ціль — <b>{secs(target)}</b>
        </span>
      </div>
      <div className="ps-stage">
        {phase === "countdown" && (
          <div className="ps-countdown" key={countdown}>
            {countdown}
          </div>
        )}
        {phase === "visible" && <RunningTimer clock={clock} startAt={round.startAt} hideAt={round.hideAt} />}
        {hidden && (
          <>
            <div className="ps-digits gone" key={`gone-${round.round}`}>
              {secs(round.hideMs)}
            </div>
            <div className="ps-void" aria-hidden="true">
              ?.??
            </div>
          </>
        )}
      </div>
      <p className="ps-hint" key={phase}>
        {phase === "countdown" ? `Таймер зникне на ${secs(round.hideMs)}` : phase === "visible" ? "Запам'ятай темп…" : phase === "closing" ? "ЧАС!" : round.hint}
      </p>
      <div className="ps-players">
        {contestantIds.map((id) => (
          <span key={id} className={`ps-player ${stopped.includes(id) ? "done" : ""}`}>
            <img src={SPRITE(slotsById[id])} alt="" />
            <b>{nm(id)}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

/** A looped bed that fades out when it stops; silent when its file is missing. */
function loop(src, volume) {
  const a = new Audio(src);
  a.loop = true;
  a.volume = volume;
  const play = () => a.play().catch(() => {});
  if (!gameClock.isPaused()) play();
  const unsub = gameClock.subscribe((paused) => (paused ? a.pause() : play()));
  return () => {
    unsub();
    const fade = window.setInterval(() => {
      a.volume = Math.max(0, a.volume - volume / 8);
      if (a.volume <= 0.001) {
        window.clearInterval(fade);
        a.pause();
      }
    }, 60);
  };
}
