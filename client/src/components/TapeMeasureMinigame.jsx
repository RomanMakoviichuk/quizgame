import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./TapeMeasureMinigame.css";
import gameClock from "../game/gameClock";
import { randomVictory } from "../game/victory";

/**
 * «До міліметра!» (id: tapeMeasure). Server-authoritative rounds
 * (server/minigames/tapeMeasure.js): the server sets the targets, keeps one lock
 * per player per round and scores. The tape itself lives on the phone, life-size
 * (PX_PER_MM): the case at the bottom, the blade pulled up with a finger to the
 * top of the screen at most; the practice pull shows its scale, the rounds a
 * blank blade (by eye). Only the locked length is sent.
 *
 * Events in:  tm:go { introEndsAt, rounds, maxMm, serverNow }
 *             tm:practice { startAt, endAt, serverNow }   (the practice pull: the blade with its scale)
 *             tm:round { round, of, level, host, targetMm, maxMm, introAt, startAt, endAt, serverNow }
 *             tm:progress { round, busyIds, lockedIds }   tm:ack { round, mm }
 *             tm:roundResult { round, targetMm, rows: [{ id, mm, err, place, points }], totals, ranked, nextAt }
 * Events out: minigameEvent tm:busy { round } | tm:lock { round, mm } | tm:hello
 *             minigameDisplayEvent tm:hello (the TV)
 * Results:    results.tapeMeasure { rounds: [{ round, level, targetMm, rows }], totals, errSum, ranked, winnerId, lowestIds }
 */

const DIR = "/assets/minigames/tape-measure";
// this minigame's own files (see its README.md); the shared sounds stand in until they exist
const SOUND = {
  music: `${DIR}/background.mp3`, // the rules and the results
  workshop: `${DIR}/workshop.mp3`, // looped while everybody measures
  start: `${DIR}/start.mp3`,
  lock: `${DIR}/lock.mp3`, // somebody locked their tape (TV)
  extend: `${DIR}/extend.mp3`, // the result: the tapes run out
  zoom: `${DIR}/zoom.mp3`, // the result zooms in on the target
  perfect: `${DIR}/perfect.mp3`, // the best within 1 mm
  fail: `${DIR}/fail.mp3`, // the worst miss is a big one
  fanfare: `${DIR}/fanfare.mp3`, // the final board
  beep: "/assets/sounds/beep.mp3",
};
const FALLBACK = {
  [SOUND.start]: "/assets/sounds/bell.mp3",
  [SOUND.lock]: "/assets/sounds/click.mp3",
  get [SOUND.perfect]() {
    return randomVictory();
  },
  [SOUND.fail]: "/assets/sounds/lose/2.mp3",
  get [SOUND.fanfare]() {
    return randomVictory();
  },
};
const SPRITE = (slot) => `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/sounds/lose/${n}.mp3`);
const TICK_MS = 100;
const FINAL_SCENE_MS = 13000;
// the round result on the TV: the tapes run out one by one, then the view zooms in on the target
const REVEAL = { START: 500, STAGGER: 260, RUN: 1100, ZOOM_AT: 3800, ZOOM_MS: 1300, JOKE_AT: 5400, TABLE_AT: 5600 };
/**
 * Life-size: CSS px per mm on a phone. A phone's CSS pixel is ~1/160 inch
 * (iPhones 1/163, the Max models 1/153, most Androids 1/150–1/170), so 1 cm is
 * ~62 px give or take 5% — close enough to feel like a real tape.
 */
const PX_PER_MM = 6.2;
const ROUND_RULE = "рулетка без поділок — на око";

function sfx(src, volume = 0.6) {
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.onerror = () => FALLBACK[src] && sfx(FALLBACK[src], volume);
    a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
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

/**
 * The phone's ratchet: a tiny synthesized click per centimetre (louder every
 * 10 cm) and the clack of the lock — no files, no delay.
 */
function makeRatchet() {
  let ctx = null;
  let lastAt = 0;
  const ensure = () => {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch {
      ctx = null;
    }
    return ctx;
  };
  const burst = (gain, ms, freq) => {
    const c = ensure();
    if (!c) return;
    const len = Math.max(1, Math.floor((c.sampleRate * ms) / 1000));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  };
  return {
    unlock: ensure,
    tick(major) {
      const t = performance.now();
      if (t - lastAt < 22) return; // a fast pull: a rattle, not a wall of noise
      lastAt = t;
      burst(major ? 0.9 : 0.45, major ? 14 : 7, major ? 2600 : 3800);
      try {
        navigator.vibrate?.(major ? 12 : 4);
      } catch {
        /* no vibration */
      }
    },
    clack() {
      burst(1, 30, 1200);
      window.setTimeout(() => burst(0.8, 18, 2200), 60);
      try {
        navigator.vibrate?.([30, 40, 20]);
      } catch {
        /* no vibration */
      }
    },
  };
}

const cm = (mm) => {
  const v = Math.round(mm) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};
const mmText = (n) => {
  const v = Math.round(n * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")} мм`;
};
const signedMm = (mm, target) => {
  const d = Math.round((mm - target) * 10) / 10;
  if (Math.abs(d) < 0.05) return "ТОЧНО!";
  return `${d > 0 ? "+" : "−"}${mmText(Math.abs(d))}`;
};
const placeWord = (p) => (p === 1 ? "🥇" : p === 2 ? "🥈" : p === 3 ? "🥉" : `${p}`);

/** The host's line about a round's result. */
function jokeFor(rows, target, nm) {
  const done = rows.filter((r) => r.mm != null);
  if (!done.length) return "Ніхто не зафіксував. Рулетка не бреше — на відміну від вашого ремонту.";
  const best = done[0];
  const worst = done[done.length - 1];
  if (done.length > 1 && worst.err >= 30) {
    return `${nm(worst.id)}, ${mmText(worst.err)} повз! Ти що, будинок на око будуєш?`;
  }
  if (best.err < 0.05) return `${nm(best.id)} — рівно ${cm(target)} см! Оце точність, можна вже двері вішати.`;
  if (best.err <= 3) return `${mmText(best.err)}! ${nm(best.id)}, ти, мабуть, штангенциркуль у дитинстві їв.`;
  if (best.err <= 10) return `${nm(best.id)} найближче — ${mmText(best.err)}. Для першого ремонту зійде.`;
  return "Рулетка не бреше. На відміну від вашого ремонту.";
}

// ---------------------------------------------------------------- the tape

/** Whole px per mm (so a thousand tick tiles never drift off their numbers); about `windowMm` fit in `winW`. */
const ppmFor = (winW, windowMm) => (winW > 0 ? Math.max(3, Math.round(winW / windowMm)) : 4);

/**
 * The TV's tape measure: the case on the left, the blade (every cm numbered) running right out of its
 * mouth. `mm` is the length out; the number at the mouth is that length, the
 * hook is `mm` further right. `windowMm` sets the scale (that much blade fits
 * between the mouth and the right edge).
 */
function Tape({ mm, windowMm, maxMm = 1000, className = "" }) {
  const winRef = useRef(null);
  const [winW, setWinW] = useState(0);
  useLayoutEffect(() => {
    const el = winRef.current;
    if (!el) return undefined;
    const measure = () => setWinW(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const ppm = ppmFor(winW, windowMm);
  const lo = Math.max(0, Math.floor((mm - windowMm - 20) / 10));
  const hi = Math.min(maxMm / 10, Math.ceil((mm + 20) / 10));
  const marks = [];
  for (let c = lo; c <= hi; c++) {
    if (c !== 0) marks.push(c);
  }
  const ribbonW = maxMm * ppm;
  return (
    <div className={`tm-tape ${className}`}>
      <div className="tm-window" ref={winRef}>
        <div
          className="tm-ribbon"
          style={{
            width: `${ribbonW}px`,
            transform: `translateX(${mm * ppm - ribbonW}px)`,
            "--ppm": `${ppm}px`,
            "--p5": `${ppm * 5}px`,
            "--p10": `${ppm * 10}px`,
            "--p50": `${ppm * 50}px`,
            "--p100": `${ppm * 100}px`,
          }}
        >
          {marks.map((c) => (
            <b key={c} className={`tm-num ${c % 10 === 0 ? "dm" : ""}`} style={{ right: `${c * 10 * ppm}px` }}>
              {c}
            </b>
          ))}
          <i className="tm-hook" />
        </div>
      </div>
      <div className="tm-case" aria-hidden="true">
        <span className="tm-case-disc">
          <small>WHO·IS·WHO</small>
          <b>5m</b>
        </span>
        <span className="tm-case-lock" />
        <span className="tm-case-mouth" />
      </div>
    </div>
  );
}

/**
 * The phone's tape, life-size: the whole screen is the stage (pull anywhere).
 * The blade (16 mm) grows up out of the case's mouth to the top of the screen at
 * most; the case is life-size too (62 mm) — only its top shows above the
 * screen's bottom edge. `scale` prints the blade (mm ticks, every cm numbered
 * from the hook down); otherwise it is blank. Reports how much tape fits (`onMax`, mm).
 */
function VTape({ mm, scale, locked, onMax, className = "", children, ...stageProps }) {
  const winRef = useRef(null);
  useLayoutEffect(() => {
    const el = winRef.current;
    if (!el) return undefined;
    const measure = () => onMax?.(Math.floor(el.clientHeight / PX_PER_MM));
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [onMax]);
  const marks = [];
  if (scale) for (let c = 1; c * 10 <= mm; c++) marks.push(c);
  return (
    <div className={`tm-vtape ${locked ? "locked" : ""} ${className}`} style={{ "--mm": `${PX_PER_MM}px` }} {...stageProps}>
      <div className="tm-vwindow" ref={winRef}>
        <div className={`tm-vblade ${scale ? "scaled" : ""}`} style={{ height: `${mm * PX_PER_MM}px` }}>
          {marks.map((c) => (
            <b key={c} className="tm-vnum" style={{ top: `${c * 10 * PX_PER_MM}px` }}>
              {c}
            </b>
          ))}
          <i className="tm-vhook" />
        </div>
      </div>
      <div className="tm-bigcase" aria-hidden="true">
        <span className="tm-bigcase-mouth" />
        <span className="tm-bigcase-lock" />
        <span className="tm-bigcase-brand">WHO·IS·WHO · 3m</span>
        <span className="tm-bigcase-disc" />
      </div>
      {children}
    </div>
  );
}

/** A tape on the TV that keeps being pulled out and snapped back (decoration only). */
function IdleTape({ windowMm = 420, fast = false }) {
  const [mm, setMm] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const draw = () => {
      const t = (performance.now() - t0) / (fast ? 2600 : 4200);
      const phase = t % 1;
      // out (eased), a wobble at the end, then a quick snap back
      const v = phase < 0.72 ? Math.sin((phase / 0.72) * Math.PI * 0.5) : phase < 0.86 ? 1 + Math.sin(((phase - 0.72) / 0.14) * Math.PI * 3) * 0.01 : 1 - (phase - 0.86) / 0.14;
      setMm(Math.max(0, v) * windowMm * 0.9);
      raf = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(raf);
  }, [windowMm, fast]);
  return <Tape mm={mm} windowMm={windowMm} className="tm-tape-tv" />;
}

function Title({ small }) {
  return (
    <header className={`tm-head ${small ? "small" : ""}`}>
      <h2 className="tm-title">
        ДО <em>МІЛІМЕТРА!</em>
      </h2>
      <i className="tm-hazard" />
    </header>
  );
}

function Lives({ n }) {
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return <p className="tm-lives dead">💀 Життів не лишилось — тепер ти привид</p>;
  return (
    <div className="tm-lives">
      <span>Залишилось життів</span>
      <b>{"❤".repeat(Math.min(10, n))}</b>
    </div>
  );
}

function TimeBar({ msLeft, totalMs }) {
  const frac = totalMs ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const secs = Math.ceil(msLeft / 1000);
  return (
    <div className={`tm-time ${secs <= 5 ? "hot" : ""}`}>
      <div className="tm-time-bar">
        <i style={{ transform: `scaleX(${frac})` }} />
      </div>
      <b>{secs}</b>
    </div>
  );
}

// ---------------------------------------------------------------- the round result (TV)

const NICE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200];
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** The tapes side by side: they run out in turn on a wide view, then it zooms in on the target. */
function ResultLanes({ rows, target, nm, slotsById }) {
  const [t, setT] = useState(0);
  const bodyRef = useRef(null);
  const [trackW, setTrackW] = useState(800);
  useLayoutEffect(() => {
    const track = bodyRef.current?.querySelector(".tm-lane-track");
    if (track) setTrackW(track.clientWidth || 800);
  }, []);
  useEffect(() => {
    let raf = 0;
    const t0 = gameClock.now();
    const draw = () => {
      const el = gameClock.now() - t0;
      setT(el);
      if (el < REVEAL.ZOOM_AT + REVEAL.ZOOM_MS + 200) raf = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const done = rows.filter((r) => r.mm != null);
  const maxVal = Math.max(target, ...done.map((r) => r.mm));
  const wide = { from: 0, to: Math.ceil((Math.max(target * 1.3, maxVal * 1.06) + 1) / 50) * 50 };
  const maxErr = Math.max(0, ...done.map((r) => r.err));
  const zr = Math.max(8, Math.min(150, maxErr * 1.3 + 2));
  const zoom = { from: target - zr, to: target + zr };
  const q = ease(clamp01((t - REVEAL.ZOOM_AT) / REVEAL.ZOOM_MS));
  const from = wide.from + (zoom.from - wide.from) * q;
  const to = wide.to + (zoom.to - wide.to) * q;
  const span = to - from;
  const x = (v) => ((v - from) / span) * 100; // % across the track
  const zoomed = t >= REVEAL.ZOOM_AT;
  const step = NICE_STEPS.find((s) => span / s <= 10) || 200;
  const axis = [];
  for (let v = Math.ceil(from / step) * step; v <= to; v += step) axis.push(v);
  const factor = Math.round(wide.to / (zoom.to - zoom.from));
  // the blade's printed ticks in px of the track: cm always, mm once they are far enough apart
  const pxPerMm = trackW / span;
  const shift = (v) => `${-(((from % v) + v) % v) * pxPerMm}px 0`;
  // one tick per tile, the tile one period wide: no seams however the period divides the track
  const layers = [["linear-gradient(90deg, #141414 0 2px, transparent 2px)", `${10 * pxPerMm}px 46%`, shift(10)]];
  if (pxPerMm >= 4) layers.unshift(["linear-gradient(90deg, rgba(20, 20, 20, 0.8) 0 1px, transparent 1px)", `${pxPerMm}px 22%`, shift(1)]);
  const ticks = {
    backgroundImage: [...layers.map((l) => l[0]), "linear-gradient(180deg, #fff3a0, #ffd21f 22%, #f2bb00 82%, #c79800)"].join(", "),
    backgroundSize: [...layers.map((l) => l[1]), "100% 100%"].join(", "),
    backgroundPosition: [...layers.map((l) => l[2]), "0 0"].join(", "),
    backgroundRepeat: [...layers.map(() => "repeat-x"), "no-repeat"].join(", "),
  };

  return (
    <div className={`tm-lanes ${zoomed ? "zoomed" : ""}`}>
      {zoomed && (
        <span className="tm-zoom-badge" key="zoom">
          🔍 ×{factor}
        </span>
      )}
      <div className="tm-lanes-body" ref={bodyRef}>
        <span className="tm-lane-overlay">
          <span className="tm-lane-target" style={{ left: `${x(target)}%` }}>
            <em>{cm(target)} см</em>
          </span>
        </span>
        {rows.map((r, k) => {
          const p = ease(clamp01((t - REVEAL.START - k * REVEAL.STAGGER) / REVEAL.RUN));
          const shown = r.mm == null ? 0 : r.mm * p;
          const tip = Math.max(0, Math.min(100, x(shown)));
          const best = r.place === 1;
          return (
            <div key={r.id} className={`tm-lane ${best && zoomed ? "best" : ""} ${r.mm == null ? "miss" : ""}`}>
              <span className="tm-lane-who">
                <img src={SPRITE(slotsById[r.id])} alt="" />
                <b>{nm(r.id)}</b>
              </span>
              <span className="tm-lane-track">
                <span className="tm-lane-case" style={{ opacity: 1 - q }} />
                {r.mm != null ? (
                  <>
                    {/* the blade spans the track and is clipped at its tip: the ticks stay where their mm are */}
                    <span className="tm-lane-blade" style={{ clipPath: `inset(0 ${100 - tip}% 0 0)`, ...ticks }} />
                    <span className="tm-lane-tip" style={{ left: `${tip}%` }}>
                      <em>{cm(shown)}</em>
                      {zoomed && <small className={r.err <= 3 ? "good" : r.err >= 30 ? "bad" : ""}>{signedMm(r.mm, target)}</small>}
                      {best && zoomed && <span className="tm-lane-crown">🎯</span>}
                    </span>
                  </>
                ) : (
                  <span className="tm-lane-none">не встиг</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="tm-axis">
        {axis.map((v) => (
          <span key={`${step}-${v}`} style={{ left: `${x(v)}%` }}>
            {cm(v)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- component

export default function TapeMeasureMinigame({
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
  const [go, setGo] = useState(null);
  const [round, setRound] = useState(null);
  const [practice, setPractice] = useState(null); // { startAt, endAt }
  const [roundResults, setRoundResults] = useState({});
  const [progress, setProgress] = useState({ busyIds: [], lockedIds: [] });
  const [acks, setAcks] = useState({}); // round -> mm (this phone's lock is in)
  const [, setTick] = useState(0);
  const offsetRef = useRef(0);
  const soundRef = useRef({});
  const sceneDoneRef = useRef(false);

  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return undefined;
    const seed = (d) => {
      if (Number.isFinite(Number(d?.serverNow))) offsetRef.current = Number(d.serverNow) - gameClock.now();
    };
    const onGo = (d) => {
      if (!Number.isFinite(Number(d?.introEndsAt))) return;
      seed(d);
      setGo(d);
    };
    const onRound = (d) => {
      if (!Number.isFinite(Number(d?.startAt))) return;
      seed(d);
      setRound(d);
    };
    const onPractice = (d) => {
      if (!Number.isFinite(Number(d?.endAt))) return;
      seed(d);
      setPractice({ startAt: Number(d.startAt), endAt: Number(d.endAt) });
    };
    const onProgress = (d) => setProgress({ busyIds: d?.busyIds || [], lockedIds: d?.lockedIds || [] });
    const onAck = (d) => d?.round && setAcks((a) => ({ ...a, [d.round]: Number(d.mm) }));
    const onResult = (d) => d?.round && setRoundResults((m) => ({ ...m, [d.round]: d }));
    socket.on("tm:go", onGo);
    socket.on("tm:round", onRound);
    socket.on("tm:practice", onPractice);
    socket.on("tm:progress", onProgress);
    socket.on("tm:ack", onAck);
    socket.on("tm:roundResult", onResult);
    return () => {
      socket.off("tm:go", onGo);
      socket.off("tm:round", onRound);
      socket.off("tm:practice", onPractice);
      socket.off("tm:progress", onProgress);
      socket.off("tm:ack", onAck);
      socket.off("tm:roundResult", onResult);
    };
  }, [socket]);

  useEffect(() => {
    if (!isActive || !socket) return;
    if (isDisplay) socket.emit("minigameDisplayEvent", { name: "tm:hello", data: {} });
    else if (amContestant) socket.emit("minigameEvent", { name: "tm:hello", data: {} });
  }, [isActive, socket, isDisplay, amContestant]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  // ---------------------------------------------------------------- phase
  const isFinal = !!results && results.minigameId === "tapeMeasure" && !!results.tapeMeasure;
  const now = gameClock.now() + offsetRef.current;
  const result = round ? roundResults[round.round] : null;
  const phase = isFinal
    ? "final"
    : !go
      ? "wait"
      : !round
        ? practice
          ? "practice"
          : "prep"
        : result
          ? "result"
          : now < round.startAt
            ? "intro"
            : now < round.endAt
              ? "pull"
              : "closing";
  const countdown = phase === "intro" ? Math.ceil((round.startAt - now) / 1000) : null;
  const target = round?.targetMm || 0;
  const nm = (id) => namesById[id] || "Гравець";

  // ---------------------------------------------------------------- the phone's tape
  const [len, setLen] = useState(0);
  const lenRef = useRef(0);
  const drag = useRef(null); // { id, y, travel }
  const ratchet = useRef(null);
  const busySent = useRef({});
  const [shake, setShake] = useState(0);
  const myLock = round ? acks[round.round] : undefined;
  const [pending, setPending] = useState({}); // round -> true (lock sent, no ack yet)
  const practicing = phase === "practice";
  const canPull = !isDisplay && amContestant && (practicing || (phase === "pull" && myLock == null && !pending[round?.round]));
  // the blade never runs off the top of the phone's screen (nor past the tape's end)
  const [reach, setReach] = useState(0); // mm that fit on this phone
  const maxMm = Math.min(round?.maxMm || go?.maxMm || 200, reach || 200);

  const setLength = useCallback(
    (v) => {
      const next = Math.max(0, Math.min(maxMm, v));
      lenRef.current = next;
      setLen(next);
    },
    [maxMm]
  );
  // a new round: the tape snaps back in
  const roundNo = round?.round;
  useEffect(() => {
    lenRef.current = 0;
    setLen(0);
  }, [roundNo]);
  useEffect(() => {
    if (!canPull) drag.current = null;
  }, [canPull]);

  const onDown = (e) => {
    if (!canPull) return;
    ratchet.current = ratchet.current || makeRatchet();
    ratchet.current.unlock();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId); // keep the drag when the finger leaves the tape
    } catch {
      /* not a live pointer (synthetic): the drag still works inside the tape */
    }
    drag.current = { id: e.pointerId, y: e.clientY, travel: 0 };
    if (round && !practicing && !busySent.current[round.round]) {
      busySent.current[round.round] = true;
      socket?.emit("minigameEvent", { name: "tm:busy", data: { round: round.round } });
    }
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !canPull) return;
    const dy = d.y - e.clientY; // up = out; only along the blade, a sideways wobble changes nothing
    d.y = e.clientY;
    setLength(lenRef.current + dy / PX_PER_MM); // life-size: the blade's end stays under the finger
    // the ratchet rattles with the finger's travel, not per cm (no counting clicks to the target)
    d.travel += Math.abs(dy);
    if (d.travel >= 14) {
      d.travel %= 14;
      ratchet.current?.tick(false);
    }
  };
  const onUp = (e) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const lock = () => {
    if (!canPull || practicing) return;
    drag.current = null;
    ratchet.current = ratchet.current || makeRatchet();
    ratchet.current.clack();
    setShake((s) => s + 1);
    setPending((p) => ({ ...p, [round.round]: true }));
    socket?.emit("minigameEvent", { name: "tm:lock", data: { round: round.round, mm: Math.round(lenRef.current * 10) / 10 } });
  };

  // ---------------------------------------------------------------- sounds (TV)
  // a soft bed under the whole minigame, from the rules to the final board
  const musicOn = isDisplay && phase !== "wait";
  useEffect(() => (musicOn ? loop(SOUND.music, 0.22) : undefined), [musicOn]);
  const workshopOn = isDisplay && phase === "pull";
  useEffect(() => (workshopOn ? loop(SOUND.workshop, 0.5) : undefined), [workshopOn]);
  const lockedCount = progress.lockedIds.length;
  const prevLocked = useRef(0);
  useEffect(() => {
    if (isDisplay && phase === "pull" && lockedCount > prevLocked.current) sfx(SOUND.lock, 0.55);
    prevLocked.current = lockedCount;
  }, [lockedCount, isDisplay, phase]);
  const soundKey = !isDisplay || !round ? null : phase === "intro" && countdown <= 3 ? `${round.round}c${countdown}` : phase === "pull" ? `${round.round}s` : phase === "result" ? `${round.round}r` : null;
  useEffect(() => {
    if (!soundKey || soundRef.current[soundKey]) return;
    soundRef.current[soundKey] = true;
    if (soundKey.includes("c")) sfx(SOUND.beep, 0.45);
    else if (soundKey.endsWith("s")) sfx(SOUND.start, 0.6);
    else if (soundKey.endsWith("r") && result) {
      const done = result.rows.filter((r) => r.mm != null);
      gameClock.setTimeout(() => sfx(SOUND.extend, 0.55), REVEAL.START);
      gameClock.setTimeout(() => sfx(SOUND.zoom, 0.6), REVEAL.ZOOM_AT);
      if (done.length) {
        const worst = done[done.length - 1];
        const big = done.length > 1 && worst.err >= 30;
        gameClock.setTimeout(() => sfx(big ? SOUND.fail : done[0].err <= 1 ? SOUND.perfect : "/assets/sounds/result.mp3", 0.6), REVEAL.JOKE_AT);
      }
    }
  }, [soundKey, result]);
  const amLoser = isFinal && (results.loserIds || []).includes(myPlayerId);
  useEffect(() => {
    if (!isFinal || soundRef.current.final) return;
    soundRef.current.final = true;
    if (isDisplay) {
      sfx(SOUND.fanfare, 0.55);
      if ((results.loserIds || []).length) gameClock.setTimeout(() => sfx(LOSE_SOUNDS[Math.floor(Math.random() * 4)], 0.8), 2800);
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

  const cls = `tm-root ${isDisplay ? "tm-display" : "tm-mobile"}`;
  const levelTag = round && (
    <span className="tm-round-tag">
      Раунд {round.round}/{round.of} · {round.level}
    </span>
  );

  // ================================================================== final
  if (phase === "final") {
    const f = results.tapeMeasure;
    const loserIds = results.loserIds || [];
    const shielded = (f.lowestIds || []).filter((id) => !loserIds.includes(id));
    const place = (id) => 1 + f.ranked.filter((x) => f.totals[x] > f.totals[id] || (f.totals[x] === f.totals[id] && f.errSum[x] < f.errSum[id])).length;
    if (!isDisplay) {
      if (!f.ranked.includes(myPlayerId)) {
        return (
          <section className={cls}>
            <Title small />
            <p className="tm-muted">Дивись результати на головному екрані!</p>
          </section>
        );
      }
      const lost = loserIds.includes(myPlayerId);
      const won = f.winnerId === myPlayerId;
      return (
        <section className={`${cls} ${lost ? "lost" : won ? "won" : ""}`}>
          <Title small />
          <p className="tm-score">
            <b>{f.totals[myPlayerId] || 0}</b> балів
          </p>
          <p className="tm-place">
            {place(myPlayerId)} місце з {f.ranked.length}
          </p>
          <div className="tm-my-rounds">
            {f.rounds.map((r) => {
              const row = r.rows.find((x) => x.id === myPlayerId);
              return (
                <span key={r.round}>
                  <small>{cm(r.targetMm)} см</small>
                  <b>{row?.mm != null ? cm(row.mm) : "—"}</b>
                  <i>+{row?.points || 0}</i>
                </span>
              );
            })}
          </div>
          <p className={`tm-big ${lost ? "bad" : won ? "good" : ""}`}>
            {lost ? "МІНУС ЖИТТЯ" : won ? "ЗОЛОТІ РУКИ!" : shielded.includes(myPlayerId) ? "ОСТАННІЙ, АЛЕ 🛡 ВІКТОРИНА ВРЯТУВАЛА" : loserIds.length || shielded.length ? "ТИ В БЕЗПЕЦІ" : "НІЧИЯ — ВСІ ЖИВІ"}
          </p>
          {lost && (
            <>
              <p className="tm-life">−1 ❤</p>
              {/* the server takes the life only after this scene, so count it in here */}
              <Lives n={Number(results.livesById?.[myPlayerId]) - 1} />
            </>
          )}
        </section>
      );
    }
    return (
      <section className={`${cls} tm-final`}>
        <Title small />
        <div className="tm-board">
          <div className="tm-board-row head">
            <span />
            <span />
            <span className="tm-board-name">Майстер</span>
            {f.rounds.map((r) => (
              <span key={r.round} className="tm-board-cell">
                {cm(r.targetMm)} см
              </span>
            ))}
            <span className="tm-board-total">Разом</span>
          </div>
          {f.ranked.map((id, k) => {
            const lost = loserIds.includes(id);
            const won = f.winnerId === id;
            return (
              <div key={id} className={`tm-board-row ${lost || shielded.includes(id) ? "lost" : ""} ${won ? "top" : ""}`} style={{ "--k": f.ranked.length - k }}>
                <span className="tm-board-place">{placeWord(place(id))}</span>
                <img className="tm-ava" src={SPRITE(slotsById[id])} alt="" />
                <span className="tm-board-name">
                  {won && "👑 "}
                  {nm(id)}
                </span>
                {f.rounds.map((r) => {
                  const row = r.rows.find((x) => x.id === id);
                  return (
                    <span key={r.round} className={`tm-board-cell ${row?.place === 1 ? "best" : ""}`}>
                      <b>{row?.mm != null ? cm(row.mm) : "—"}</b>
                      <i>+{row?.points || 0}</i>
                    </span>
                  );
                })}
                <span className="tm-board-total">{f.totals[id] || 0}</span>
                {lost && <span className="tm-board-minus">−1 ❤</span>}
                {shielded.includes(id) && <span className="tm-board-minus shield">🛡</span>}
              </div>
            );
          })}
        </div>
        <p className={`tm-verdict ${loserIds.length ? "" : "draw"}`}>
          {loserIds.length
            ? `Найкривіші руки: ${loserIds.map(nm).join(", ")} — мінус життя!`
            : shielded.length
              ? `Найкривіші руки: ${shielded.map(nm).join(", ")} — але правильна відповідь у вікторині рятує життя!`
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
          <p className="tm-muted">Цього разу ти глядач. Дивись на головний екран!</p>
        </section>
      );
    }
    if (phase === "wait" || phase === "prep") {
      return (
        <section className={cls}>
          <Title />
          <div className="tm-phone-hint">
            <b>📏 Рулетка справжнього розміру</b>
            <span>1 см на екрані — це 1 см. Тягни пальцем угору, вниз — щоб укоротити; можна кілька разів.</span>
            <span>Спершу тестовий замір зі шкалою, далі три заміри на око. Підкоригуй і тисни «ЗАФІКСУВАТИ».</span>
          </div>
        </section>
      );
    }
    if (phase === "intro") {
      return (
        <section className={cls}>
          {levelTag}
          <p className="tm-target-label">Потрібно витягнути</p>
          <p className="tm-target-big">{cm(target)} см</p>
          <p className="tm-hint-small">{ROUND_RULE}</p>
          {countdown <= 3 && (
            <div className="tm-countdown" key={countdown}>
              {countdown}
            </div>
          )}
        </section>
      );
    }
    if (phase === "result") {
      const row = result.rows.find((r) => r.id === myPlayerId);
      return (
        <section className={`${cls} tm-phone-result ${row?.place === 1 ? "won" : ""}`}>
          {levelTag}
          <p className="tm-target-label">Ціль {cm(target)} см · твій замір</p>
          {row?.mm != null ? (
            <>
              <p className="tm-my-len">
                {cm(row.mm)} <small>см</small>
              </p>
              <p className={`tm-diff ${row.err <= 3 ? "good" : row.err >= 30 ? "bad" : ""}`}>
                {signedMm(row.mm, target)}
                {row.err >= 0.05 ? (row.mm > target ? " · перетягнув" : " · недотягнув") : ""}
              </p>
              <p className="tm-place">
                {placeWord(row.place)} {row.place > 3 ? "місце" : ""} · <b>+{row.points}</b>
              </p>
            </>
          ) : (
            <p className="tm-big bad">Не встиг 😬 · +0</p>
          )}
          <p className="tm-total">
            Разом: <b>{result.totals?.[myPlayerId] || 0}</b>
          </p>
        </section>
      );
    }
    const locked = !practicing && (myLock != null || !!pending[round.round]);
    const shownLen = practicing ? len : myLock != null ? myLock : len;
    const lenText = `${cm(shownLen).replace(".", ",")} см`;
    return (
      <section className={`${cls} tm-phone-pull ${locked ? "is-locked" : ""} ${practicing ? "practice" : ""}`}>
        <VTape
          key={`shake-${shake}`}
          mm={shownLen}
          scale={practicing}
          locked={locked}
          onMax={setReach}
          className={shake ? "shake" : ""}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {/* what to do: left of the blade; the clock: right of it (the blade keeps the middle) */}
          <div className="tm-over left">
            {practicing ? (
              <>
                <p className="tm-side-label">Тренування</p>
                <p className="tm-side-note">
                  Тягни до самого верху: на твоєму телефоні це <b>{cm(reach).replace(".", ",")} см</b>.
                </p>
                <p className="tm-side-note">Запам'ятай, як виглядають 3, 5, 7 см — далі шкали не буде!</p>
              </>
            ) : (
              <>
                <p className="tm-side-label">Витягни</p>
                <p className="tm-side-big">{cm(target).replace(".", ",")} см</p>
                {phase === "closing" && !locked ? (
                  <p className="tm-side-note bad">Час вийшов 😬</p>
                ) : locked ? (
                  <p className="tm-side-note">Не чіпай, майстре! Чекаємо інших…</p>
                ) : (
                  <p className="tm-side-note">На око. Вниз — укоротити.</p>
                )}
              </>
            )}
          </div>
          <div className="tm-over right">
            {practicing ? (
              <>
                <span className="tm-round-tag">Тест</span>
                <TimeBar msLeft={Math.max(0, practice.endAt - now)} totalMs={practice.endAt - practice.startAt} />
                <p className="tm-side-label">Зараз</p>
                <p className="tm-side-big">{lenText}</p>
              </>
            ) : (
              <>
                <span className="tm-round-tag">
                  {round.round}/{round.of}
                </span>
                <TimeBar msLeft={Math.max(0, round.endAt - now)} totalMs={round.endAt - round.startAt} />
              </>
            )}
          </div>
          {!locked && shownLen < 8 && canPull && <span className="tm-grab">👆 тягни</span>}
          {locked && <span className="tm-stamp">ЗАФІКСОВАНО</span>}
          {!practicing && (
            <button type="button" className="tm-lock-btn" onPointerDown={(e) => e.stopPropagation()} onClick={lock} disabled={!canPull}>
              {locked ? "🔒 ГОТОВО" : "ЗАФІКСУВАТИ"}
            </button>
          )}
        </VTape>
      </section>
    );
  }

  // ================================================================== TV
  if (phase === "wait" || phase === "prep" || phase === "practice") {
    return (
      <section className={`${cls} tm-prep`}>
        <Title />
        {practice ? (
          <div className="tm-practice-bar">
            <span>📱 Поки читаєте правила — тягайте рулетку на телефоні: вона справжнього розміру й зі шкалою</span>
            <TimeBar msLeft={Math.max(0, practice.endAt - now)} totalMs={practice.endAt - practice.startAt} />
          </div>
        ) : (
          <IdleTape />
        )}
        <div className="tm-rules">
          <div className="tm-rule" style={{ "--i": 0 }}>
            <b>👉</b>
            <span>
              Рулетка на телефоні <u>справжнього розміру</u>. Тягни її вгору, підкоригуй і тисни <u>ЗАФІКСУВАТИ</u>
            </span>
          </div>
          <div className="tm-rule" style={{ "--i": 1 }}>
            <b>🎯</b>
            <span>Найточніший +5 · другий +3 · третій +2 · решта +1</span>
          </div>
          <div className="tm-rule" style={{ "--i": 2 }}>
            <b>🙈</b>
            <span>
              Зараз шкала є — запам'ятовуй, як виглядають сантиметри. У замірах її <u>не буде</u>: тільки на око
            </span>
          </div>
          <div className="tm-rule bad" style={{ "--i": 3 }}>
            <b>💀</b>
            <span>Найменше балів за 3 заміри — мінус життя</span>
          </div>
        </div>
        <div className="tm-rounds">
          {(go?.rounds || []).map((r, i) => (
            <div key={r.index} className="tm-round-card" style={{ "--i": i }}>
              <small>Замір {r.index}</small>
              <b>{r.level}</b>
              <span>ціль 1–7 см · {ROUND_RULE}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (phase === "result") {
    const rows = result.rows;
    return (
      <section className={`${cls} tm-result`}>
        <div className="tm-result-top">
          {levelTag}
          <h3 className="tm-result-title">
            Ціль — <b>{cm(target)} см</b>
          </h3>
        </div>
        <ResultLanes rows={rows} target={target} nm={nm} slotsById={slotsById} />
        <p className="tm-joke">🎙 {jokeFor(rows, target, nm)}</p>
        <div className={`tm-table ${rows.length > 4 ? "two" : ""}`}>
          {rows.map((r, k) => (
            <div key={r.id} className={`tm-table-row ${r.place === 1 ? "best" : ""} ${r.mm == null ? "miss" : ""}`} style={{ "--k": k }}>
              <span className="tm-table-place">{r.place ? placeWord(r.place) : "—"}</span>
              <span className="tm-table-name">{nm(r.id)}</span>
              <span className="tm-table-len">{r.mm != null ? `${cm(r.mm)} см` : "не встиг"}</span>
              <span className="tm-table-err">{r.mm != null ? signedMm(r.mm, target) : ""}</span>
              <span className="tm-table-pts">+{r.points}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // intro / measuring
  const intro = phase === "intro";
  return (
    <section className={`${cls} tm-live ${phase}`}>
      <div className="tm-live-top">
        {levelTag}
        {!intro && <TimeBar msLeft={Math.max(0, round.endAt - now)} totalMs={round.endAt - round.startAt} />}
      </div>
      {intro && (
        <p className="tm-host" key={round.round}>
          🎙 {round.host}
        </p>
      )}
      <div className="tm-target-sign" key={`t-${round.round}`}>
        <small>ВИТЯГНИ</small>
        <b>{cm(target)} см</b>
        <span>{ROUND_RULE}</span>
      </div>
      {intro && countdown <= 3 ? (
        <div className="tm-countdown" key={countdown}>
          {countdown}
        </div>
      ) : (
        <IdleTape fast={!intro} />
      )}
      <div className="tm-players">
        {contestantIds.map((id) => {
          const isLocked = progress.lockedIds.includes(id);
          const busy = progress.busyIds.includes(id);
          return (
            <span key={id} className={`tm-player ${isLocked ? "done" : busy ? "busy" : ""}`}>
              <img src={SPRITE(slotsById[id])} alt="" />
              <b>{nm(id)}</b>
              <small>{isLocked ? "🔒 зафіксував" : busy ? "📏 міряє…" : intro ? "готується" : "чекає"}</small>
            </span>
          );
        })}
      </div>
    </section>
  );
}

