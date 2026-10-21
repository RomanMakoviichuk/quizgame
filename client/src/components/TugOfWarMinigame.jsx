import { memo, useEffect, useMemo, useRef, useState } from "react";
import "./TugOfWarMinigame.css";
import gameClock from "../game/gameClock";
import { playVictory } from "../game/victory";
import { createTugFx } from "../game/tugFx";

/**
 * «Перетягни канат» — two equal teams tap as fast as they can for 10 seconds.
 * Server-authoritative (server/minigames/tugOfWar.js): the server counts every
 * tap, rate-limits it and owns both clocks; phones only send "I tapped" with a
 * running counter `n`.
 *
 * Events in:  tow:go { startAt, endsAt, serverNow, teams }
 *             tow:state { phase, teams, round, wins, winsNeeded, rounds, score, taps, position,
 *                         startAt, endsAt, serverNow, winner, message }
 * A series of 10-second rounds, first team to `winsNeeded` round wins; between
 * rounds the phase is "break" (last round's result + 3-2-1 for the next).
 * Event out:  minigameEvent tow:pull { n }
 *
 * TV: a night arena (web/arena.webp) with the burlap pullers (web/{team}_{slot}.webp,
 * all drawn facing right — the red team is mirrored), cloth banners with the
 * score, a power bar and per-player "energy" bolts from the live tap rate.
 * After a round the winners switch to web/win_{team}_{slot}.webp and the
 * losers sit down as web/lose_{team}_{slot}.webp. Every sprite is numbered
 * like alivecharacters/{slot}.png, so a player keeps their own character.
 */

const ASSET = "/assets/minigames/tug-of-war";
const ARENA = `${ASSET}/web/arena.webp`;
const MUSIC = `${ASSET}/background.mp3`; // the whole minigame
const MUSIC_VOLUME = 1; // level set by game/loudness.js

const okSlot = (slot) => (slot >= 1 && slot <= 8 ? slot : 1);
const PULLER = (team, slot) => `${ASSET}/web/${team}_${okSlot(slot)}.webp`;
const POSE = (pose, team, slot) => `${ASSET}/web/${pose}_${team}_${okSlot(slot)}.webp`;
const AVATAR = (slot) => `/assets/characters/alive/${okSlot(slot)}.png`;
// width/height of every pulling sprite and the centre of its fists (fraction of the height, from the top);
// web/{team}_{slot}.webp is numbered like alivecharacters/{slot}.png
const META = {
  1: { ar: 606 / 520, hand: 0.6 }, // bunny
  2: { ar: 627 / 520, hand: 0.565 }, // frog
  3: { ar: 686 / 520, hand: 0.54 }, // slime
  4: { ar: 660 / 520, hand: 0.555 }, // voodoo doll
  5: { ar: 630 / 520, hand: 0.57 }, // scarecrow
  6: { ar: 520 / 520, hand: 0.53 }, // tree
  7: { ar: 625 / 520, hand: 0.585 }, // hippo
  8: { ar: 616 / 520, hand: 0.59 }, // raccoon
};
// width/height of the after-round poses (win_*.webp / lose_*.webp)
const WIN_AR = { 1: 547, 2: 547, 3: 573, 4: 550, 5: 477, 6: 500, 7: 547, 8: 547 };
const LOSE_AR = { 1: 621, 2: 627, 3: 547, 4: 637, 5: 630, 6: 569, 7: 630, 8: 617 };
const POSE_H = { win: 1.05, lose: 0.8 }; // pose height relative to the pulling sprite
const MAX_PULLER_H = 34; // vh
const PULLER_STEP = 0.55; // next puller starts this far (in own widths) behind the previous one
const ROPE_Y = 58; // vh — the rope line on the TV
const KNOT_GAP = 6; // vh between the knot and the first fists
const SHIFT_VH = 16; // how far the whole tug slides at |position| = 1

const TEAM = {
  blue: { name: "СИНІ", color: "#3d8bff", hi: "#8cc0ff" },
  red: { name: "ЧЕРВОНІ", color: "#ff4646", hi: "#ff9b8f" },
};
const OTHER = { blue: "red", red: "blue" };
const TICK_MS = 100;
const MAX_LOCAL_TAPS_PER_SEC = 16; // don't flood the socket; the server limit is lower anyway

// the winners cheer on screen after every round they take
const ROUND_WIN_SOUND = "/assets/minigames/tug-of-war/happy.mp3";

function sfx(src, volume = 0.6) {
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

/** A looping music track that follows the game pause and fades out when turned off. */
function useTrack(src, on, volume) {
  useEffect(() => {
    if (!on) return undefined;
    const a = new Audio(src);
    a.loop = true;
    a.volume = volume;
    const play = () => a.play().catch(() => {});
    if (!gameClock.isPaused()) play();
    const unsub = gameClock.subscribe((paused) => (paused ? a.pause() : play()));
    return () => {
      unsub();
      const step = Math.max(0.01, a.volume / 10);
      const fade = window.setInterval(() => {
        a.volume = Math.max(0, a.volume - step);
        if (a.volume <= 0.001) {
          window.clearInterval(fade);
          a.pause();
        }
      }, 70);
    };
  }, [src, on, volume]);
}

/** Taps per second of every player over the last second, from the server's running counts. */
function useTapRates(taps) {
  const hist = useRef([]);
  return useMemo(() => {
    const now = performance.now();
    const h = hist.current.filter((s) => now - s.t < 1600);
    h.push({ t: now, taps: taps || {} });
    hist.current = h;
    const base = h.find((s) => now - s.t <= 1000) || h[0];
    const span = Math.max(0.25, (now - base.t) / 1000);
    const rates = {};
    Object.entries(taps || {}).forEach(([id, n]) => {
      rates[id] = Math.max(0, (n - (base.taps[id] || 0)) / span);
    });
    return rates;
  }, [taps]);
}
const boltLevel = (rate) => (rate >= 7 ? 3 : rate >= 4 ? 2 : rate >= 1.5 ? 1 : 0);

// ------------------------------------------------------------------ small pieces

const Bolt = ({ on }) => (
  <svg viewBox="0 0 12 20" className={`tw-bolt ${on ? "on" : ""}`} aria-hidden="true">
    <path d="M7.5 0 L0.5 11.2 H5.4 L3.8 20 L11.5 7.4 H6.6 Z" />
  </svg>
);
const Bolts = ({ level }) => (
  <span className={`tw-bolts l${level}`}>
    {[0, 1, 2].map((k) => (
      <Bolt key={k} on={k < level} />
    ))}
  </span>
);
const Crown = () => (
  <svg viewBox="0 0 64 40" className="tw-crown" aria-hidden="true">
    <path d="M4 36 L0 8 L18 20 L32 0 L46 20 L64 8 L60 36 Z" />
    <circle cx="32" cy="24" r="4" />
  </svg>
);

/** Wooden sign with the title, wrapped in rope. */
function Sign({ small }) {
  return (
    <header className={`tw-sign ${small ? "small" : ""}`}>
      <div className="tw-sign-board">
        <span className="tw-sign-rope l" />
        <span className="tw-sign-rope r" />
        <h2>ПЕРЕТЯГНИ КАНАТ</h2>
      </div>
    </header>
  );
}

/** Cloth banner with the team score. */
function Banner({ team, score, leading, big, wins, winsNeeded = 2 }) {
  return (
    <div className={`tw-banner ${team} ${leading ? "lead" : ""} ${big ? "big" : ""}`}>
      <span className="tw-banner-pole" />
      <div className="tw-banner-cloth">
        {leading && <Crown />}
        <small>{TEAM[team].name}</small>
        <b key={score}>{score}</b>
        {wins != null && (
          <span className="tw-pips" aria-label={`перемог: ${wins}`}>
            {Array.from({ length: winsNeeded }, (_, k) => (
              <i key={k} className={k < wins ? "on" : ""} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function TimerRing({ msLeft, totalMs }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const frac = totalMs ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const secs = Math.ceil(msLeft / 1000);
  return (
    <div className={`tw-timer ${secs <= 3 ? "hot" : ""}`}>
      <span className="tw-timer-bolt l" key={`l${secs}`}>
        <Bolt on />
      </span>
      <div className="tw-timer-dial">
        <svg viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={r} className="track" />
          <circle cx="20" cy="20" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
        </svg>
        <span key={secs}>{secs}</span>
      </div>
      <span className="tw-timer-bolt r" key={`r${secs}`}>
        <Bolt on />
      </span>
    </div>
  );
}

/** Blue/red power bar: blue fills from the left as the rope comes their way (position < 0). */
function PowerBar({ position }) {
  const p = Math.max(-1, Math.min(1, position || 0));
  const blue = 50 - p * 50;
  return (
    <div className="tw-power">
      <span className="tw-power-end l" />
      <div className="tw-power-track">
        <div className="tw-power-blue" style={{ width: `${blue}%` }} />
        <div className="tw-power-red" style={{ width: `${100 - blue}%` }} />
        <span className="tw-power-mid">« »</span>
        <span className="tw-power-knot" style={{ left: `${blue}%` }} />
      </div>
      <span className="tw-power-end r" />
    </div>
  );
}

function Roster({ team, ids, namesById, slotsById, rates }) {
  return (
    <div className={`tw-roster ${team}`}>
      {ids.map((id) => {
        const lvl = boltLevel(rates[id] || 0);
        return (
          <div key={id} className={`tw-ava e${lvl}`}>
            <div className="tw-ava-ring">
              <img src={AVATAR(slotsById[id])} alt="" />
            </div>
            <span className="tw-ava-name">{namesById[id] || "Гравець"}</span>
            <Bolts level={lvl} />
          </div>
        );
      })}
    </div>
  );
}

function useAspect() {
  const read = () => (typeof window === "undefined" ? 16 / 9 : window.innerWidth / Math.max(1, window.innerHeight));
  const [aspect, setAspect] = useState(read);
  useEffect(() => {
    const on = () => setAspect(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return aspect;
}

/** Phone: how many lives the player has left (after a lost tug). */
function LivesLeft({ lives }) {
  const n = Number(lives);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return <p className="tw-lives dead">💀 Життів не лишилось — тепер ти привид</p>;
  return (
    <div className="tw-lives">
      <span>Залишилось життів</span>
      <b>{"❤".repeat(Math.min(10, n))}</b>
    </div>
  );
}

/** Night arena backdrop: torch glows, swaying spotlights. */
const Arena = memo(function Arena() {
  return (
    <div className="tw-arena" aria-hidden="true">
      <div className="tw-arena-img" style={{ backgroundImage: `url(${ARENA})` }} />
      {[
        [31, 17],
        [69, 17],
        [20, 36],
        [80, 36],
        [40, 41],
        [60, 41],
      ].map(([x, y], i) => (
        <span key={i} className="tw-torch" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${-i * 0.37}s` }} />
      ))}
      <span className="tw-beam l" />
      <span className="tw-beam r" />
      <div className="tw-vignette" />
    </div>
  );
});

/**
 * The tug itself: the rope and both teams ride a stage that slides with
 * `position` (-1 = all the way to blue … 1 = to red). Every surge of a team's
 * score kicks dust, pops a "+N" and jerks that team.
 */
const Field = memo(function Field({ teams, score, position, slotsById, namesById, phase, winner, rates, fx, penalty = true }) {
  const teamRefs = useRef({});
  const pullerRefs = useRef(new Map());
  const prev = useRef(score);
  const acc = useRef({ blue: 0, red: 0 });
  const lastBurst = useRef({ blue: 0, red: 0 });
  const knotRef = useRef(null);
  const leadRef = useRef(0);

  useEffect(() => {
    const before = prev.current;
    prev.current = score;
    if (phase !== "live") return;
    const f = fx.current;
    const now = performance.now();
    ["blue", "red"].forEach((team) => {
      const d = (score[team] || 0) - (before[team] || 0);
      if (d <= 0) return;
      acc.current[team] += d;
      if (now - lastBurst.current[team] < 160) return;
      lastBurst.current[team] = now;
      const gained = acc.current[team];
      acc.current[team] = 0;
      const ids = teams[team];
      const el = pullerRefs.current.get(ids[Math.floor(Math.random() * ids.length)]);
      if (el && f) {
        const r = el.getBoundingClientRect();
        const c = f.canvas.getBoundingClientRect();
        const dir = team === "blue" ? -1 : 1;
        f.fx.dust(r.left - c.left + r.width * (team === "blue" ? 0.35 : 0.65), r.bottom - c.top - r.height * 0.04, dir, Math.min(1.6, 0.5 + gained / 4));
        f.fx.text(r.left - c.left + r.width / 2, r.top - c.top + r.height * 0.1, `+${gained}`, TEAM[team].hi);
      }
      teamRefs.current[team]?.animate(
        [{ transform: "translateX(0)" }, { transform: `translateX(${team === "blue" ? -1.4 : 1.4}vh)` }, { transform: "translateX(0)" }],
        { duration: 240, easing: "cubic-bezier(.2,.9,.3,1)" }
      );
    });
    // lead change → sparks on the knot
    const lead = Math.sign((score.blue || 0) - (score.red || 0));
    if (lead !== 0 && lead !== leadRef.current && knotRef.current && f) {
      const r = knotRef.current.getBoundingClientRect();
      const c = f.canvas.getBoundingClientRect();
      f.fx.sparks(r.left - c.left + r.width / 2, r.top - c.top + r.height / 3, 26, lead > 0 ? TEAM.blue.hi : TEAM.red.hi);
    }
    if (lead !== 0) leadRef.current = lead;
  }, [score, phase, teams, fx]);

  const aspect = useAspect();
  const n = Math.min(4, Math.max(1, teams.blue.length));
  // as big as possible while the whole line (rope pulled all the way) still fits half the screen
  const halfVh = aspect * 50 - SHIFT_VH - 2;
  const H = Math.max(14, Math.min(MAX_PULLER_H, (halfVh - KNOT_GAP) / (1.22 * (1 + PULLER_STEP * (n - 1)))));
  const shift = Math.max(-1, Math.min(1, position || 0)) * SHIFT_VH;
  const lost = winner === "blue" ? "red" : winner === "red" ? "blue" : null;
  const posed = phase !== "live" && !!lost;
  const groundY = ROPE_Y + 0.42 * H; // where the pullers' feet are

  return (
    <div className={`tw-field ${phase}`}>
      <div className="tw-stage" style={{ transform: `translateX(${shift}vh)` }}>
        {/* once somebody won, the rope is dropped on the ground */}
        <div className={`tw-rope ${posed ? "dropped" : ""}`} style={{ top: `${posed ? groundY - 0.6 : ROPE_Y}vh` }}>
          <span className="tw-knot" ref={knotRef}>
            <span className="tw-ribbon a" />
            <span className="tw-ribbon b" />
          </span>
        </div>
        {["blue", "red"].map((team) => (
          <div
            key={team}
            ref={(el) => {
              teamRefs.current[team] = el;
            }}
            className={`tw-team ${team} ${lost === team ? "fallen" : ""} ${winner === team ? "won" : ""}`}
          >
            {teams[team].map((id, i) => {
              const slot = okSlot(slotsById[id]);
              const m = META[slot];
              const W = H * m.ar;
              const off = KNOT_GAP + i * W * PULLER_STEP;
              const lvl = boltLevel(rates[id] || 0);
              const pose = posed ? (lost === team ? "lose" : "win") : null;
              // a pose is centred where the puller stood, feet on the same ground line
              const Hp = pose ? H * POSE_H[pose] : H;
              const Wp = pose ? (Hp * (pose === "win" ? WIN_AR : LOSE_AR)[slot]) / 520 : W;
              const centre = off + W / 2;
              const box = pose
                ? {
                    left: team === "blue" ? `calc(50% - ${centre + Wp / 2}vh)` : `calc(50% + ${centre - Wp / 2}vh)`,
                    top: `${groundY - Hp}vh`,
                    width: `${Wp}vh`,
                    height: `${Hp}vh`,
                  }
                : {
                    left: team === "blue" ? `calc(50% - ${off + W}vh)` : `calc(50% + ${off}vh)`,
                    top: `${ROPE_Y - m.hand * H}vh`,
                    width: `${W}vh`,
                    height: `${H}vh`,
                  };
              return (
                <div
                  key={id}
                  ref={(el) => (el ? pullerRefs.current.set(id, el) : pullerRefs.current.delete(id))}
                  className={`tw-puller e${lvl} ${pose ? `pose-${pose}` : ""}`}
                  style={{ "--i": i, "--hand": m.hand, ...box, zIndex: 10 - i }}
                >
                  <span className="tw-shadow" />
                  <div className="tw-body">
                    <img src={pose ? POSE(pose, team, slot) : PULLER(team, slot)} alt="" draggable="false" />
                  </div>
                  <span className="tw-tag">{namesById[id] || "Гравець"}</span>
                  {penalty && lost === team && <span className="tw-minus">−1 ❤</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});

/** Full-screen canvas for the particle effects; exposes {fx, canvas} through `fxRef`. */
function FxLayer({ fxRef }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const entry = { fx: createTugFx(canvas), canvas };
    fxRef.current = entry;
    return () => {
      entry.fx.destroy();
      if (fxRef.current === entry) fxRef.current = null; // a new layer may already own it (phase switch)
    };
  }, [fxRef]);
  return <canvas className="tw-fx" ref={canvasRef} />;
}

// ------------------------------------------------------------------ the minigame

export default function TugOfWarMinigame({
  socket,
  uiMode = "mobile",
  isActive,
  myPlayerId,
  namesById = {},
  slotsById = {},
  livesById = {},
  results,
  onSceneDone,
  onVideoStartedAt,
}) {
  const isDisplay = uiMode === "display";
  const [st, setSt] = useState(null);
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  const [pressN, setPressN] = useState(0); // my taps sent (for the button animation)
  const counterRef = useRef(0);
  const sentAtRef = useRef([]);
  const sceneDoneRef = useRef(false);
  const beepRef = useRef(null);
  const endSoundRef = useRef(false);
  const confettiRef = useRef(false);
  const fxRef = useRef(null);

  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return;
    const sync = (d) => {
      if (Number.isFinite(Number(d.serverNow))) setOffset(Number(d.serverNow) - gameClock.now());
    };
    const onGo = (d) => {
      sync(d);
      setSt((s) => ({ ...(s || {}), phase: "prep", teams: d.teams, startAt: d.startAt, endsAt: d.endsAt, score: { blue: 0, red: 0 }, taps: {}, position: 0 }));
    };
    const onState = (d) => {
      sync(d);
      setSt(d);
    };
    socket.on("tow:go", onGo);
    socket.on("tow:state", onState);
    return () => {
      socket.off("tow:go", onGo);
      socket.off("tow:state", onState);
    };
  }, [socket]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  const serverNow = gameClock.now() + offset;
  const startAt = st?.startAt || 0;
  const endsAt = st?.endsAt || 0;
  const beforeStart = !!startAt && serverNow < startAt && st?.phase === "prep";
  const inBreak = st?.phase === "break";
  const countdownNum = (beforeStart || inBreak) && serverNow < startAt ? Math.max(1, Math.ceil((startAt - serverNow) / 1000)) : null;
  const round = st?.round || 1;
  const winsNeeded = st?.winsNeeded || 2;
  const wins = (results && results.minigameId === "tugOfWar" ? results.wins : st?.wins) || { blue: 0, red: 0 };
  const lastRound = st?.rounds?.[st.rounds.length - 1] || null;
  const live = st?.phase === "live" && serverNow < endsAt;
  const msLeft = endsAt ? Math.max(0, endsAt - serverNow) : 0;
  const myTeam = st?.teams ? (st.teams.blue.includes(myPlayerId) ? "blue" : st.teams.red.includes(myPlayerId) ? "red" : null) : null;
  const rates = useTapRates(st?.taps);

  const isResults = !!results && results.minigameId === "tugOfWar";
  const cancelled = (isResults && results.cancelled) || st?.phase === "cancelled";

  // background music for the whole minigame
  useTrack(MUSIC, isDisplay && (isActive || isResults) && !cancelled, MUSIC_VOLUME);

  // TV sounds: 3-2-1 beeps, a bell at the start, a fanfare at the end
  const beepKey = countdownNum != null && countdownNum <= 3 ? `c${round}-${countdownNum}` : live ? `go${round}` : null;
  useEffect(() => {
    if (!isDisplay || !beepKey || beepRef.current === beepKey) return;
    beepRef.current = beepKey;
    sfx(beepKey.startsWith("go") ? "/assets/sounds/bell.mp3" : "/assets/sounds/beep.mp3", 0.5);
  }, [isDisplay, beepKey]);
  // a cheer every time a team wins a round (draws stay quiet)
  const roundsDone = st?.rounds?.length || 0;
  const roundCheerRef = useRef(0);
  useEffect(() => {
    if (!isDisplay || roundsDone <= roundCheerRef.current) return;
    roundCheerRef.current = roundsDone;
    if (lastRound && lastRound.winner !== "draw") sfx(ROUND_WIN_SOUND, 1);
  }, [isDisplay, roundsDone, lastRound]);
  useEffect(() => {
    if (!isDisplay || st?.phase !== "done" || endSoundRef.current) return;
    endSoundRef.current = true;
    playVictory(0.55);
  }, [isDisplay, st?.phase]);

  useEffect(() => {
    if (!isResults || !isDisplay || sceneDoneRef.current) return;
    const t = gameClock.setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, results.cancelled ? 4500 : 9000);
    return () => gameClock.clearTimeout(t);
  }, [isResults, isDisplay, onSceneDone, results]);

  // winners' confetti
  const winnerForFx = isResults && !results.cancelled ? results.winner : null;
  useEffect(() => {
    if (!isDisplay || !winnerForFx || confettiRef.current) return undefined;
    confettiRef.current = true;
    const t = window.setTimeout(() => {
      const colors =
        winnerForFx === "blue"
          ? ["#3d8bff", "#8cc0ff", "#ffd36b", "#ffffff"]
          : winnerForFx === "red"
            ? ["#ff4646", "#ff9b8f", "#ffd36b", "#ffffff"]
            : ["#3d8bff", "#ff4646", "#ffd36b"];
      fxRef.current?.fx.confetti(colors, winnerForFx === "draw" ? 90 : 200);
    }, 250);
    return () => window.clearTimeout(t);
  }, [isDisplay, winnerForFx]);

  const pull = (e) => {
    e.preventDefault();
    if (!live || !myTeam) return;
    const now = gameClock.now();
    const recent = sentAtRef.current.filter((t) => now - t < 1000);
    if (recent.length >= MAX_LOCAL_TAPS_PER_SEC) return;
    recent.push(now);
    sentAtRef.current = recent;
    counterRef.current += 1;
    setPressN((n) => n + 1);
    try {
      navigator.vibrate?.(12);
    } catch {
      /* no vibration */
    }
    socket?.emit("minigameEvent", { name: "tow:pull", data: { n: counterRef.current } });
  };

  const nm = (id) => namesById[id] || "Гравець";
  const cls = `tw-root ${isDisplay ? "tw-display" : "tw-mobile"}`;
  const teams = st?.teams || results?.teams;
  const score = (isResults ? results.score : st?.score) || { blue: 0, red: 0 };
  const position = isResults ? results.position ?? 0 : st?.position ?? 0;
  const leader = score.blue > score.red ? "blue" : score.red > score.blue ? "red" : null;
  const cancelText = results?.message || st?.message || "Битву скасовано: хтось із гравців вийшов";

  // ================================================================== phone
  if (!isDisplay) {
    const mySlot = slotsById[myPlayerId];
    const phoneBg = <div className="tw-phone-bg" style={{ backgroundImage: `url(${ARENA})` }} />;

    if (cancelled) {
      return (
        <section className={cls}>
          {phoneBg}
          <Sign small />
          <p className="tw-cancel">{cancelText}</p>
        </section>
      );
    }
    if (isResults && teams) {
      const w = results.winner;
      const dd = !!results.doubleDraw; // two draws in a row: everybody loses a life
      const mineWon = !dd && w === myTeam;
      const mineLost = !!myTeam && (dd || (w !== "draw" && !mineWon));
      return (
        <section className={`${cls} ${myTeam || ""} ${mineLost ? "lost" : ""}`}>
          {phoneBg}
          <Sign small />
          {myTeam && !mineLost && <img className={`tw-phone-me ${mineWon ? "won" : "idle"}`} src={mineWon ? POSE("win", myTeam, mySlot) : PULLER(myTeam, mySlot)} alt="" />}
          <p className={`tw-big ${dd ? "bad" : w === "draw" ? "" : mineWon ? "good" : "bad"}`}>
            {dd ? "ДВІ НІЧИЇ ПОСПІЛЬ!" : w === "draw" ? "НІЧИЯ!" : mineWon ? "ВИ ПЕРЕМОГЛИ!" : "ВИ ПРОГРАЛИ"}
          </p>
          {mineLost && (
            <>
              <p className="tw-life">−1 ❤</p>
              {/* the server takes the life only after this scene, so count it in here */}
              <LivesLeft lives={Number(livesById[myPlayerId]) - (results.loserIds?.includes(myPlayerId) ? 1 : 0)} />
            </>
          )}
          {w === "draw" && <p className="tw-muted">{dd ? "Усі учасники втрачають життя" : "Ніхто не втрачає життя"}</p>}
          <p className="tw-muted">Раунди</p>
          <p className="tw-phone-final">
            <span className="b">{wins.blue}</span> : <span className="r">{wins.red}</span>
          </p>
          <p className="tw-muted">Твоїх ривків: {results.minigameScores?.[myPlayerId] || 0}</p>
        </section>
      );
    }
    if (!isActive || !st?.teams) {
      return (
        <section className={cls}>
          {phoneBg}
          <Sign />
          <p className="tw-muted">Дивись на головний екран</p>
        </section>
      );
    }
    if (beforeStart) {
      return (
        <section className={`${cls} ${myTeam || ""}`}>
          {phoneBg}
          <Sign small />
          {myTeam ? (
            <>
              <p className="tw-you">Ти в команді</p>
              <p className={`tw-team-name ${myTeam}`}>{TEAM[myTeam].name}</p>
              <img className="tw-phone-me idle" src={PULLER(myTeam, mySlot)} alt="" />
              <div className="tw-phone-mates">
                {st.teams[myTeam].map((id) => (
                  <span key={id} className={id === myPlayerId ? "me" : ""}>
                    {nm(id)}
                  </span>
                ))}
              </div>
              <p className="tw-muted">Тисни кнопку якомога частіше, коли почнеться!</p>
            </>
          ) : (
            <p className="tw-muted">Дивись на головний екран</p>
          )}
          {countdownNum <= 3 && (
            <div className={`tw-countdown ${myTeam || ""}`} key={countdownNum}>
              {countdownNum}
            </div>
          )}
        </section>
      );
    }
    if (inBreak) {
      const rw = lastRound?.winner;
      const roundLost = !!myTeam && !!rw && rw !== "draw" && rw !== myTeam;
      return (
        <section className={`${cls} ${myTeam || ""} ${roundLost ? "lost" : ""}`}>
          {phoneBg}
          <Sign small />
          <p className="tw-you">Раунд {round - 1}</p>
          <p className={`tw-big ${!rw || rw === "draw" ? "" : rw === myTeam ? "good" : "bad"}`}>
            {!rw || rw === "draw" ? "НІЧИЯ — ПЕРЕГРАЄМО!" : rw === myTeam ? "РАУНД ВАШ!" : "РАУНД ЇХНІЙ"}
          </p>
          {roundLost && <p className="tw-muted">Ще не кінець — відіграйтесь у наступному раунді!</p>}
          {(!rw || rw === "draw") && <p className="tw-muted">Ще одна нічия — і всі втратять життя!</p>}
          {myTeam && !roundLost && (
            <img className={`tw-phone-me ${rw === myTeam ? "won" : "idle"}`} src={rw === myTeam ? POSE("win", myTeam, mySlot) : PULLER(myTeam, mySlot)} alt="" />
          )}
          <p className="tw-phone-final">
            <span className="b">{wins.blue}</span> : <span className="r">{wins.red}</span>
          </p>
          <p className="tw-muted">
            Гра до {winsNeeded} перемог · далі раунд {round}
          </p>
          {countdownNum != null && countdownNum <= 3 && (
            <div className={`tw-countdown ${myTeam || ""}`} key={`${round}-${countdownNum}`}>
              {countdownNum}
            </div>
          )}
        </section>
      );
    }
    const mine = myTeam ? score[myTeam] : 0;
    const theirs = myTeam ? score[OTHER[myTeam]] : 0;
    const lead = mine + theirs > 0 ? mine / (mine + theirs) : 0.5;
    return (
      <section className={`${cls} ${myTeam || ""}`}>
        {phoneBg}
        <div className="tw-phone-top">
          <span className={`tw-phone-team ${myTeam || ""}`}>
            {myTeam ? TEAM[myTeam].name : ""} · Р{round}
          </span>
          <span className="tw-phone-time">⏱ {Math.ceil(msLeft / 1000)}</span>
        </div>
        <div className="tw-phone-bar">
          <div className={`tw-phone-bar-mine ${myTeam || ""}`} style={{ transform: `scaleX(${lead})` }} />
        </div>
        <div className="tw-phone-scores">
          <span>
            Ми: <b>{mine}</b>
          </span>
          <Bolts level={live ? boltLevel(rates[myPlayerId] || 0) : 0} />
          <span>
            Вони: <b>{theirs}</b>
          </span>
        </div>
        {myTeam && <img className={`tw-phone-me pulling ${pressN % 2 ? "a" : "b"}`} src={PULLER(myTeam, mySlot)} alt="" />}
        <button
          type="button"
          className={`tw-pull ${myTeam || ""}`}
          disabled={!live || !myTeam}
          onPointerDown={pull}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="tw-pull-ring" key={pressN} />
          <span className="tw-pull-label">{live ? "ТЯГНИ!" : "СТОП"}</span>
          <span className="tw-pull-count">{st.taps?.[myPlayerId] || 0}</span>
        </button>
      </section>
    );
  }

  // ================================================================== TV
  const fxLayer = <FxLayer fxRef={fxRef} />;

  if (cancelled) {
    return (
      <section className={`${cls} tw-wait`}>
        <Arena />
        {fxLayer}
        <Sign />
        <p className="tw-cancel">{cancelText}</p>
      </section>
    );
  }

  // ---------------------------------------------------------------- results
  if (isResults && teams) {
    const w = results.winner;
    const dd = !!results.doubleDraw;
    const loser = w === "draw" ? null : OTHER[w];
    return (
      <section className={`${cls} tw-end ${w}`}>
        <div className="tw-cam">
          <Arena />
          <Field
            teams={teams}
            score={score}
            position={position}
            slotsById={slotsById}
            namesById={namesById}
            phase="done"
            winner={w}
            rates={{}}
            fx={fxRef}
          />
        </div>
        {fxLayer}
        <div className="tw-hud">
          <Banner team="blue" score={wins.blue} leading={w === "blue"} big />
          <div className="tw-end-head">
            <h3 className={`tw-end-title ${w}`}>{dd ? "ДВІ НІЧИЇ ПОСПІЛЬ!" : w === "draw" ? "НІЧИЯ!" : `ПЕРЕМОГЛИ ${TEAM[w].name}!`}</h3>
            <p className="tw-end-sub">
              {dd ? "Усі учасники втрачають по життю 💀" : w === "draw" ? "Ніхто не втрачає життя" : `Раунди ${wins.blue} : ${wins.red}`}
            </p>
          </div>
          <Banner team="red" score={wins.red} leading={w === "red"} big />
        </div>
        {loser && (
          <p className="tw-verdict">
            {TEAM[loser].name}: {teams[loser].map(nm).join(", ")} — мінус життя
          </p>
        )}
      </section>
    );
  }

  // ---------------------------------------------------------------- waiting
  if (!isActive || !st?.teams) {
    return (
      <section className={`${cls} tw-wait`}>
        <Arena />
        {fxLayer}
        <Sign />
        <p className="tw-getready">Формуємо команди…</p>
      </section>
    );
  }

  // ---------------------------------------------------------------- teams + 3-2-1
  if (beforeStart) {
    return (
      <section className={`${cls} tw-prep`}>
        <Arena />
        {fxLayer}
        <Sign />
        <div className="tw-squads">
          {["blue", "red"].map((team) => (
            <div key={team} className={`tw-squad ${team}`}>
              <h3>{TEAM[team].name}</h3>
              <div className="tw-squad-list">
                {st.teams[team].map((id, i) => (
                  <div key={id} className="tw-squad-member" style={{ "--i": i }}>
                    <img src={PULLER(team, slotsById[id])} alt="" />
                    <span>{nm(id)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <span className="tw-vs">VS</span>
        </div>
        <div className="tw-rules">
          <span>👆 Тисни «ТЯГНИ!» якомога частіше</span>
          <span>⏱ Раунди по 10 секунд</span>
          <span>🏆 Гра до {winsNeeded} перемог</span>
          <span>💀 Програла команда — кожен −1 життя</span>
          <span>🤝 Нічия — переграємо, але дві нічиї поспіль — усі −1 життя</span>
        </div>
        {countdownNum <= 3 ? (
          <div className="tw-countdown" key={countdownNum}>
            {countdownNum}
          </div>
        ) : (
          <div className="tw-getready">Хапайте канат… {countdownNum}</div>
        )}
      </section>
    );
  }

  // ---------------------------------------------------------------- the tug
  const goFlash = live && serverNow - startAt < 900;
  const tense = live && msLeft <= 3000;
  const roundWinner = inBreak ? lastRound?.winner || "draw" : null;
  return (
    <section className={`${cls} tw-live ${tense ? "tense" : ""}`}>
      <div className="tw-cam">
        <Arena />
        <Field
          key={`${round}${inBreak ? "b" : ""}`}
          teams={st.teams}
          score={score}
          position={position}
          slotsById={slotsById}
          namesById={namesById}
          phase={live ? "live" : "done"}
          winner={roundWinner}
          penalty={false}
          rates={rates}
          fx={fxRef}
        />
      </div>
      {fxLayer}
      <div className="tw-hud">
        <Banner team="blue" score={score.blue} leading={leader === "blue"} wins={wins.blue} winsNeeded={winsNeeded} />
        <div className="tw-hud-mid">
          <Sign small />
          <TimerRing msLeft={inBreak ? endsAt - startAt : msLeft} totalMs={endsAt - startAt} />
          <span className="tw-round">РАУНД {round}</span>
        </div>
        <Banner team="red" score={score.red} leading={leader === "red"} wins={wins.red} winsNeeded={winsNeeded} />
      </div>
      <div className="tw-bottom">
        <PowerBar position={position} />
        <div className="tw-rosters">
          <Roster team="blue" ids={st.teams.blue} namesById={namesById} slotsById={slotsById} rates={live ? rates : {}} />
          <Roster team="red" ids={st.teams.red} namesById={namesById} slotsById={slotsById} rates={live ? rates : {}} />
        </div>
      </div>
      {goFlash && <div className="tw-go">ТЯГНИ!</div>}
      {inBreak &&
        (countdownNum != null && countdownNum <= 3 ? (
          <div className="tw-countdown" key={`${round}-${countdownNum}`}>
            {countdownNum}
          </div>
        ) : (
          <div className={`tw-round-result ${roundWinner}`} key={`rr${round}`}>
            <small>РАУНД {round - 1}</small>
            <b>{roundWinner === "draw" ? "НІЧИЯ — ПЕРЕГРАЄМО!" : `ЗА ${roundWinner === "blue" ? "СИНІМИ" : "ЧЕРВОНИМИ"}!`}</b>
            <span>
              {wins.blue} : {wins.red}
            </span>
            {roundWinner === "draw" && <em className="tw-draw-warn">Ще одна нічия — і всі втратять життя!</em>}
          </div>
        ))}
      {!live && !inBreak && <div className="tw-stop">СТОП!</div>}
    </section>
  );
}
