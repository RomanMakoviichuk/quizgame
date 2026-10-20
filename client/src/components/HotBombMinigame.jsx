import { memo, useCallback, useEffect, useRef, useState } from "react";
import "./HotBombMinigame.css";
import gameClock from "../game/gameClock";
import { playKillAndDeath } from "../game/deathSounds";
import { createHotBombFx } from "../game/hotBombFx";

/**
 * «Гаряча бомба» — animal word chain with a bomb. Server-authoritative:
 * server/minigames/hotBomb.js owns the bomb, both clocks and the dictionary;
 * this component renders and forwards moves.
 *
 * Events in:  hb:go { startAt, endsAt, serverNow }
 *             hb:state { phase, seq, holderId, word, letter, chain, activeIds, outIds,
 *                        awaitingTarget, passedAt, endsAt, serverNow, fuseMinMs, fuseMaxMs,
 *                        boom?, accepted? }
 *             hb:pass { from, to, seq } · hb:miss { by, text, reason }
 *             hb:accept / hb:reject / hb:targetAck   (to the holder only)
 * Events out: minigameEvent hb:word { seq, text } · hb:target { seq, targetId }
 */

const TITLE = "ГАРЯЧА БОМБА";
const SPRITE = (slot) => `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const DEAD_SPRITE = (slot) => `/assets/characters/dead/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const TICK_MS = 100;
const BOOM_SHOW_MS = 2600;
const MISS_REASON = {
  letter: "не на ту літеру",
  used: "вже було",
  unknown: "немає в словнику",
  chars: "не слово",
  empty: "порожньо",
};
const EXAMPLE = ["тигр", "рись", "сова", "антилопа"];

/**
 * Sounds live in client/public/assets/minigames/hot-bomb/ (see README there).
 * A file that is missing falls back to the game's built-in sound.
 */
const HB_SOUND_DIR = "/assets/minigames/hot-bomb";
const HB_MUSIC = `${HB_SOUND_DIR}/background.mp3`; // quiet bed under the whole minigame
const HB_MUSIC_VOLUME = 1; // level set by game/loudness.js
const HB_SOUNDS = {
  fuse: "timer.mp3", // loop while the fuse burns (louder + faster as the danger grows)
  pass: "change player.mp3", // the bomb flies to the next player
  explosion: "bomb boom.mp3",
  wordOk: "word-ok.mp3",
  wordBad: "word-bad.mp3",
  tick: "tick.mp3", // fuse ticking (used only when there is no fuse.mp3)
  countdown: "countdown.mp3", // 3-2-1 beeps
};
const soundMissing = new Set();
/** Play a HotBomb sound; if its file is missing, run `fallback` instead. */
function hbSound(name, volume, fallback) {
  const src = `${HB_SOUND_DIR}/${encodeURIComponent(HB_SOUNDS[name])}`;
  if (soundMissing.has(src)) return fallback?.();
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.onerror = () => {
      soundMissing.add(src);
      fallback?.();
    };
    a.play().catch(() => {});
  } catch {
    fallback?.();
  }
}

function sfx(src, volume = 0.6) {
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

/** The letter a word hands on (Ь / Й / И / apostrophe skipped) — for highlighting only. */
function handOffIndex(word, letter) {
  const w = String(word || "").toLowerCase().replace(/ґ/g, "г");
  const l = String(letter || "").toLowerCase();
  for (let i = w.length - 1; i >= 0; i--) if (w[i] === l) return i;
  return -1;
}
function WordWithLetter({ word, letter }) {
  const i = handOffIndex(word, letter);
  if (i < 0) return <>{word}</>;
  return (
    <>
      {word.slice(0, i)}
      <b className="hb-hand">{word[i]}</b>
      {word.slice(i + 1)}
    </>
  );
}

// ---------------------------------------------------------------- the bomb

function MiniBomb({ className = "" }) {
  return (
    <svg viewBox="0 0 40 40" className={`hb-mini ${className}`} aria-hidden="true">
      <path d="M24 12 C 27 6, 31 6, 34 4" fill="none" stroke="#c9a46a" strokeWidth="3" strokeLinecap="round" />
      <rect x="18" y="9" width="9" height="7" rx="2" transform="rotate(28 22 12)" fill="#3a3d46" />
      <circle cx="18" cy="24" r="13" fill="#15161b" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="13" cy="19" rx="4" ry="2.4" fill="#fff" opacity="0.25" transform="rotate(-35 13 19)" />
      <circle cx="35" cy="4" r="3.6" fill="#ffd23f" className="hb-mini-spark" />
    </svg>
  );
}

/**
 * The cast-iron bomb (SVG). The braided fuse burns down with `danger`
 * (0..1); `fuseRef` exposes the fuse path so the canvas can throw sparks from
 * its burning end. Heat glows through the shell as the danger grows.
 */
const FUSE_D = "M120 56 C 126 34, 146 30, 156 22 S 172 6, 188 12";
function Bomb({ letter, danger = 0, big, fuseRef, hidden }) {
  const d = Math.max(0, Math.min(1, danger));
  const left = 1 - d * 0.88; // share of the fuse still unburnt
  const stage = d >= 0.5 ? "critical" : d > 0.25 ? "warm" : "";
  return (
    <div className={`hb-bomb ${stage} ${big ? "big" : ""} ${hidden ? "gone" : ""}`} style={{ "--heat": d }}>
      <div className="hb-bomb-glow" />
      <svg viewBox="0 0 200 220" className="hb-bomb-svg" aria-hidden="true">
        <defs>
          <radialGradient id="hb-iron" cx="36%" cy="32%" r="78%">
            <stop offset="0%" stopColor="#7d828f" />
            <stop offset="18%" stopColor="#3d4049" />
            <stop offset="55%" stopColor="#1a1c22" />
            <stop offset="100%" stopColor="#040406" />
          </radialGradient>
          <linearGradient id="hb-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9fb4ff" stopOpacity="0" />
            <stop offset="70%" stopColor="#9fb4ff" stopOpacity="0" />
            <stop offset="100%" stopColor="#ffb07a" stopOpacity="0.55" />
          </linearGradient>
          <radialGradient id="hb-hot" cx="50%" cy="62%" r="62%">
            <stop offset="0%" stopColor="#ffdd66" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#ff6a1a" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#b3150a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hb-spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hb-neck" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#23252c" />
            <stop offset="45%" stopColor="#8a8f9c" />
            <stop offset="100%" stopColor="#1b1d23" />
          </linearGradient>
          <pattern id="hb-pits" width="9" height="9" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="3" r="0.9" fill="#000" opacity="0.35" />
            <circle cx="7" cy="7" r="0.6" fill="#fff" opacity="0.06" />
          </pattern>
        </defs>
        {/* fuse: rope + braid, cut to the unburnt length */}
        <path ref={fuseRef} d={FUSE_D} className="hb-fuse-rope" pathLength="100" strokeDasharray={`${left * 100} 200`} />
        <path d={FUSE_D} className="hb-fuse-braid" pathLength="100" strokeDasharray={`${left * 100} 200`} />
        <path d={FUSE_D} className="hb-fuse-char" pathLength="100" strokeDasharray={`2.5 200`} strokeDashoffset={-(left * 100 - 2.5)} />
        {/* neck with bolts */}
        <g transform="rotate(28 116 62)">
          <rect x="97" y="48" width="38" height="26" rx="4" fill="url(#hb-neck)" stroke="#07080a" strokeWidth="3" />
          <rect x="94" y="68" width="44" height="8" rx="3" fill="#2c2f37" stroke="#07080a" strokeWidth="2" />
          <circle cx="104" cy="58" r="2.6" fill="#c9ccd6" />
          <circle cx="128" cy="58" r="2.6" fill="#c9ccd6" />
        </g>
        {/* shell */}
        <circle cx="96" cy="130" r="76" fill="url(#hb-iron)" />
        <circle cx="96" cy="130" r="76" fill="url(#hb-pits)" />
        <circle cx="96" cy="130" r="76" fill="url(#hb-hot)" className="hb-hot" />
        <circle cx="96" cy="130" r="74" fill="none" stroke="url(#hb-rim)" strokeWidth="5" />
        <circle cx="96" cy="130" r="76" fill="none" stroke="#000" strokeWidth="4" />
        <path d="M30 128 A 66 66 0 0 0 162 128" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="3" />
        <ellipse cx="66" cy="94" rx="24" ry="14" fill="url(#hb-spec)" transform="rotate(-35 66 94)" />
        <ellipse cx="58" cy="88" rx="7" ry="4" fill="#fff" opacity="0.8" transform="rotate(-35 58 88)" />
        {letter && (
          <text x="96" y="156" textAnchor="middle" className="hb-bomb-letter">
            {letter.toUpperCase()}
          </text>
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- players ring (TV)

const Ring = memo(function Ring({ ids, holderId, outIds, awaiting, namesById, slotsById }) {
  const n = ids.length;
  return (
    <div className="hb-ring">
      {ids.map((id, i) => {
        const { x, y } = seatPos(ids, id);
        const out = outIds.includes(id);
        const holder = id === holderId;
        return (
          <div
            key={id}
            className={`hb-seat ${holder ? "holder" : ""} ${out ? "out" : ""}`}
            style={{ left: `${x}%`, top: `${y}%` }}
            data-seat={id}
          >
            <img src={out ? DEAD_SPRITE(slotsById[id]) : SPRITE(slotsById[id])} alt="" />
            <span className="hb-seat-name">{namesById[id] || "Гравець"}</span>
            {holder && <MiniBomb className="hb-seat-bomb" />}
            {holder && awaiting && <span className="hb-seat-note">обирає кому…</span>}
            {out && <span className="hb-seat-boom">💥</span>}
          </div>
        );
      })}
    </div>
  );
});

/** Centre of an element in `box` coordinates (CSS px). */
function centerOf(el, box) {
  if (!el || !box) return null;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  return { x: r.left + r.width / 2 - b.left, y: r.top + r.height * 0.55 - b.top };
}
function seatCenter(box, id) {
  const img = box?.querySelector(`[data-seat="${id}"] img`);
  return centerOf(img, box);
}

function seatPos(ids, id) {
  const i = ids.indexOf(id);
  if (i < 0) return { x: 50, y: 50 };
  const step = (Math.PI * 2) / ids.length;
  const a = step * i - Math.PI / 2 + step / 2;
  return { x: 50 + 43 * Math.cos(a), y: 50 + 40 * Math.sin(a) };
}

function Chain({ chain, namesById }) {
  return (
    <div className="hb-chain">
      {chain.map((c, i) => (
        <span key={`${c.word}-${i}`} className={`hb-chip ${i === chain.length - 1 ? "last" : ""} ${c.by ? "" : "start"}`}>
          <span>{c.word}</span>
          {c.by && <em>{namesById[c.by] || ""}</em>}
        </span>
      ))}
    </div>
  );
}

/** 125000 -> "2:05", 9000 -> "9" */
const clockText = (ms) => {
  const secs = Math.ceil(ms / 1000);
  return secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : String(secs);
};

function TimerRing({ msLeft, totalMs }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const frac = totalMs ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const secs = Math.ceil(msLeft / 1000);
  return (
    <div className={`hb-timer ${secs <= 5 ? "hot" : ""}`}>
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} className="track" />
        <circle cx="20" cy="20" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span>{clockText(msLeft)}</span>
    </div>
  );
}

function Title({ small }) {
  return (
    <header className={`hb-head ${small ? "small" : ""}`}>
      <h2 className="hb-title">{TITLE}</h2>
      <p className="hb-sub">ланцюжок тварин · не тримай довго!</p>
    </header>
  );
}

function Embers() {
  return (
    <div className="hb-embers" aria-hidden="true">
      {Array.from({ length: 14 }).map((_, i) => (
        <span key={i} style={{ left: `${(i * 71) % 100}%`, animationDelay: `${-i * 0.9}s`, animationDuration: `${6 + (i % 5)}s` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- component

export default function HotBombMinigame({
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
  const [go, setGo] = useState(null); // { startAt, endsAt, offset }
  const [st, setSt] = useState(null);
  const [offset, setOffset] = useState(0);
  const [boom, setBoom] = useState(null); // { id, at }
  const [miss, setMiss] = useState(null); // { by, text, reason, n }
  const [text, setText] = useState("");
  const [error, setError] = useState(null); // { message, n }
  const [okFlash, setOkFlash] = useState(0);
  const [myTarget, setMyTarget] = useState(null);
  const [, setTick] = useState(0);
  const inputRef = useRef(null);
  const sceneDoneRef = useRef(false);
  const lastTickSoundRef = useRef(0);
  const beepRef = useRef(null);
  const fxRef = useRef(null);
  const fuseRef = useRef(null);
  const bombBoxRef = useRef(null);
  const arenaRef = useRef(null);
  const fuseAudioRef = useRef(null);
  const [shake, setShake] = useState(0);

  // display: shared clock request
  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return;
    const onGo = (d) => {
      setGo({ startAt: Number(d.startAt), endsAt: Number(d.endsAt) });
      setOffset(Number(d.serverNow ?? gameClock.now()) - gameClock.now());
    };
    const onState = (d) => {
      setSt(d);
      if (Number.isFinite(Number(d.serverNow))) setOffset(Number(d.serverNow) - gameClock.now());
      if (d.boom) {
        setBoom({ id: d.boom.id, at: gameClock.now() });
        if (isDisplay) {
          const c = centerOf(bombBoxRef.current, arenaRef.current);
          if (c) fxRef.current?.explode(c.x, c.y, 1);
          setShake((n) => n + 1);
          hbSound("explosion", 0.95, () => playKillAndDeath(0.9));
        } else if (d.boom.id === myPlayerId) hbSound("explosion", 0.8, () => sfx("/assets/sounds/knife-slice.mp3", 0.8));
      }
      if (d.accepted && isDisplay) hbSound("wordOk", 0.5, () => sfx("/assets/sounds/notification.mp3", 0.35));
    };
    const onPass = (d) => {
      if (d.from === myPlayerId) setMyTarget(null); // my pick is used up
      if (isDisplay) {
        const from = seatCenter(arenaRef.current, d.from);
        const to = seatCenter(arenaRef.current, d.to);
        fxRef.current?.fly(from, to, 560);
        hbSound("pass", 0.6, () => sfx("/assets/sounds/click.mp3", 0.6));
      }
    };
    const onMiss = (d) => setMiss((m) => ({ ...d, n: (m?.n || 0) + 1 }));
    const onReject = (d) => {
      setError((e) => ({ message: d.message || "Не підходить", n: (e?.n || 0) + 1 }));
      hbSound("wordBad", 0.5, () => sfx("/assets/sounds/beep.mp3", 0.35));
    };
    const onAccept = () => {
      setText("");
      setError(null);
      setOkFlash((n) => n + 1);
      hbSound("wordOk", 0.6, () => sfx("/assets/sounds/click.mp3", 0.6));
    };
    const onTargetAck = (d) => setMyTarget(d.targetId);
    socket.on("hb:go", onGo);
    socket.on("hb:state", onState);
    socket.on("hb:pass", onPass);
    socket.on("hb:miss", onMiss);
    socket.on("hb:reject", onReject);
    socket.on("hb:accept", onAccept);
    socket.on("hb:targetAck", onTargetAck);
    return () => {
      socket.off("hb:go", onGo);
      socket.off("hb:state", onState);
      socket.off("hb:pass", onPass);
      socket.off("hb:miss", onMiss);
      socket.off("hb:reject", onReject);
      socket.off("hb:accept", onAccept);
      socket.off("hb:targetAck", onTargetAck);
    };
  }, [socket, isDisplay, myPlayerId]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  const serverNow = gameClock.now() + offset;
  const startAt = st?.startAt || go?.startAt || 0;
  const endsAt = st?.endsAt || go?.endsAt || 0;
  const beforeStart = !!startAt && serverNow < startAt;
  const countdownNum = beforeStart ? Math.max(1, Math.ceil((startAt - serverNow) / 1000)) : null;
  const msLeft = endsAt ? Math.max(0, endsAt - serverNow) : 0;
  const playMs = endsAt && startAt ? endsAt - startAt : 30000;
  const live = st?.phase === "live";
  const sinceGive = live && st.passedAt ? Math.max(0, serverNow - st.passedAt) : 0;
  const danger = live ? sinceGive / (st.fuseMaxMs || 15000) : 0;
  const fuseSecs = live ? Math.max(0, Math.ceil(((st.fuseMaxMs || 15000) - sinceGive) / 1000)) : 0;
  const boomShowing = boom && gameClock.now() - boom.at < BOOM_SHOW_MS;
  const iHold = live && st.holderId === myPlayerId;
  const iAmOut = !!st?.outIds?.includes(myPlayerId);
  const amContestant = contestantIds.includes(myPlayerId) || !!st?.activeIds?.includes(myPlayerId) || iAmOut;

  // a new bomb in my hands: clear the field, focus it, forget the old pick
  useEffect(() => {
    if (!iHold) return;
    setText("");
    setError(null);
    const t = gameClock.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => gameClock.clearTimeout(t);
  }, [iHold, st?.seq]);
  useEffect(() => {
    if (myTarget && st && !st.activeIds.includes(myTarget)) setMyTarget(null);
  }, [st, myTarget]);

  // TV: 3-2-1 beeps, then the fuse: a looping hiss (fuse.mp3) whose volume
  // follows the danger, or — without that file — ticks that speed up.
  const countKey = countdownNum != null && countdownNum <= 3 ? countdownNum : null;
  useEffect(() => {
    if (!isDisplay || countKey == null || beepRef.current === countKey) return;
    beepRef.current = countKey;
    hbSound("countdown", 0.5, () => sfx("/assets/sounds/beep.mp3", 0.45));
  }, [isDisplay, countKey]);
  const liveRef = useRef({ live: false, danger: 0 });
  liveRef.current = { live, danger };
  useEffect(() => {
    if (!isDisplay) return;
    const loop = new Audio(`${HB_SOUND_DIR}/${encodeURIComponent(HB_SOUNDS.fuse)}`);
    loop.loop = true;
    loop.volume = 0;
    let hasLoop = true;
    loop.onerror = () => {
      hasLoop = false;
    };
    fuseAudioRef.current = loop;
    const id = gameClock.setInterval(() => {
      const { live: on, danger: d } = liveRef.current;
      if (hasLoop) {
        if (on && !gameClock.isPaused()) {
          loop.volume = Math.min(1, 0.45 + d * 0.55);
          loop.playbackRate = 1 + Math.min(1, d) * 0.7;
          if (loop.paused) loop.play().catch(() => {});
        } else if (!loop.paused) loop.pause();
        return;
      }
      if (!on) return;
      const gap = d >= 0.5 ? 240 : d >= 0.3 ? 480 : 860;
      const nowLocal = gameClock.now();
      if (nowLocal - lastTickSoundRef.current < gap) return;
      lastTickSoundRef.current = nowLocal;
      hbSound("tick", d >= 0.5 ? 0.35 : 0.2, () => sfx("/assets/sounds/beep.mp3", d >= 0.5 ? 0.22 : 0.12));
    }, 60);
    return () => {
      gameClock.clearInterval(id);
      loop.pause();
    };
  }, [isDisplay]);

  // TV: quiet background music for the whole minigame (pauses with the game)
  const musicOn = isDisplay && (!!isActive || (!!results && results.minigameId === "hotBomb"));
  useEffect(() => {
    if (!musicOn) return;
    const a = new Audio(HB_MUSIC);
    a.loop = true;
    a.volume = HB_MUSIC_VOLUME;
    const play = () => a.play().catch(() => {});
    if (!gameClock.isPaused()) play();
    const unsub = gameClock.subscribe((paused) => (paused ? a.pause() : play()));
    return () => {
      unsub();
      const fade = window.setInterval(() => {
        a.volume = Math.max(0, a.volume - HB_MUSIC_VOLUME / 8);
        if (a.volume <= 0.001) {
          window.clearInterval(fade);
          a.pause();
        }
      }, 80);
    };
  }, [musicOn]);

  // TV canvas effects: created when the arena canvas mounts; the fuse end is the emitter
  const fxCanvasRef = useCallback((el) => {
    if (el && !fxRef.current) {
      fxRef.current = createHotBombFx(el);
      fxRef.current.setEmitter(() => {
        const { live: on, danger: d } = liveRef.current;
        const path = fuseRef.current;
        if (!on || !path || !arenaRef.current) return null;
        try {
          const len = path.getTotalLength();
          const pt = path.getPointAtLength(len * (1 - Math.min(1, d) * 0.88));
          const m = path.getScreenCTM();
          const r = arenaRef.current.getBoundingClientRect();
          return { x: pt.x * m.a + pt.y * m.c + m.e - r.left, y: pt.x * m.b + pt.y * m.d + m.f - r.top, rate: 28 + d * 110, dir: -Math.PI / 2.6 };
        } catch {
          return null;
        }
      });
    } else if (!el && fxRef.current) {
      fxRef.current.destroy();
      fxRef.current = null;
    }
  }, []);
  useEffect(() => () => fxRef.current?.destroy(), []);

  const isResults = !!results && results.minigameId === "hotBomb";
  useEffect(() => {
    if (!isResults || !isDisplay || sceneDoneRef.current) return;
    const t = gameClock.setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, 9000);
    return () => gameClock.clearTimeout(t);
  }, [isResults, isDisplay, onSceneDone]);

  const sendWord = (e) => {
    e?.preventDefault?.();
    if (!iHold || st.awaitingTarget) return;
    if (!text.trim()) {
      setError((x) => ({ message: "Напиши назву тварини", n: (x?.n || 0) + 1 }));
      return;
    }
    socket?.emit("minigameEvent", { name: "hb:word", data: { seq: st.seq, text } });
  };
  const chooseTarget = (id) => {
    if (!st || id === myPlayerId || !st.activeIds.includes(id)) return;
    setMyTarget(id);
    socket?.emit("minigameEvent", { name: "hb:target", data: { seq: st.seq, targetId: id } });
  };

  const nm = (id) => namesById[id] || "Гравець";
  const cls = `hb-root ${isDisplay ? "hb-display" : "hb-mobile"}`;
  const ringIds = contestantIds.length ? contestantIds : [...(st?.activeIds || []), ...(st?.outIds || [])];

  // ---------------------------------------------------------------- results
  if (isResults) {
    const ex = results.explosions || [];
    const wordsBy = results.wordsBy || {};
    const best = Object.entries(wordsBy).sort((a, b) => b[1] - a[1])[0];
    const chain = results.chain || [];
    if (!isDisplay) {
      const mine = ex.some((e) => e.id === myPlayerId);
      return (
        <section className={cls}>
          <Embers />
          <Title small />
          <p className={`hb-big-status ${mine ? "bad" : "good"}`}>{mine ? "💥 Мінус життя" : "😮‍💨 Ти вцілів!"}</p>
          <p className="hb-muted">Твоїх слів: {wordsBy[myPlayerId] || 0}</p>
        </section>
      );
    }
    return (
      <section className={`${cls} hb-end`}>
        <Embers />
        <Title small />
        <h3 className="hb-end-title">{ex.length ? "Бомба відгриміла!" : "Ніхто не підірвався!"}</h3>
        <div className="hb-victims">
          {ex.map((e, i) => (
            <div key={`${e.id}-${i}`} className="hb-victim" style={{ animationDelay: `${0.2 + i * 0.25}s` }}>
              <img src={DEAD_SPRITE(slotsById[e.id])} alt="" />
              <b>{nm(e.id)}</b>
              <span>−1 ❤</span>
            </div>
          ))}
          {!ex.length && <p className="hb-muted">Усі встигали передавати бомбу — ніхто не втрачає життя.</p>}
        </div>
        <div className="hb-end-stats">
          <span>
            Слів у ланцюжку: <b>{chain.filter((c) => c.by).length}</b>
          </span>
          {best && (
            <span>
              Найшвидший язик: <b>{nm(best[0])}</b> ({best[1]})
            </span>
          )}
        </div>
        <Chain chain={chain.slice(-10)} namesById={namesById} />
      </section>
    );
  }

  // ---------------------------------------------------------------- waiting
  if (!isActive || !go) {
    return (
      <section className={cls}>
        <Embers />
        <Title />
        <Bomb letter={null} danger={0.15} big />
        <p className="hb-muted">{isDisplay ? "Приготуйтесь…" : "Дивіться на головний екран"}</p>
      </section>
    );
  }

  // ---------------------------------------------------------------- rules + 3-2-1
  if (beforeStart) {
    return (
      <section className={`${cls} hb-prep`}>
        <Embers />
        <Title small={!isDisplay} />
        <div className="hb-example">
          {EXAMPLE.map((w, i) => (
            <span key={w} className="hb-example-step" style={{ animationDelay: `${0.3 + i * 0.5}s` }}>
              <span className="hb-chip">
                <span>
                  <WordWithLetter word={w} letter={EXAMPLE[i + 1]?.[0]} />
                </span>
              </span>
              {i < EXAMPLE.length - 1 && <span className="hb-arrow">→</span>}
            </span>
          ))}
        </div>
        <div className="hb-rules">
          <div className="hb-rule" style={{ animationDelay: "0.2s" }}>
            <b>💣</b>
            <span>Бомба в тебе — за 15 секунд напиши тварину на останню літеру попереднього слова</span>
          </div>
          <div className="hb-rule" style={{ animationDelay: "0.35s" }}>
            <b>👉</b>
            <span>Слово правильне — передай бомбу будь-кому</span>
          </div>
          <div className="hb-rule" style={{ animationDelay: "0.5s" }}>
            <b>Ь</b>
            <span>Ь, Й, И та апостроф пропускаємо: рись → «С»</span>
          </div>
          <div className="hb-rule bad" style={{ animationDelay: "0.65s" }}>
            <b>💥</b>
            <span>Не встиг за 15 с — БУМ: −1 життя і вибуваєш. Раунд 2 хвилини; якщо ніхто не вибухнув, бомба рветься в того, у кого вона наприкінці</span>
          </div>
        </div>
        {countdownNum <= 3 ? (
          <div className="hb-countdown" key={countdownNum}>
            {countdownNum}
          </div>
        ) : (
          <div className="hb-getready">Ґніт підпалять за {countdownNum}…</div>
        )}
      </section>
    );
  }

  const boomOverlay = boomShowing && (
    <div className={`hb-boom ${isDisplay ? "tv" : ""}`} key={boom.at}>
      {/* the TV draws flash + shock rings on its canvas */}
      {!isDisplay && <div className="hb-boom-flash" />}
      {!isDisplay && <div className="hb-boom-ring r1" />}
      {!isDisplay && <div className="hb-boom-ring r2" />}
      <div className="hb-boom-card">
        <p className="hb-boom-word">БУМ!</p>
        <img src={DEAD_SPRITE(slotsById[boom.id])} alt="" />
        <p className="hb-boom-name">
          {boom.id === myPlayerId && !isDisplay ? "Тебе підірвало!" : `${nm(boom.id)} — мінус життя!`}
        </p>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- TV
  if (isDisplay) {
    return (
      <section className={`${cls} ${danger >= 0.5 ? "hb-alarm" : ""} ${shake ? `shake-${(shake % 2) + 1}` : ""}`}>
        <Embers />
        <div className="hb-topbar">
          <Title small />
          <TimerRing msLeft={msLeft} totalMs={playMs} />
        </div>
        <div className="hb-arena" ref={arenaRef}>
          <canvas ref={fxCanvasRef} className="hb-fx" />
          <Ring
            ids={ringIds}
            holderId={live ? st.holderId : null}
            outIds={st?.outIds || []}
            awaiting={!!st?.awaitingTarget}
            namesById={namesById}
            slotsById={slotsById}
          />
          <div className="hb-center">
            <div ref={bombBoxRef}>
              <Bomb letter={live ? st.letter : null} danger={danger} big fuseRef={fuseRef} hidden={st?.phase === "boom"} />
            </div>
            {live && (
              <div className="hb-center-info">
                <span className="hb-need">
                  {st.word && (
                    <span className="hb-prev">
                      <WordWithLetter word={st.word} letter={st.letter} /> →{" "}
                    </span>
                  )}
                  на «<b>{String(st.letter || "").toUpperCase()}</b>»
                </span>
                <span className="hb-holder-line">
                  <MiniBomb /> у <b>{nm(st.holderId)}</b>
                </span>
              </div>
            )}
          </div>
          {miss && live && miss.by === st.holderId && (
            <div
              key={miss.n}
              className="hb-miss"
              style={{ left: `${seatPos(ringIds, miss.by).x}%`, top: `${seatPos(ringIds, miss.by).y}%` }}
            >
              «{miss.text}» — {MISS_REASON[miss.reason] || "ні"}
            </div>
          )}
        </div>
        <Chain chain={st?.chain || []} namesById={namesById} />
        {st?.phase === "done" && <div className="hb-banner">Час вийшов!</div>}
        {boomOverlay}
      </section>
    );
  }

  // ---------------------------------------------------------------- phone
  if (!amContestant) {
    return (
      <section className={cls}>
        <Embers />
        <Title small />
        <p className="hb-muted">Дивись на головний екран</p>
      </section>
    );
  }

  const others = (st?.activeIds || []).filter((id) => id !== myPlayerId);
  const targets = (
    <div className="hb-targets">
      {others.map((id) => (
        <button
          key={id}
          type="button"
          className={`hb-target ${myTarget === id ? "picked" : ""}`}
          onClick={() => chooseTarget(id)}
        >
          <img src={SPRITE(slotsById[id])} alt="" />
          <span>{nm(id)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <section className={`${cls} ${iHold ? "hb-holding" : ""}`}>
      <Embers />
      <div className="hb-phone-top">
        <span className={`hb-phone-time ${msLeft <= 5000 ? "hot" : ""}`}>⏱ {clockText(msLeft)}</span>
        <span className="hb-phone-danger">
          <span className="hb-phone-danger-fill" style={{ transform: `scaleX(${Math.min(1, danger)})` }} />
        </span>
      </div>

      {iAmOut ? (
        <div className="hb-phone-out">
          <img src={DEAD_SPRITE(slotsById[myPlayerId])} alt="" />
          <p className="hb-big-status bad">💥 Тебе підірвало</p>
          <p className="hb-muted">−1 життя. Дивись, хто буде наступним!</p>
        </div>
      ) : iHold ? (
        <form className="hb-hold" onSubmit={sendWord} key={st.seq}>
          <p className="hb-alert">
            <MiniBomb /> БОМБА В ТЕБЕ!
          </p>
          <p className={`hb-fuse-left ${fuseSecs <= 5 ? "hot" : ""}`}>
            ⏳ {fuseSecs} с, щоб передати
          </p>
          <div className="hb-letter-row">
            {st.word && (
              <span className="hb-prev-word">
                <WordWithLetter word={st.word} letter={st.letter} />
              </span>
            )}
            <div className="hb-phone-bomb">
              <Bomb letter={st.letter} danger={danger} />
            </div>
          </div>
          {st.awaitingTarget ? (
            <p className="hb-ok-line" key={okFlash}>
              ✅ Прийнято! Тисни, кому передати 👇
            </p>
          ) : (
            <div className={`hb-input-row ${error ? "err" : ""}`}>
              <input
                ref={inputRef}
                className="hb-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`тварина на «${String(st.letter || "").toUpperCase()}»…`}
                lang="uk"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="send"
                maxLength={30}
              />
              <button type="submit" className="hb-send">
                Передати <MiniBomb />
              </button>
            </div>
          )}
          {error && !st.awaitingTarget && (
            <p className="hb-error" key={error.n}>
              {error.message}
            </p>
          )}
          <p className={`hb-targets-title ${st.awaitingTarget ? "urgent" : ""}`}>
            {st.awaitingTarget ? "Кому передати?" : myTarget ? `Передам: ${nm(myTarget)}` : "Кому передаси (можна заздалегідь):"}
          </p>
          {targets}
        </form>
      ) : (
        <div className="hb-watch">
          {live ? (
            <>
              <div className="hb-watch-holder">
                <img src={SPRITE(slotsById[st.holderId])} alt="" />
                <span>
                  <MiniBomb /> у <b>{nm(st.holderId)}</b>
                </span>
              </div>
              <p className="hb-watch-need">
                {st.word && <WordWithLetter word={st.word} letter={st.letter} />} → на «
                <b>{String(st.letter || "").toUpperCase()}</b>»
              </p>
              <p className="hb-targets-title">
                {myTarget ? `Отримаєш бомбу — передаси: ${nm(myTarget)}` : "Підготуйся: кому передаси, якщо бомба прийде?"}
              </p>
              {targets}
            </>
          ) : (
            <p className="hb-muted">{st?.phase === "done" ? "Час вийшов!" : "Бомба перезаряджається…"}</p>
          )}
          <Chain chain={(st?.chain || []).slice(-6)} namesById={namesById} />
        </div>
      )}
      {boomOverlay}
    </section>
  );
}
