import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./NameThatTuneMinigame.css";
import gameClock from "../game/gameClock";

/**
 * «Вгадай мелодію» (id: tune) — 5 rounds, speed scoring. Server-authoritative
 * (server/minigames/nameThatTune.js): songs, options, the right answer, the
 * answer order and the points are decided on the server.
 *
 * The TV plays the clips (from opaque /tune/<token> urls) at the round's
 * server start time, drives the equalizer from the real audio and tells the
 * server "tune:ready" (clips loaded) / "tune:audioFail" (can't play).
 * Phones show the 4 options and send one answer per round.
 *
 * Events in:  tune:go { rounds, introEndsAt, serverNow, points, losers }
 *             tune:preload { urls }  tune:play { index, url, startAt, start }  (TV only)
 *             tune:round { index, total, announceAt, startAt, endAt, options }
 *             tune:progress { index, answered, total }   tune:ack { index, choice }
 *             tune:result { index, correctIndex, song, players, totals, void, nextAt }
 *             tune:retry { index, message }
 * Out:        minigameEvent tune:answer { index, choice } | tune:hello
 *             minigameDisplayEvent tune:ready | tune:audioFail { index }
 */

const SPRITE = (slot) => `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/sounds/lose/${n}.mp3`);
const LETTERS = ["A", "B", "C", "D"];
const TICK_MS = 100;
const FINAL_SCENE_MS = 11000;
const CLIP_VOLUME = 0.95;
// lounge music under the whole minigame (TV); it ducks out while a clip plays
const BED_MUSIC = "/assets/minigames/name-that-tune/background.mp3";
const BED_VOLUME = 1; // level set by game/loudness.js
const BED_DUCK_MS = 900; // fade out when a clip starts
const BED_RISE_MS = 1800; // fade back in when the clip is over

function sfx(src, volume = 0.6) {
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

function Title({ small }) {
  return (
    <header className={`nt-head ${small ? "small" : ""}`}>
      <h2 className="nt-title">
        Вгадай <em>мелодію</em>
      </h2>
    </header>
  );
}

/** A cosy lounge: a garland of warm bulbs, soft bokeh lights, rising notes, a wooden floor. */
function Stage() {
  return (
    <div className="nt-stage" aria-hidden="true">
      <svg className="nt-wire" viewBox="0 0 1000 120" preserveAspectRatio="none">
        <path d="M0 18 Q 250 120 500 40 T 1000 22" fill="none" stroke="#2a1a10" strokeWidth="3" />
      </svg>
      <div className="nt-bulbs">
        {Array.from({ length: 11 }, (_, i) => (
          <i key={i} style={{ "--i": i, "--y": `${[2, 6, 9, 10, 8, 5, 3, 3, 4, 3, 1][i]}vh` }} />
        ))}
      </div>
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="nt-bokeh" style={{ "--x": `${(i * 37) % 100}%`, "--y": `${20 + ((i * 53) % 70)}%`, "--s": `${6 + (i % 5) * 3}vh`, "--d": `${-i * 1.3}s` }} />
      ))}
      {["♪", "♫", "♬", "♩", "♪", "♫"].map((n, i) => (
        <b key={i} style={{ "--x": `${10 + i * 15}%`, "--d": `${-i * 2.1}s` }}>
          {n}
        </b>
      ))}
      <div className="nt-floor" />
    </div>
  );
}

function Ring({ msLeft, totalMs, big }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const frac = totalMs ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const secs = Math.ceil(msLeft / 1000);
  return (
    <div className={`nt-ring ${big ? "big" : ""} ${secs <= 5 && msLeft > 0 ? "hot" : ""}`}>
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} className="track" />
        <circle cx="20" cy="20" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <b key={secs <= 5 ? secs : "t"}>{secs}</b>
    </div>
  );
}

/** An analog VU meter; the needle follows the CSS variable set by the turntable loop. */
const VuMeter = ({ side }) => (
  <div className={`nt-vu ${side}`}>
    <svg viewBox="0 0 120 70" aria-hidden="true">
      <path d="M12 60 A 52 52 0 0 1 108 60" fill="none" stroke="#5b3a1e" strokeWidth="2" />
      <path d="M86 24 A 52 52 0 0 1 108 60" fill="none" stroke="#c0392b" strokeWidth="5" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1="60" y1="12" x2="60" y2={i % 5 === 0 ? 20 : 17} stroke="#3b2414" strokeWidth={i % 5 === 0 ? 2 : 1} transform={`rotate(${-50 + i * 10} 60 62)`} />
      ))}
      <text x="60" y="48" textAnchor="middle" fontSize="9" fontWeight="800" fill="#5b3a1e" fontFamily="Manrope, sans-serif">
        VU
      </text>
    </svg>
    <span className="nt-needle" />
  </div>
);

/**
 * The turntable: a spinning record (the label reveals the song), the tonearm,
 * two VU meters and warm spectrum bars. One animation loop reads the analyser
 * (TV) — or makes a gentle fake beat — and writes CSS variables / the canvas,
 * so React doesn't re-render 60 times a second.
 */
function Turntable({ getData, active, label, revealed, small }) {
  const root = useRef(null);
  const canvasRef = useRef(null);
  useEffect(() => {
    const el = root.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return undefined;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let lvlL = 0;
    let lvlR = 0;
    const draw = (t) => {
      const data = active ? getData?.() : null;
      // level for the VU needles
      let target = 0;
      if (data?.wave) {
        let sum = 0;
        for (let i = 0; i < data.wave.length; i++) {
          const v = (data.wave[i] - 128) / 128;
          sum += v * v;
        }
        target = Math.min(1, Math.sqrt(sum / data.wave.length) * 3.2);
      } else if (active) target = 0.45 + 0.35 * Math.abs(Math.sin(t / 230) * Math.sin(t / 610));
      lvlL += (target - lvlL) * 0.25;
      lvlR += (target * (0.9 + 0.1 * Math.sin(t / 90)) - lvlR) * 0.22;
      el.style.setProperty("--lvlL", lvlL.toFixed(3));
      el.style.setProperty("--lvlR", lvlR.toFixed(3));
      // warm spectrum
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const bars = 36;
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        let v;
        // music lives in the low bins: spread them over the width, lift the quiet top
        if (data?.freq) v = Math.min(1, (data.freq[Math.floor(Math.pow(i / bars, 1.7) * data.freq.length * 0.72)] / 255) * (1 + i / bars));
        else v = active ? 0.2 + 0.5 * Math.abs(Math.sin(t / 260 + i * 0.55) * Math.sin(t / 410 + i * 0.21)) : 0.05;
        const bh = Math.max(2, v * h);
        const g = ctx.createLinearGradient(0, h, 0, h - bh);
        g.addColorStop(0, "#c2410c");
        g.addColorStop(0.6, "#f59e0b");
        g.addColorStop(1, "#fde68a");
        ctx.fillStyle = g;
        const x = i * bw + bw * 0.2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, h - bh, bw * 0.6, bh, 3);
        else ctx.rect(x, h - bh, bw * 0.6, bh);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getData, active]);
  return (
    <div className={`nt-deck ${active ? "playing" : ""} ${revealed ? "revealed" : ""} ${small ? "small" : ""}`} ref={root}>
      <VuMeter side="l" />
      <div className="nt-turntable">
        <div className="nt-platter">
          <div className="nt-record">
            <div className="nt-label">{label}</div>
          </div>
        </div>
        <span className="nt-arm" />
        <span className="nt-knob k1" />
        <span className="nt-knob k2" />
      </div>
      <VuMeter side="r" />
      <canvas className="nt-spectrum" ref={canvasRef} />
    </div>
  );
}

function Lives({ n }) {
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return <p className="nt-lives dead">💀 Життів не лишилось — тепер ти привид</p>;
  return (
    <div className="nt-lives">
      <span>Залишилось життів</span>
      <b>{"❤".repeat(Math.min(10, n))}</b>
    </div>
  );
}

// ---------------------------------------------------------------- the TV audio engine

/** Loads the clips, plays one at a time on cue, exposes an analyser; keeps the background music ducked under them. */
function useTvAudio({ enabled, socket }) {
  const bed = useRef(null); // background music (never goes through the analyser)
  const bedFade = useRef(null);
  const audios = useRef(new Map()); // url -> HTMLAudioElement
  const actx = useRef(null);
  const analyser = useRef(null);
  const sources = useRef(new Map());
  const current = useRef(null);
  const buffers = useRef({ freq: null, wave: null });
  const [loaded, setLoaded] = useState({ done: 0, total: 0 });

  const ensureGraph = useCallback((audio) => {
    try {
      if (!actx.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        actx.current = new Ctx();
        analyser.current = actx.current.createAnalyser();
        analyser.current.fftSize = 256;
        analyser.current.smoothingTimeConstant = 0.75;
        analyser.current.connect(actx.current.destination);
        buffers.current = { freq: new Uint8Array(analyser.current.frequencyBinCount), wave: new Uint8Array(analyser.current.fftSize) };
      }
      if (actx.current.state === "suspended") actx.current.resume().catch(() => {});
      if (!sources.current.has(audio)) {
        const src = actx.current.createMediaElementSource(audio);
        src.connect(analyser.current);
        sources.current.set(audio, src);
      }
    } catch {
      /* no analyser: the visualizer animates on its own */
    }
  }, []);

  const getAudio = useCallback((url) => {
    let a = audios.current.get(url);
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      a.src = url;
      a.volume = CLIP_VOLUME;
      audios.current.set(url, a);
    }
    return a;
  }, []);

  const preload = useCallback(
    (urls) => {
      setLoaded({ done: 0, total: urls.length });
      let done = 0;
      let reported = false;
      const report = () => {
        if (reported) return;
        reported = true;
        socket?.emit("minigameDisplayEvent", { name: "tune:ready", data: {} });
      };
      urls.forEach((u) => {
        const a = getAudio(u);
        const ok = () => {
          a.removeEventListener("canplaythrough", ok);
          done += 1;
          setLoaded({ done, total: urls.length });
          if (done >= urls.length) report();
        };
        if (a.readyState >= 4) ok();
        else a.addEventListener("canplaythrough", ok);
        a.load();
      });
      if (!urls.length) report();
    },
    [getAudio, socket]
  );

  // smoothly move the background music to `target` volume over `ms`
  const fadeBed = useCallback((target, ms) => {
    const a = bed.current;
    if (!a) return;
    window.clearInterval(bedFade.current);
    const from = a.volume;
    const t0 = performance.now();
    bedFade.current = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k >= 1) window.clearInterval(bedFade.current);
    }, 40);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const a = new Audio(BED_MUSIC);
    a.loop = true;
    a.volume = 0;
    bed.current = a;
    const resume = () => a.play().catch(() => {});
    if (!gameClock.isPaused()) resume();
    fadeBed(BED_VOLUME, BED_RISE_MS);
    const unsub = gameClock.subscribe((paused) => (paused ? a.pause() : resume()));
    return () => {
      unsub();
      window.clearInterval(bedFade.current);
      const fade = window.setInterval(() => {
        a.volume = Math.max(0, a.volume - BED_VOLUME / 10);
        if (a.volume <= 0.001) {
          window.clearInterval(fade);
          a.pause();
        }
      }, 80);
      bed.current = null;
    };
  }, [enabled, fadeBed]);

  const stop = useCallback(() => {
    const a = current.current;
    if (!a) return;
    fadeBed(BED_VOLUME, BED_RISE_MS); // the pause after the clip is filled with the music again
    const step = a.volume / 8;
    const fade = window.setInterval(() => {
      a.volume = Math.max(0, a.volume - step);
      if (a.volume <= 0.01) {
        window.clearInterval(fade);
        a.pause();
        a.volume = CLIP_VOLUME;
      }
    }, 50);
    current.current = null;
  }, [fadeBed]);

  const play = useCallback(
    (url, index, start = 0) => {
      stop();
      const a = getAudio(url);
      ensureGraph(a);
      current.current = a;
      const fail = () => socket?.emit("minigameDisplayEvent", { name: "tune:audioFail", data: { index } });
      a.onerror = fail;
      a.onended = () => current.current === a && fadeBed(BED_VOLUME, BED_RISE_MS); // a clip shorter than the window
      fadeBed(0, BED_DUCK_MS);
      try {
        a.currentTime = start || 0;
      } catch {
        /* not seekable yet */
      }
      a.volume = CLIP_VOLUME;
      a.play().catch(fail);
    },
    [ensureGraph, fadeBed, getAudio, socket, stop]
  );

  // follow the game pause
  useEffect(() => {
    if (!enabled) return undefined;
    return gameClock.subscribe((paused) => {
      const a = current.current;
      if (!a) return;
      if (paused) a.pause();
      else a.play().catch(() => {});
    });
  }, [enabled]);

  // stop everything when the minigame goes away
  useEffect(
    () => () => {
      audios.current.forEach((a) => {
        a.pause();
        a.removeAttribute("src");
      });
      audios.current.clear();
      actx.current?.close?.().catch(() => {});
    },
    []
  );

  const getData = useCallback(() => {
    const an = analyser.current;
    if (!an || !current.current || current.current.paused) return null;
    an.getByteFrequencyData(buffers.current.freq);
    an.getByteTimeDomainData(buffers.current.wave);
    return buffers.current;
  }, []);
  const progress = () => {
    const a = current.current;
    return a && a.duration ? Math.min(1, a.currentTime / a.duration) : 0;
  };

  return { preload, play, stop, getData, progress, loaded };
}

// ---------------------------------------------------------------- component

export default function NameThatTuneMinigame({
  socket,
  uiMode = "mobile",
  isActive,
  myPlayerId,
  namesById = {},
  slotsById = {},
  livesById = {},
  contestantIds = [],
  results,
  onSceneDone,
  onVideoStartedAt,
}) {
  const isDisplay = uiMode === "display";
  const [go, setGo] = useState(null); // { introEndsAt, rounds, points, losers, offset }
  const [round, setRound] = useState(null); // public round + offset
  const [progress, setProgress] = useState({ index: -1, answered: 0, total: 0 });
  const [mine, setMine] = useState({}); // index -> choice (server-confirmed)
  const [pending, setPending] = useState(null); // { index, choice } tapped, waiting for the ack
  const [result, setResult] = useState(null); // last tune:result
  const [retry, setRetry] = useState(null);
  const [, setTick] = useState(0);
  const sceneDoneRef = useRef(false);
  const finalT0 = useRef(null);
  const soundRef = useRef({});
  const tv = useTvAudio({ enabled: isDisplay, socket });
  const { preload: tvPreload, play: tvPlay, stop: tvStop } = tv; // stable callbacks
  const playTimer = useRef(null);

  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return undefined;
    const off = (d) => Number(d?.serverNow ?? gameClock.now()) - gameClock.now();
    const onGo = (d) => setGo({ introEndsAt: +d.introEndsAt, rounds: +d.rounds || 5, points: d.points || [], losers: +d.losers || 0, offset: off(d) });
    const onRound = (d) => {
      setRound({ ...d, offset: off(d) });
      setPending(null);
      setRetry(null);
    };
    const onProgress = (d) => setProgress(d || {});
    const onAck = (d) => {
      if (Number.isInteger(d?.index)) setMine((m) => ({ ...m, [d.index]: d.choice }));
    };
    const onResult = (d) => setResult({ ...d, offset: off(d) });
    const onRetry = (d) => setRetry(d?.message || "Ще раз!");
    socket.on("tune:go", onGo);
    socket.on("tune:round", onRound);
    socket.on("tune:progress", onProgress);
    socket.on("tune:ack", onAck);
    socket.on("tune:result", onResult);
    socket.on("tune:retry", onRetry);
    return () => {
      socket.off("tune:go", onGo);
      socket.off("tune:round", onRound);
      socket.off("tune:progress", onProgress);
      socket.off("tune:ack", onAck);
      socket.off("tune:result", onResult);
      socket.off("tune:retry", onRetry);
    };
  }, [socket]);

  // TV: preload the clips, play each one at its server start time
  useEffect(() => {
    if (!socket || !isDisplay) return undefined;
    const onPreload = (d) => tvPreload(Array.isArray(d?.urls) ? d.urls : []);
    const onPlay = (d) => {
      if (!d?.url) return;
      const offset = Number(d.serverNow ?? gameClock.now()) - gameClock.now();
      const wait = Math.max(0, Number(d.startAt) - (gameClock.now() + offset));
      if (playTimer.current) gameClock.clearTimeout(playTimer.current);
      playTimer.current = gameClock.setTimeout(() => tvPlay(d.url, d.index, d.start), wait);
    };
    socket.on("tune:preload", onPreload);
    socket.on("tune:play", onPlay);
    return () => {
      socket.off("tune:preload", onPreload);
      socket.off("tune:play", onPlay);
      if (playTimer.current) gameClock.clearTimeout(playTimer.current);
    };
  }, [socket, isDisplay, tvPreload, tvPlay]);

  const amContestant = contestantIds.includes(myPlayerId);
  useEffect(() => {
    if (isDisplay || !isActive || !socket || !amContestant) return;
    socket.emit("minigameEvent", { name: "tune:hello", data: {} });
  }, [isDisplay, isActive, socket, amContestant]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  const isFinal = !!results && results.minigameId === "tune" && !!results.tune;
  if (isFinal && finalT0.current == null) finalT0.current = gameClock.now();

  // ---------------------------------------------------------------- phase
  const now = gameClock.now() + (round?.offset ?? go?.offset ?? 0);
  const resultForRound = result && round && result.index === round.index ? result : null;
  const phase = isFinal
    ? "final"
    : !round
      ? "intro"
      : resultForRound
        ? "result"
        : now < round.startAt
          ? "announce"
          : "live";
  const countdown = phase === "announce" ? Math.max(1, Math.ceil((round.startAt - now) / 1000)) : null;
  const msLeft = round ? Math.max(0, round.endAt - now) : 0;
  const playMs = round ? round.endAt - round.startAt : 15000;

  // TV: stop the clip when the round is over
  useEffect(() => {
    if (isDisplay && (phase === "result" || phase === "final")) tvStop();
  }, [isDisplay, phase, tvStop]);

  // sounds (TV): 3-2-1, the reveal, the final
  const sKey = !isDisplay
    ? null
    : phase === "announce" && countdown <= 3
      ? `c${round.index}-${countdown}`
      : phase === "result"
        ? `r${round.index}`
        : phase === "final"
          ? "final"
          : null;
  useEffect(() => {
    if (!sKey || soundRef.current[sKey]) return;
    soundRef.current[sKey] = true;
    if (sKey.startsWith("c")) sfx("/assets/sounds/beep.mp3", 0.4);
    else if (sKey.startsWith("r")) sfx("/assets/sounds/notification.mp3", 0.45);
    else {
      sfx("/assets/sounds/win.mp3", 0.4);
      if ((results?.loserIds || []).length) gameClock.setTimeout(() => sfx(LOSE_SOUNDS[Math.floor(Math.random() * 4)], 0.8), 1600);
    }
  }, [sKey, results]);
  // phone: the "lost a life" sting on the final
  useEffect(() => {
    if (isDisplay || !isFinal || soundRef.current.myFinal) return;
    soundRef.current.myFinal = true;
    if ((results.loserIds || []).includes(myPlayerId)) sfx(LOSE_SOUNDS[Math.floor(Math.random() * 4)], 0.8);
  }, [isDisplay, isFinal, results, myPlayerId]);

  useEffect(() => {
    if (!isFinal || !isDisplay || sceneDoneRef.current) return undefined;
    const t = gameClock.setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, FINAL_SCENE_MS);
    return () => gameClock.clearTimeout(t);
  }, [isFinal, isDisplay, onSceneDone]);

  const answer = (choice) => {
    if (!round || phase !== "live" || mine[round.index] != null || pending?.index === round.index) return;
    setPending({ index: round.index, choice });
    try {
      navigator.vibrate?.(15);
    } catch {
      /* no vibration */
    }
    socket?.emit("minigameEvent", { name: "tune:answer", data: { index: round.index, choice } });
  };

  const nm = (id) => namesById[id] || "Гравець";
  const totals = (isFinal ? results.tune.totals : result?.totals) || {};
  const board = useMemo(
    () => [...contestantIds].sort((a, b) => (totals[b] || 0) - (totals[a] || 0) || nm(a).localeCompare(nm(b))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contestantIds, totals, namesById]
  );
  const cls = `nt-root ${isDisplay ? "nt-display" : "nt-mobile"} phase-${phase}`;
  const myChoice = round ? mine[round.index] ?? (pending?.index === round.index ? pending.choice : null) : null;

  // ================================================================== final
  if (isFinal) {
    const t = results.tune;
    const loserIds = results.loserIds || [];
    const place = (id) => 1 + t.ranked.filter((x) => t.totals[x] > t.totals[id]).length;
    const statusOf = (id) => (loserIds.includes(id) ? "lost" : t.topIds.includes(id) ? "win" : "safe");
    const STATUS = { win: "Переможець", safe: "У безпеці", lost: "Втрачено життя" };
    const note = t.allEqual
      ? "Однаковий рахунок у всіх — ніхто не втрачає життя"
      : t.tie
        ? `Нічия на межі: життя втрачають усі з однаковим рахунком (${loserIds.length})`
        : loserIds.length
          ? `Найменше балів — мінус життя (${loserIds.length})`
          : "";
    if (!isDisplay) {
      if (!t.ranked.includes(myPlayerId)) {
        return (
          <section className={cls}>
            <Stage />
            <Title />
            <p className="nt-muted">Дивись результати на головному екрані!</p>
          </section>
        );
      }
      const st = statusOf(myPlayerId);
      return (
        <section className={`${cls} st-${st}`}>
          <Stage />
          <Title small />
          <p className="nt-score">
            <b>{t.totals[myPlayerId] || 0}</b> балів
          </p>
          <p className="nt-place">
            {place(myPlayerId)} місце з {t.ranked.length} · вгадано {t.correct[myPlayerId] || 0} з {t.rounds.length}
          </p>
          <p className={`nt-status ${st}`}>{STATUS[st]}</p>
          {st === "lost" && (
            <>
              <p className="nt-life">−1 ❤</p>
              {/* the server takes the life only after this scene, so count it in here */}
              <Lives n={Number(results.livesById?.[myPlayerId] ?? livesById[myPlayerId]) - 1} />
            </>
          )}
        </section>
      );
    }
    return (
      <section className={`${cls} nt-final`}>
        <Stage />
        <Title small />
        <p className="nt-final-sub">Підсумки · {t.rounds.length} раундів</p>
        <div className="nt-final-board">
          {t.ranked.map((id, k) => {
            const st = statusOf(id);
            return (
              <div key={id} className={`nt-final-row st-${st}`} style={{ "--k": k }}>
                <span className="pl">{place(id)}</span>
                <img src={SPRITE(slotsById[id])} alt="" />
                <span className="nm">
                  {st === "win" && "👑 "}
                  {nm(id)}
                </span>
                <span className="cr">🎵 {t.correct[id] || 0} з {t.rounds.length}</span>
                <span className="pts">{t.totals[id] || 0}</span>
                <span className={`chip ${st}`}>
                  {STATUS[st]}
                  {st === "lost" ? " −1 ❤" : ""}
                </span>
              </div>
            );
          })}
        </div>
        {note && <p className={`nt-note ${t.tie ? "tie" : ""}`}>{note}</p>}
      </section>
    );
  }

  // ================================================================== phone
  if (!isDisplay) {
    if (!amContestant) {
      return (
        <section className={cls}>
          <Stage />
          <Title />
          <p className="nt-muted">Дивись і слухай головний екран!</p>
        </section>
      );
    }
    if (phase === "intro") {
      return (
        <section className={cls}>
          <Stage />
          <Title />
          <div className="nt-phone-card">
            <b>🎧 Музика грає на головному екрані</b>
            <span>5 раундів по 15 секунд. Тисни правильну назву якнайшвидше: перший правильний — 100 балів, далі 80, 60…</span>
            <span>Одна спроба на раунд. Помилка або мовчання — 0.</span>
          </div>
        </section>
      );
    }
    if (phase === "announce") {
      return (
        <section className={cls}>
          <Stage />
          <p className="nt-round-label">
            Раунд {round.index + 1}/{round.total}
          </p>
          {retry && <p className="nt-retry">{retry}</p>}
          <div className="nt-countdown phone" key={countdown}>
            {countdown}
          </div>
        </section>
      );
    }
    const res = resultForRound;
    const me = res?.players?.find((p) => p.id === myPlayerId);
    return (
      <section className={`${cls} nt-phone-play`}>
        <Stage />
        <div className="nt-phone-top">
          <span className="nt-round-pill">
            Раунд {round.index + 1}/{round.total}
          </span>
          {!res && <Ring msLeft={msLeft} totalMs={playMs} />}
        </div>
        {res ? (
          <div className={`nt-phone-result ${res.void ? "" : me?.correct ? "good" : "bad"}`}>
            <b>{res.void ? "Раунд скасовано" : me?.correct ? `Правильно! +${me.points}` : me?.choice == null ? "Не встиг — 0 балів" : "Не вгадав — 0 балів"}</b>
            {me?.correct && <span>{me.rank === 1 ? "Ти найшвидший!" : `${me.rank}-й серед тих, хто вгадав`}</span>}
            <small>
              {res.song.artist ? `${res.song.artist} — ` : ""}
              {res.song.title}
            </small>
            <em>Усього: {res.totals?.[myPlayerId] || 0} балів</em>
          </div>
        ) : (
          <p className="nt-phone-hint">{myChoice != null ? "✓ Відповідь прийнята — чекаємо інших" : "Що це за пісня?"}</p>
        )}
        <div className="nt-answers">
          {round.options.map((o, i) => {
            const chosen = myChoice === i;
            const state = res && !res.void ? (i === res.correctIndex ? "right" : chosen ? "wrong" : "dim") : chosen ? "chosen" : myChoice != null ? "dim" : "";
            return (
              <button key={i} type="button" className={`nt-answer a${i} ${state}`} disabled={myChoice != null || !!res} onClick={() => answer(i)}>
                <span className="nt-letter">{LETTERS[i]}</span>
                <span className="nt-answer-text">
                  <b>{o.title}</b>
                  {o.artist && <small>{o.artist}</small>}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  // ================================================================== TV
  if (phase === "intro") {
    const loaded = tv.loaded.total ? `${tv.loaded.done} з ${tv.loaded.total}` : "…";
    const secs = go ? Math.max(0, Math.ceil((go.introEndsAt - now) / 1000)) : null;
    const losers = go?.losers || 3;
    return (
      <section className={`${cls} nt-intro`}>
        <Stage />
        <Title />
        <p className="nt-tagline">Слухай уважно — відповідай першим!</p>
        <div className="nt-intro-body">
          <Turntable getData={null} active label={<span className="nt-label-note">♪</span>} small />
          <div className="nt-rules">
            <div className="nt-rule">
              <b>🎵</b>
              <span>
                <strong>{go?.rounds || 5} раундів.</strong> Звучить уривок пісні, на екрані — 4 варіанти назви. На відповідь 15 секунд.
              </span>
            </div>
            <div className="nt-rule">
              <b>⚡</b>
              <span>
                <strong>Швидкість — це бали.</strong> Перший правильний отримує 100, далі:
                <span className="nt-points">
                  {(go?.points || [100, 80, 60, 50, 40, 30, 20, 10]).map((p, i) => (
                    <i key={i}>{p}</i>
                  ))}
                </span>
              </span>
            </div>
            <div className="nt-rule">
              <b>🔒</b>
              <span>
                <strong>Одна спроба.</strong> Вибір не можна змінити. Помилка або мовчання — 0 балів.
              </span>
            </div>
            <div className="nt-rule bad">
              <b>💔</b>
              <span>
                <strong>Фінал.</strong> {losers === 1 ? "Гравець" : `${losers} гравці`} з найменшою сумою після {go?.rounds || 5} раундів втрачають життя.
              </span>
            </div>
          </div>
        </div>
        <p className="nt-loading">
          {tv.loaded.total && tv.loaded.done >= tv.loaded.total ? "💿 Платівки готові" : `💿 Готуємо платівки: ${loaded}`}
          {secs != null && secs > 0 ? ` · починаємо через ${secs} с` : ""}
        </p>
      </section>
    );
  }

  const leaderboard = (
    <aside className="nt-board">
      <h4>Рейтинг</h4>
      {board.map((id, k) => (
        <div key={id} className={`nt-board-row ${k === 0 && (totals[id] || 0) > 0 ? "lead" : ""}`} style={{ "--k": k }}>
          <span>{k + 1}</span>
          <img src={SPRITE(slotsById[id])} alt="" />
          <b>{nm(id)}</b>
          <em>{totals[id] || 0}</em>
        </div>
      ))}
    </aside>
  );

  if (phase === "announce") {
    return (
      <section className={`${cls} nt-announce ${round.index > 0 ? "with-board" : ""}`}>
        <Stage />
        <Title small />
        <div className="nt-sign" key={`r${round.index}`}>
          <small>Раунд</small>
          <b>
            {round.index + 1}/{round.total}
          </b>
        </div>
        <p className="nt-tagline">{retry || "Слухай уважно — відповідай першим!"}</p>
        <div className="nt-countdown" key={countdown}>
          {countdown}
        </div>
        {round.index > 0 && leaderboard}
      </section>
    );
  }

  const res = resultForRound;
  const answeredIds = res ? res.players.filter((p) => p.correct).sort((a, b) => a.rank - b.rank) : [];
  const answeredNow = progress.index === round.index ? progress.answered : 0;
  const label = res ? (
    res.void ? (
      <span className="nt-label-text">
        <b>Скасовано</b>
      </span>
    ) : (
      <span className="nt-label-text">
        <small>{res.song.artist}</small>
        <b>{res.song.title}</b>
      </span>
    )
  ) : (
    <span className="nt-label-note">?</span>
  );
  return (
    <section className={`${cls} nt-play`}>
      <Stage />
      <div className="nt-topbar">
        <Title small />
        <span className="nt-round-pill">
          Раунд {round.index + 1}/{round.total}
        </span>
        <Ring msLeft={res ? 0 : msLeft} totalMs={playMs} big />
      </div>
      <div className="nt-center">
        <Turntable getData={tv.getData} active={!res} label={label} revealed={!!res && !res.void} />
        <div className="nt-clip-bar">
          <i style={{ transform: `scaleX(${res ? 1 : tv.progress()})` }} />
        </div>
        <div className="nt-answers tv">
          {round.options.map((o, i) => {
            const state = res && !res.void ? (i === res.correctIndex ? "right" : "dim") : "";
            const pickers = res ? res.players.filter((p) => p.choice === i) : [];
            return (
              <div key={i} className={`nt-answer a${i} ${state}`} style={{ "--i": i }}>
                <span className="nt-letter">{LETTERS[i]}</span>
                <span className="nt-answer-text">
                  <b>{o.title}</b>
                  {o.artist && <small>{o.artist}</small>}
                </span>
                {res && pickers.length > 0 && (
                  <span className="nt-pickers">
                    {pickers.map((p) => (
                      <img key={p.id} src={SPRITE(slotsById[p.id])} alt={nm(p.id)} title={nm(p.id)} />
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {res ? (
        <div className="nt-winners">
          {answeredIds.length === 0 ? (
            <span className="nobody">Цього разу ніхто не вгадав 😶</span>
          ) : (
            answeredIds.map((p) => (
              <span key={p.id} className="nt-winner" style={{ "--k": p.rank }}>
                <i>{p.rank}</i>
                <img src={SPRITE(slotsById[p.id])} alt="" />
                <b>{nm(p.id)}</b>
                <em>+{p.points}</em>
                <small>{(p.ms / 1000).toFixed(1)} с</small>
              </span>
            ))
          )}
        </div>
      ) : (
        <div className="nt-answered">
          <span>
            Відповіли {answeredNow} з {progress.total || contestantIds.length}
          </span>
          <div className="nt-dots">
            {Array.from({ length: progress.total || contestantIds.length }, (_, i) => (
              <i key={i} className={i < answeredNow ? "on" : ""} />
            ))}
          </div>
        </div>
      )}
      {round.index > 0 || res ? leaderboard : null}
    </section>
  );
}
