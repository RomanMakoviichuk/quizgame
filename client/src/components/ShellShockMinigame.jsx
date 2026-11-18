import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./ShellShockMinigame.css";
import gameClock from "../game/gameClock";
import { playVictory } from "../game/victory";

/**
 * «Не кліпай!» (id: shellShock) — the shell game. Server-authoritative
 * (server/minigames/shellShock.js): the server deals each round's moves once,
 * keeps the answer and scores. The TV replays the moves from the server clock
 * (a reload picks the same sequence up mid-way); the phones only get timings
 * and answer with a final position 1..3.
 *
 * Events in:  ss:go { prepEndsAt, rounds, serverNow }
 *             ss:round { round, of, level, points, host, object, introAt, revealAt, coverAt, shuffleAt, answerAt, endAt, serverNow }
 *             ss:show { ...ss:round, start, objectCup, moves, coverMs }   (the TV only)
 *             ss:progress { round, answeredIds }   ss:ack { round, pick }
 *             ss:roundResult { round, correct, objectCup, final, rows, quip, totals, ranked, nextAt, serverNow }
 * Events out: minigameEvent ss:pick { round, pos } | ss:hello;  minigameDisplayEvent ss:hello (the TV)
 * Results:    results.shellShock { rounds: [{ round, level, points, correct, rows }], totals, ranked, winnerId, lowestIds }
 */

const DIR = "/assets/minigames/shell-shock"; // optional sounds (README there); synthesized / shared ones otherwise
const MUSIC = `${DIR}/background.mp3`;
const SPRITE = (slot) => `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/sounds/lose/${n}.mp3`);
const CUPS = ["c1", "c2", "c3"];
const POS_NAME = ["ЛІВИЙ", "СЕРЕДНІЙ", "ПРАВИЙ"];
const TICK_MS = 100;
const LIFT_MS = 420; // a cup goes up / comes down
// the round's reveal on the TV (ms after the result came): the empty cups, then the right one
const REVEAL = { OTHERS: 900, RIGHT: 2100, TABLE: 3000 };
const FINAL_SCENE_MS = 12500;

function sfx(src, volume = 0.6) {
  try {
    const a = new Audio(src);
    a.volume = volume;
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

// ---------------------------------------------------------------- synthesized sounds (no files needed)
let audioCtx = null;
function ac() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}
function noiseBurst(c, ms) {
  const len = Math.max(1, Math.floor((c.sampleRate * ms) / 1000));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}
/** A cup sliding over the table: a short band-passed swish. */
function swish(ms, volume = 0.12) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const dur = Math.min(0.5, Math.max(0.12, ms / 1000));
  const n = noiseBurst(c, dur * 1000);
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(700, t);
  f.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(volume, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(c.destination);
  n.start(t);
}
/** A cup set down on wood: a dull knock. */
function knock(volume = 0.35, pitch = 160) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(pitch, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.45, t + 0.12);
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.18);
  const n = noiseBurst(c, 40);
  const ng = c.createGain();
  ng.gain.setValueAtTime(volume * 0.35, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  n.connect(ng).connect(c.destination);
  n.start(t);
}
/** The thing shows: a little sparkle. */
function sparkle(volume = 0.12) {
  const c = ac();
  if (!c) return;
  [1320, 1760, 2640].forEach((hz, i) => {
    const t = c.currentTime + i * 0.07;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "triangle";
    o.frequency.value = hz;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.4);
  });
}

// ---------------------------------------------------------------- the cups' poses (pure)

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/**
 * Every cup's pose at server time `t`, straight from the round's moves:
 *   x: -1 / 0 / 1 (left / middle / right, fractions while moving)
 *   y: depth while crossing (+ = towards the viewer, - = behind), in cup heights
 *   s: scale (the cup in front grows a little), z: stacking, lift: 0..1 (raised)
 * `result` (the round's verdict, with the server time it came) lifts the cups.
 */
function posesAt(show, t, result) {
  const out = {};
  const settle = (pos) => CUPS.forEach((c) => (out[c] = { x: pos[c] - 1, y: 0, s: 1, z: 2, lift: 0 }));
  const e = t - show.shuffleAt;
  let pos = show.start;
  let cur = null;
  let moveIndex = -1;
  if (e >= 0) {
    for (let i = 0; i < show.moves.length; i++) {
      const m = show.moves[i];
      if (e >= m.at + m.ms) {
        pos = m.to;
        moveIndex = i;
      } else {
        if (e >= m.at) {
          cur = m;
          moveIndex = i;
        }
        break;
      }
    }
  }
  settle(cur ? cur.from : pos);
  if (cur) {
    const p = Math.min(1, (e - cur.at) / cur.ms);
    const arc = Math.sin(Math.PI * p);
    if (cur.kind === "feint") {
      // two neighbours lean into a swap and slide back
      const [a, b] = cur.pair;
      const dir = Math.sign(cur.from[b] - cur.from[a]);
      const k = 0.42 * arc;
      out[a].x = cur.from[a] - 1 + dir * k;
      out[b].x = cur.from[b] - 1 - dir * k;
      for (const c of [a, b]) {
        const f = c === cur.front;
        out[c].y = (f ? 0.1 : -0.1) * arc;
        out[c].s = 1 + (f ? 0.05 : -0.05) * arc;
        out[c].z = f ? 3 : 1;
      }
    } else {
      const pe = ease(p);
      for (const c of CUPS) {
        const fx = cur.from[c];
        const tx = cur.to[c];
        if (fx === tx) continue;
        const f = c === cur.front;
        const depth = (Math.abs(tx - fx) > 1 ? 0.24 : 0.15) * arc;
        out[c].x = fx - 1 + (tx - fx) * pe;
        out[c].y = f ? depth : -depth;
        out[c].s = 1 + (f ? 0.09 : -0.07) * arc;
        out[c].z = f ? 3 : 1;
      }
    }
  }
  // the reveal: the thing's cup goes up, then comes down over it
  if (t >= show.revealAt && t < show.shuffleAt) {
    const up = ease(Math.min(1, (t - show.revealAt) / LIFT_MS));
    const down = t >= show.coverAt ? ease(Math.min(1, (t - show.coverAt) / Math.max(1, show.coverMs))) : 0;
    out[show.objectCup].lift = up * (1 - down);
  }
  // the verdict: the empty cups go up, then the right one
  if (result) {
    const rt = t - result.at;
    for (const c of CUPS) {
      const at = c === show.objectCup ? REVEAL.RIGHT : REVEAL.OTHERS;
      out[c].lift = Math.max(out[c].lift, ease(Math.max(0, Math.min(1, (rt - at) / LIFT_MS))) * (c === show.objectCup ? 1 : 0.8));
    }
  }
  return { poses: out, moveIndex, moving: !!cur };
}

// ---------------------------------------------------------------- small parts

function Title({ small }) {
  return (
    <header className={`ss-head ${small ? "small" : ""}`}>
      <h2 className="ss-title">
        НЕ <em>КЛІПАЙ!</em>
      </h2>
      <p className="ss-sub">наперстки · три стаканчики · одна річ</p>
    </header>
  );
}

function TimeBar({ msLeft, totalMs }) {
  const frac = totalMs ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const secs = Math.ceil(msLeft / 1000);
  return (
    <div className={`ss-time ${secs <= 3 ? "hot" : ""}`}>
      <div className="ss-time-bar">
        <i style={{ transform: `scaleX(${frac})` }} />
      </div>
      <b>{secs}</b>
    </div>
  );
}

function Lives({ n }) {
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return <p className="ss-lives dead">💀 Життів не лишилось — тепер ти привид</p>;
  return (
    <div className="ss-lives">
      <span>Залишилось життів</span>
      <b>{"❤".repeat(Math.min(10, n))}</b>
    </div>
  );
}

/** The thing under the cup (a local picture; an emoji if it won't load). */
function Thing({ object, className = "" }) {
  const [src, setSrc] = useState(object?.src || null);
  useEffect(() => setSrc(object?.src || null), [object?.src]);
  if (!object || !src) return <span className={`ss-thing-emoji ${className}`}>🪙</span>;
  return <img className={className} src={src} alt={object.name || ""} draggable="false" onError={() => setSrc((s) => (s === object.fallback || !object.fallback ? null : object.fallback))} />;
}

const placeWord = (p) => (p === 1 ? "🥇" : p === 2 ? "🥈" : p === 3 ? "🥉" : `${p}`);

/** The metal for the cups: brushed brass, once per table (the cups point at these ids). */
function CupDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {/* across the body: dark edges, a hot highlight left of centre, a softer one on the right */}
        <linearGradient id="ss-brass" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#2a1804" />
          <stop offset="0.1" stopColor="#6e4511" />
          <stop offset="0.24" stopColor="#c9922f" />
          <stop offset="0.31" stopColor="#fff2c2" />
          <stop offset="0.36" stopColor="#e7b552" />
          <stop offset="0.55" stopColor="#a8701e" />
          <stop offset="0.72" stopColor="#d9a245" />
          <stop offset="0.8" stopColor="#8b5a16" />
          <stop offset="0.93" stopColor="#4a2c08" />
          <stop offset="1" stopColor="#24160a" />
        </linearGradient>
        {/* down the body: the warm spotlight from above, the felt's dark bounce at the foot */}
        <linearGradient id="ss-brass-shade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff6dc" stopOpacity="0.32" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.85" stopColor="#0b2a17" stopOpacity="0.18" />
          <stop offset="1" stopColor="#000" stopOpacity="0.38" />
        </linearGradient>
        <linearGradient id="ss-brass-ring" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#3a2206" />
          <stop offset="0.3" stopColor="#fff0b8" />
          <stop offset="0.55" stopColor="#b88329" />
          <stop offset="0.78" stopColor="#f0c76a" />
          <stop offset="1" stopColor="#3a2206" />
        </linearGradient>
        <radialGradient id="ss-brass-knob" cx="0.36" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#fffbe8" />
          <stop offset="0.25" stopColor="#f2c66a" />
          <stop offset="0.7" stopColor="#8b5a16" />
          <stop offset="1" stopColor="#2f1c06" />
        </radialGradient>
        <radialGradient id="ss-brass-top" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="0.6" stopColor="#b47c26" />
          <stop offset="1" stopColor="#4a2c08" />
        </radialGradient>
        <filter id="ss-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * One cup: a brass «cups and balls» cup in SVG (a flared body, two beaded rings,
 * a domed top with a knob, a thick rolled rim). All three are the same — the
 * eye has nothing but the movement to follow.
 */
function CupArt() {
  return (
    <svg className="ss-cup-svg" viewBox="0 0 200 224" aria-hidden="true">
      {/* the body: a gentle concave flare from the top to the rim */}
      <path d="M50 44 C46 92 30 150 12 196 L188 196 C170 150 154 92 150 44 Z" fill="url(#ss-brass)" />
      <path d="M50 44 C46 92 30 150 12 196 L188 196 C170 150 154 92 150 44 Z" fill="url(#ss-brass-shade)" />
      {/* a long specular streak and a faint second one */}
      <path d="M70 52 C66 100 54 150 42 190" stroke="#fffaf0" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.5" filter="url(#ss-soft)" />
      <path d="M138 56 C142 104 152 150 162 188" stroke="#fff3cf" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.28" filter="url(#ss-soft)" />
      {/* beaded rings */}
      <ellipse cx="100" cy="82" rx="56" ry="8" fill="none" stroke="url(#ss-brass-ring)" strokeWidth="6" />
      <ellipse cx="100" cy="80" rx="56" ry="8" fill="none" stroke="#fff3c4" strokeWidth="1.2" opacity="0.6" />
      <ellipse cx="100" cy="150" rx="72" ry="10" fill="none" stroke="url(#ss-brass-ring)" strokeWidth="7" />
      <ellipse cx="100" cy="148" rx="72" ry="10" fill="none" stroke="#fff3c4" strokeWidth="1.2" opacity="0.55" />
      {/* the domed top and its knob */}
      <ellipse cx="100" cy="44" rx="50" ry="10" fill="url(#ss-brass-top)" />
      <path d="M62 42 C70 22 130 22 138 42 Z" fill="url(#ss-brass)" />
      <circle cx="100" cy="20" r="13" fill="url(#ss-brass-knob)" />
      <ellipse cx="96" cy="15" rx="4" ry="3" fill="#fff" opacity="0.75" />
      {/* the rolled rim: a thick lip with its own highlight */}
      <ellipse cx="100" cy="198" rx="92" ry="15" fill="#2a1804" />
      <ellipse cx="100" cy="196" rx="92" ry="14" fill="url(#ss-brass-ring)" />
      <ellipse cx="100" cy="192" rx="88" ry="9" fill="none" stroke="#fff6d6" strokeWidth="1.6" opacity="0.55" />
    </svg>
  );
}

/**
 * The TV's table: three identical cups driven every frame from the server
 * clock (posesAt), the thing under its cup while it shows, the fixed position
 * plates 1 / 2 / 3. Styles are written straight to the nodes — no re-render
 * per frame, no restarted animations.
 */
function Table({ show, result, clockNow, dim }) {
  const stageRef = useRef(null);
  const geo = useRef({ spacing: 300, ch: 200 });
  const wraps = useRef({});
  const cups = useRef({});
  const shadows = useRef({});
  const thing = useRef(null);
  const lastMove = useRef(-2);
  const sounds = useRef({});

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const cw = Math.min(w * 0.2, h * 0.42); // room above the cups for a lifted one
      geo.current = { spacing: Math.min(w * 0.3, cw * 1.75), ch: cw * 1.12 };
      el.style.setProperty("--cw", `${cw}px`);
      el.style.setProperty("--spacing", `${geo.current.spacing}px`);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const t = clockNow();
      const { poses, moveIndex, moving } = posesAt(show, t, result);
      const { spacing, ch } = geo.current;
      for (const c of CUPS) {
        const p = poses[c];
        const w = wraps.current[c];
        if (w) {
          w.style.transform = `translateX(${p.x * spacing}px)`;
          w.style.zIndex = String(p.z);
        }
        const cup = cups.current[c];
        if (cup) cup.style.transform = `translateY(${p.y * ch * 0.6 - p.lift * ch * 0.52}px) scale(${p.s})`;
        const sh = shadows.current[c];
        if (sh) {
          sh.style.transform = `translateY(${p.y * ch * 0.6}px) scale(${1 - p.lift * 0.4})`;
          sh.style.opacity = String(0.6 - p.lift * 0.3);
        }
      }
      // the thing: under its cup, seen only while that cup is up
      const tp = poses[show.objectCup];
      if (thing.current) {
        thing.current.style.transform = `translateX(${tp.x * spacing}px)`;
        thing.current.style.visibility = tp.lift > 0.22 ? "visible" : "hidden";
      }
      // sounds: a swish per move (not on every one when they come fast), a knock at the stop
      const s = sounds.current;
      if (moveIndex !== lastMove.current && moving) {
        const m = show.moves[moveIndex];
        if (m && (m.ms >= 320 || moveIndex % 2 === 0)) swish(m.ms, m.kind === "feint" ? 0.07 : 0.11);
        lastMove.current = moveIndex;
      }
      if (!s.reveal && t >= show.revealAt && t < show.coverAt) {
        s.reveal = true;
        sparkle(0.1);
      }
      if (!s.cover && t >= show.coverAt + show.coverMs * 0.8 && t < show.shuffleAt + 200) {
        s.cover = true;
        knock(0.4, 150);
      }
      const end = show.shuffleAt + (show.moves.length ? show.moves[show.moves.length - 1].at + show.moves[show.moves.length - 1].ms : 0);
      if (!s.stop && t >= end && t < end + 600) {
        s.stop = true;
        knock(0.45, 120);
      }
      if (result && !s.lift && t >= result.at + REVEAL.OTHERS && t < result.at + REVEAL.OTHERS + 800) {
        s.lift = true;
        knock(0.25, 220);
      }
      if (result && !s.right && t >= result.at + REVEAL.RIGHT && t < result.at + REVEAL.RIGHT + 800) {
        s.right = true;
        sparkle(0.14);
      }
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [show, result, clockNow]);

  const rightCupUp = result && clockNow() >= result.at + REVEAL.RIGHT;
  return (
    <div className={`ss-stage ${dim ? "dim" : ""}`} ref={stageRef}>
      <CupDefs />
      <div className="ss-spot" aria-hidden="true" />
      <div className="ss-table" aria-hidden="true" />
      <div className="ss-plates" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`ss-plate ${result && result.correct === n && rightCupUp ? "right" : ""}`} style={{ "--k": n - 2 }}>
            {n}
          </span>
        ))}
      </div>
      <div className="ss-thing" ref={thing}>
        <i className="ss-thing-glow" />
        <i className="ss-thing-shadow" />
        <Thing object={show.object} className="ss-thing-img" />
      </div>
      {CUPS.map((c) => (
        <div key={c} className="ss-cup-wrap" ref={(el) => (wraps.current[c] = el)}>
          <i className="ss-cup-shadow" ref={(el) => (shadows.current[c] = el)} />
          <div className={`ss-cup ${result && rightCupUp && c === show.objectCup ? "win" : ""}`} ref={(el) => (cups.current[c] = el)}>
            <CupArt />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- component

export default function ShellShockMinigame({
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
  const [show, setShow] = useState(null); // TV: the cups and the moves of the current round
  const [roundResults, setRoundResults] = useState({}); // round -> verdict (+ `at`, server time it came)
  const [progress, setProgress] = useState({ answeredIds: [] });
  const [acks, setAcks] = useState({}); // round -> this phone's answer (accepted)
  const [pending, setPending] = useState({}); // round -> the answer sent, no ack yet
  const [, setTick] = useState(0);
  const offsetRef = useRef(0);
  const soundRef = useRef({});
  const sceneDoneRef = useRef(false);
  const clockNow = useRef(() => gameClock.now() + offsetRef.current).current;

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
      if (!Number.isFinite(Number(d?.prepEndsAt))) return;
      seed(d);
      setGo(d);
    };
    const onRound = (d) => {
      if (!Number.isFinite(Number(d?.answerAt))) return;
      seed(d);
      setRound(d);
    };
    const onShow = (d) => {
      if (!Array.isArray(d?.moves) || !d.start || !d.objectCup) return;
      seed(d);
      setShow((s) => (s && s.round === d.round ? s : d)); // the same round again (a hello): keep the object, nothing restarts
    };
    const onProgress = (d) => setProgress({ answeredIds: d?.answeredIds || [] });
    const onAck = (d) => d?.round && setAcks((a) => ({ ...a, [d.round]: Number(d.pick) }));
    const onResult = (d) => {
      if (!d?.round) return;
      seed(d);
      setRoundResults((m) => (m[d.round] ? m : { ...m, [d.round]: { ...d, at: Number(d.serverNow) } }));
    };
    socket.on("ss:go", onGo);
    socket.on("ss:round", onRound);
    socket.on("ss:show", onShow);
    socket.on("ss:progress", onProgress);
    socket.on("ss:ack", onAck);
    socket.on("ss:roundResult", onResult);
    return () => {
      socket.off("ss:go", onGo);
      socket.off("ss:round", onRound);
      socket.off("ss:show", onShow);
      socket.off("ss:progress", onProgress);
      socket.off("ss:ack", onAck);
      socket.off("ss:roundResult", onResult);
    };
  }, [socket]);

  // a reload / a late mount: ask for the state as it stands (the same sequence)
  useEffect(() => {
    if (!isActive || !socket) return;
    if (isDisplay) socket.emit("minigameDisplayEvent", { name: "ss:hello", data: {} });
    else if (amContestant) socket.emit("minigameEvent", { name: "ss:hello", data: {} });
  }, [isActive, socket, isDisplay, amContestant]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  // ---------------------------------------------------------------- phase
  const isFinal = !!results && results.minigameId === "shellShock" && !!results.shellShock;
  const now = clockNow();
  const result = round ? roundResults[round.round] : null;
  const shuffleEnd = show && show.round === round?.round && show.moves.length ? show.shuffleAt + show.moves[show.moves.length - 1].at + show.moves[show.moves.length - 1].ms : round?.answerAt;
  const phase = isFinal
    ? "final"
    : !go
      ? "wait"
      : !round
        ? "prep"
        : result
          ? "result"
          : now < round.revealAt
            ? "intro"
            : now < round.coverAt
              ? "reveal"
              : now < round.shuffleAt
                ? "cover"
                : now < (shuffleEnd ?? round.answerAt)
                  ? "shuffle"
                  : now < round.answerAt
                    ? "suspense"
                    : now < round.endAt
                      ? "answer"
                      : "closing";
  const nm = (id) => namesById[id] || "Гравець";
  const myAnswer = round ? (acks[round.round] ?? pending[round.round] ?? null) : null;
  const locked = round ? acks[round.round] != null : false;
  const canAnswer = !isDisplay && amContestant && phase === "answer" && myAnswer == null;

  const answer = (pos) => {
    if (!canAnswer) return;
    setPending((p) => ({ ...p, [round.round]: pos }));
    knock(0.3, 200);
    socket?.emit("minigameEvent", { name: "ss:pick", data: { round: round.round, pos } });
  };

  // ---------------------------------------------------------------- sounds (TV)
  const musicOn = isDisplay && phase !== "wait";
  useEffect(() => (musicOn ? loop(MUSIC, 0.22) : undefined), [musicOn]);
  const soundKey = !isDisplay || !round ? null : `${round.round}:${phase}`;
  useEffect(() => {
    if (!soundKey || soundRef.current[soundKey]) return;
    soundRef.current[soundKey] = true;
    if (phase === "intro") sfx("/assets/sounds/bell.mp3", 0.45);
    else if (phase === "answer") sfx("/assets/sounds/notification.mp3", 0.45);
    else if (phase === "result" && result) {
      const right = result.rows.filter((r) => r.correct).length;
      gameClock.setTimeout(() => (right ? playVictory(0.42, 5000) : sfx(LOSE_SOUNDS[Math.floor(Math.random() * 4)], 0.6)), REVEAL.RIGHT + 300);
    }
  }, [soundKey, phase, result]);
  const amLoser = isFinal && (results.loserIds || []).includes(myPlayerId);
  useEffect(() => {
    if (!isFinal || soundRef.current.final) return;
    soundRef.current.final = true;
    if (isDisplay) {
      playVictory(0.5);
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

  const cls = `ss-root ${isDisplay ? "ss-display" : "ss-mobile"}`;
  const roundTag = round && (
    <span className="ss-round-tag">
      Раунд {round.round}/{round.of} · {round.level}
    </span>
  );
  const thingName = round?.object?.name || "річ";

  // ================================================================== final
  if (phase === "final") {
    const f = results.shellShock;
    const loserIds = results.loserIds || [];
    const shielded = (f.lowestIds || []).filter((id) => !loserIds.includes(id));
    const place = (id) => 1 + f.ranked.filter((x) => f.totals[x] > f.totals[id]).length;
    if (!isDisplay) {
      if (!f.ranked.includes(myPlayerId)) {
        return (
          <section className={cls}>
            <Title small />
            <p className="ss-muted">Дивись результати на головному екрані!</p>
          </section>
        );
      }
      const lost = loserIds.includes(myPlayerId);
      const won = f.winnerId === myPlayerId;
      return (
        <section className={`${cls} ${lost ? "lost" : won ? "won" : ""}`}>
          <Title small />
          <p className="ss-score">
            <b>{f.totals[myPlayerId] || 0}</b> балів
          </p>
          <p className="ss-place">
            {place(myPlayerId)} місце з {f.ranked.length}
          </p>
          <div className="ss-my-rounds">
            {f.rounds.map((r) => {
              const row = r.rows.find((x) => x.id === myPlayerId);
              return (
                <span key={r.round} className={row?.correct ? "ok" : "bad"}>
                  <small>Раунд {r.round}</small>
                  <b>{row?.correct ? "✓" : row?.pick ? "✗" : "—"}</b>
                  <i>+{row?.points || 0}</i>
                </span>
              );
            })}
          </div>
          <p className={`ss-big ${lost ? "bad" : won ? "good" : ""}`}>
            {lost ? "МІНУС ЖИТТЯ" : won ? "ОРЛИНЕ ОКО!" : shielded.includes(myPlayerId) ? "ОСТАННІЙ, АЛЕ 🛡 ВІКТОРИНА ВРЯТУВАЛА" : loserIds.length || shielded.length ? "ТИ В БЕЗПЕЦІ" : "НІЧИЯ — ВСІ ЖИВІ"}
          </p>
          {lost && (
            <>
              <p className="ss-life">−1 ❤</p>
              {/* the server takes the life only after this scene, so count it in here */}
              <Lives n={Number(results.livesById?.[myPlayerId]) - 1} />
            </>
          )}
        </section>
      );
    }
    return (
      <section className={`${cls} ss-final`}>
        <Title small />
        <div className="ss-board">
          <div className="ss-board-row head">
            <span />
            <span />
            <span className="ss-board-name">Гравець</span>
            {f.rounds.map((r) => (
              <span key={r.round} className="ss-board-cell">
                {r.level}
              </span>
            ))}
            <span className="ss-board-total">Разом</span>
          </div>
          {f.ranked.map((id, k) => {
            const lost = loserIds.includes(id);
            const won = f.winnerId === id;
            return (
              <div key={id} className={`ss-board-row ${lost || shielded.includes(id) ? "lost" : ""} ${won ? "top" : ""}`} style={{ "--k": f.ranked.length - k }}>
                <span className="ss-board-place">{placeWord(place(id))}</span>
                <img className="ss-ava" src={SPRITE(slotsById[id])} alt="" />
                <span className="ss-board-name">
                  {won && "👑 "}
                  {nm(id)}
                </span>
                {f.rounds.map((r) => {
                  const row = r.rows.find((x) => x.id === id);
                  return (
                    <span key={r.round} className={`ss-board-cell ${row?.correct ? "ok" : "bad"}`}>
                      <b>{row?.correct ? "✓" : row?.pick ? "✗" : "—"}</b>
                      <i>+{row?.points || 0}</i>
                    </span>
                  );
                })}
                <span className="ss-board-total">{f.totals[id] || 0}</span>
                {lost && <span className="ss-board-minus">−1 ❤</span>}
                {shielded.includes(id) && <span className="ss-board-minus shield">🛡</span>}
              </div>
            );
          })}
        </div>
        <p className={`ss-verdict ${loserIds.length ? "" : "draw"}`}>
          {loserIds.length
            ? `Кліпнули найбільше: ${loserIds.map(nm).join(", ")} — мінус життя!`
            : shielded.length
              ? `Кліпнули найбільше: ${shielded.map(nm).join(", ")} — але правильна відповідь у вікторині рятує життя!`
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
          <Title small />
          <p className="ss-muted">Цього разу ти глядач. Дивись на головний екран!</p>
        </section>
      );
    }
    if (phase === "wait" || phase === "prep") {
      return (
        <section className={cls}>
          <Title />
          <div className="ss-phone-hint">
            <b>👀 Дивись на головний екран</b>
            <span>Під одним зі стаканчиків — річ. Стеж за ним, поки вони крутяться, і вкажи, де він опинився.</span>
            <span>3 раунди, щоразу швидше. Відповідь — одна, змінити не можна.</span>
          </div>
        </section>
      );
    }
    if (phase === "intro") {
      return (
        <section className={cls}>
          {roundTag}
          <p className="ss-big">РАУНД {round.round}</p>
          <p className="ss-host">🎩 {round.host}</p>
        </section>
      );
    }
    if (phase === "reveal") {
      return (
        <section className={`${cls} ss-phone-watch`}>
          {roundTag}
          <div className="ss-eyes" aria-hidden="true">
            <i />
            <i />
          </div>
          <p className="ss-big">ДИВИСЬ, ДЕ {thingName.toUpperCase()}!</p>
          <TimeBar msLeft={Math.max(0, round.coverAt - now)} totalMs={round.coverAt - round.revealAt} />
        </section>
      );
    }
    if (phase === "cover" || phase === "shuffle" || phase === "suspense") {
      return (
        <section className={`${cls} ss-phone-watch`}>
          {roundTag}
          <div className="ss-eyes wide" aria-hidden="true">
            <i />
            <i />
          </div>
          <p className="ss-big blink">НЕ КЛІПАЙ!</p>
          <p className="ss-muted">Очі на екран — стеж за стаканчиком із річчю</p>
        </section>
      );
    }
    if (phase === "answer" || phase === "closing") {
      const late = phase === "closing" && myAnswer == null;
      return (
        <section className={`${cls} ss-phone-answer`}>
          {roundTag}
          {phase === "answer" ? <TimeBar msLeft={Math.max(0, round.endAt - now)} totalMs={round.endAt - round.answerAt} /> : <p className="ss-muted">Час вийшов</p>}
          <p className="ss-ask">{myAnswer == null ? (late ? "Не встиг 😬" : `Де ${thingName}?`) : locked ? "Відповідь прийнята!" : "Надсилаю…"}</p>
          <div className="ss-buttons">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                className={`ss-btn ${myAnswer === n ? "chosen" : ""}`}
                onClick={() => answer(n)}
                disabled={!canAnswer}
                aria-label={`Стаканчик ${n}, ${POS_NAME[n - 1].toLowerCase()}`}
                aria-pressed={myAnswer === n}
              >
                <b>{n}</b>
                <small>{POS_NAME[n - 1]}</small>
              </button>
            ))}
          </div>
          {myAnswer != null && <p className="ss-muted">Змінити не можна. Чекаємо на інших…</p>}
        </section>
      );
    }
    // result
    const row = result.rows.find((r) => r.id === myPlayerId);
    return (
      <section className={`${cls} ${row?.correct ? "won" : "lost"}`}>
        {roundTag}
        <p className={`ss-big ${row?.correct ? "good" : "bad"}`}>{row?.correct ? `ВГАДАВ! +${row.points}` : row?.pick ? "МИМО!" : "БЕЗ ВІДПОВІДІ"}</p>
        <p className="ss-muted">
          {thingName[0].toUpperCase() + thingName.slice(1)} був під стаканчиком <b>{result.correct}</b> ({POS_NAME[result.correct - 1].toLowerCase()})
          {row?.pick && !row.correct ? `, а ти обрав ${row.pick}` : ""}.
        </p>
        <p className="ss-total">
          Разом: <b>{result.totals[myPlayerId] || 0}</b>
        </p>
      </section>
    );
  }

  // ================================================================== TV
  if (phase === "wait" || phase === "prep") {
    const left = go ? Math.max(0, go.prepEndsAt - now) : 0;
    return (
      <section className={`${cls} ss-prep`}>
        <div className="ss-dust" aria-hidden="true" />
        <Title />
        <div className="ss-rules">
          <div className="ss-rule" style={{ "--i": 0 }}>
            <b>👀</b>
            <span>
              Під одним зі <u>стаканчиків</u> — річ. Запам'ятай, під яким
            </span>
          </div>
          <div className="ss-rule" style={{ "--i": 1 }}>
            <b>🌀</b>
            <span>
              Стаканчики міняються місцями — <u>стеж</u> за потрібним
            </span>
          </div>
          <div className="ss-rule" style={{ "--i": 2 }}>
            <b>📱</b>
            <span>
              На телефоні тисни <u>1, 2 або 3</u> — де він стоїть наприкінці. Одна відповідь
            </span>
          </div>
          <div className="ss-rule bad" style={{ "--i": 3 }}>
            <b>💀</b>
            <span>Найменше балів — мінус життя. Однаково в усіх — ніхто не програє</span>
          </div>
        </div>
        <div className="ss-levels">
          {(go?.rounds || []).map((r) => (
            <span key={r.index} style={{ "--i": r.index }}>
              <b>{r.index}</b> {r.level} <i>+{r.points}</i>
            </span>
          ))}
        </div>
        {go && <p className="ss-getready">Починаємо за {Math.ceil(left / 1000)}…</p>}
      </section>
    );
  }

  const hasShow = show && show.round === round.round;
  const verdictShown = phase === "result" && now >= result.at + REVEAL.TABLE;
  const caption =
    phase === "intro"
      ? null
      : phase === "reveal"
        ? `Запам'ятай, де ${thingName}!`
        : phase === "cover"
          ? "Накриваємо…"
          : phase === "shuffle"
            ? "НЕ КЛІПАЙ!"
            : phase === "suspense"
              ? "Стоп! Де ж він?.."
              : phase === "answer"
                ? "Голосуйте на телефонах: 1 · 2 · 3"
                : phase === "closing"
                  ? "Час вийшов!"
                  : now < result.at + REVEAL.RIGHT
                    ? "Барабанний дріб…"
                    : `Ось він — стаканчик ${result.correct}!`;
  return (
    <section className={`${cls} ss-play ph-${phase}`}>
      <div className="ss-dust" aria-hidden="true" />
      <div className="ss-top">
        <Title small />
        {roundTag}
      </div>
      {hasShow ? (
        <Table show={show} result={phase === "result" ? result : null} clockNow={clockNow} dim={phase === "intro"} />
      ) : (
        <div className="ss-stage" />
      )}
      {phase === "intro" && (
        <div className="ss-intro" key={round.round}>
          <p className="ss-intro-round">РАУНД {round.round}</p>
          <p className="ss-intro-level">{round.level}</p>
          <p className="ss-host">🎩 {round.host}</p>
        </div>
      )}
      <div className="ss-bottom">
        {caption && (
          <p className={`ss-caption ${phase === "shuffle" ? "loud" : ""}`} key={caption}>
            {caption}
          </p>
        )}
        {phase === "reveal" && <TimeBar msLeft={Math.max(0, round.coverAt - now)} totalMs={round.coverAt - round.revealAt} />}
        {phase === "answer" && <TimeBar msLeft={Math.max(0, round.endAt - now)} totalMs={round.endAt - round.answerAt} />}
        {(phase === "answer" || phase === "closing" || phase === "suspense") && (
          <div className="ss-players">
            {contestantIds.map((id) => (
              <span key={id} className={`ss-player ${progress.answeredIds.includes(id) ? "done" : ""}`}>
                <img src={SPRITE(slotsById[id])} alt="" />
                <b>{nm(id)}</b>
                <small>{progress.answeredIds.includes(id) ? "✓ відповів" : "думає…"}</small>
              </span>
            ))}
          </div>
        )}
        {verdictShown && (
          <>
            <p className="ss-quip">🎩 {result.quip}</p>
            <div className="ss-players result">
              {[...result.rows]
                .sort((a, b) => (result.totals[b.id] || 0) - (result.totals[a.id] || 0))
                .map((r, k) => (
                  <span key={r.id} className={`ss-player ${r.correct ? "ok" : "bad"}`} style={{ "--k": k }}>
                    <img src={SPRITE(slotsById[r.id])} alt="" />
                    <b>{nm(r.id)}</b>
                    <small>
                      {r.correct ? `✓ ${r.pick} · +${r.points}` : r.pick ? `✗ обрав ${r.pick}` : "— без відповіді"}
                    </small>
                    <em>{result.totals[r.id] || 0}</em>
                  </span>
                ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
