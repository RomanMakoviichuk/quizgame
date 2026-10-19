import { memo, useEffect, useRef, useState } from "react";
import "./RockPaperScissorsMinigame.css";
import gameClock from "../game/gameClock";

/**
 * "Камінь-Ножиці-Папір-Паяльник-Янукович" — server-authoritative elimination
 * minigame. server/minigames/rps.js runs every round; this component only
 * renders and forwards the player's choice.
 *
 * Events in:  rps:go { startAt, serverNow }
 *             rps:round { round, alive, deadlineAt, choiceMs }
 *             rps:locked { round, choice }
 *             rps:progress { round, submitted, total, lockedIds }
 *             rps:reveal { round, choices, winningChoice, continued, eliminated,
 *                          replay, scores, outChoices }
 * Event out:  minigameEvent { name: "rps:choose", data: { choice } }
 */

const IMG = (id) => `/assets/minigames/RPS/web/${id}.webp`;
const SPRITE = (slot) =>
  `/assets/images/Characters/alivecharacters/${slot >= 1 && slot <= 8 ? slot : 1}.png`;

const FIGHTERS = {
  rock: { name: "Камінь", acc: "камінь", color: "#b9b1a6" },
  scissors: { name: "Ножиці", acc: "ножиці", color: "#ff4b36" },
  paper: { name: "Папір", acc: "папір", color: "#f3ede2" },
  solder: { name: "Паяльник", acc: "паяльник", color: "#ffb22e" },
  yanukovych: { name: "Янукович", acc: "Януковича", color: "#5b84ff" },
};
const BUTTON_ORDER = ["rock", "scissors", "paper", "solder", "yanukovych"];
// Around the wheel every fighter beats the next one and the one three ahead.
const RING = ["rock", "solder", "yanukovych", "scissors", "paper"];
const BEATS = {
  rock: ["solder", "scissors"],
  scissors: ["paper", "solder"],
  paper: ["rock", "yanukovych"],
  solder: ["yanukovych", "paper"],
  yanukovych: ["scissors", "rock"],
};
const VERBS = {
  "scissors>paper": "ріжуть",
  "paper>rock": "накриває",
  "rock>solder": "роздавлює",
  "solder>yanukovych": "пече",
  "yanukovych>scissors": "краде",
  "scissors>solder": "розрізають",
  "solder>paper": "пропалює",
  "paper>yanukovych": "накриває",
  "yanukovych>rock": "викидає",
  "rock>scissors": "ламає",
};
const RULES = Object.keys(VERBS).map((k) => k.split(">"));
const ruleText = (w, l) => `${FIGHTERS[w].name} ${VERBS[`${w}>${l}`]} ${FIGHTERS[l].acc}`;

const JUDGE_DELAY_MS = 1500; // cards flip first, then the verdict lands
const RULE_SPOTLIGHT_MS = 2600;
const TICK_MS = 250; // countdown / timer ring refresh — no need for more // 10 rules x 2.6s fit the 30s rules screen

const MUSIC = "/assets/minigames/RPS/background.mp3";
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/minigames/RPS/lose_${n}.mp3`);
const MUSIC_VOLUME = 1; // level set by game/loudness.js

// Lose sounds come from a shuffled bag: all four play before any repeats.
let loseBag = [];
let lastLose = null;
function playLoseSound() {
  if (!loseBag.length) {
    loseBag = [...LOSE_SOUNDS].sort(() => Math.random() - 0.5);
    if (loseBag.length > 1 && loseBag[0] === lastLose) loseBag.push(loseBag.shift());
  }
  lastLose = loseBag.shift();
  sfx(lastLose, 0.85);
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

/** Every "X beats Y" line that actually happened between the shown choices. */
function battleLines(choices) {
  const shown = [...new Set(Object.values(choices))];
  const lines = [];
  for (const [w, l] of RULES) if (shown.includes(w) && shown.includes(l)) lines.push([w, l]);
  return lines;
}

function Title({ small }) {
  return (
    <header className={`rps-head ${small ? "small" : ""}`}>
      <h2 className="rps-title">КАМІНЬ · НОЖИЦІ · ПАПІР</h2>
      <p className="rps-title-sub">
        + <span style={{ color: FIGHTERS.solder.color }}>ПАЯЛЬНИК</span> +{" "}
        <span style={{ color: FIGHTERS.yanukovych.color }}>ЯНУКОВИЧ</span>
      </p>
    </header>
  );
}

// ---------------------------------------------------------------- rule wheel

/**
 * A curved arrow from fighter a to fighter b (viewBox units): the shaft bows
 * away from the wheel's centre, the head is a swept triangle along the curve's
 * end tangent. Both ends stop short of the fighter pictures.
 */
function arrowGeometry(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const s = { x: a.x + ux * 11.5, y: a.y + uy * 11.5 };
  const e = { x: b.x - ux * 12.5, y: b.y - uy * 12.5 };
  // bow outward: normal pointing away from the centre (50,50)
  const mx = (s.x + e.x) / 2;
  const my = (s.y + e.y) / 2;
  let nx = -uy;
  let ny = ux;
  if (nx * (mx - 50) + ny * (my - 50) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const bend = len > 50 ? 4 : 7; // chords bend a little, rim arrows more
  const c = { x: mx + nx * bend, y: my + ny * bend };
  // end tangent
  let tx = e.x - c.x;
  let ty = e.y - c.y;
  const tl = Math.hypot(tx, ty);
  tx /= tl;
  ty /= tl;
  const H = 4.2; // head length
  const W = 2.4; // head half-width
  const base = { x: e.x - tx * H, y: e.y - ty * H };
  const notch = { x: e.x - tx * H * 0.7, y: e.y - ty * H * 0.7 };
  const p1 = { x: base.x - ty * W, y: base.y + tx * W };
  const p2 = { x: base.x + ty * W, y: base.y - tx * W };
  const f = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  return {
    d: `M${f(s)} Q${f(c)} ${f(notch)}`,
    head: `M${f(e)} L${f(p1)} L${f(notch)} L${f(p2)} Z`,
  };
}

const RuleWheel = memo(function RuleWheel({ spot }) {
  const pos = RING.map((_, i) => {
    const ang = ((-90 + i * 72) * Math.PI) / 180;
    return { x: 50 + 38 * Math.cos(ang), y: 50 + 38 * Math.sin(ang) };
  });
  const at = (id) => pos[RING.indexOf(id)];
  const [sw, sl] = RULES[spot] || [];
  return (
    <div className="rps-wheel">
      <svg viewBox="0 0 100 100" className="rps-wheel-svg" aria-hidden="true">
        <defs>
          {RULES.map(([w, l]) => {
            const a = at(w);
            const b = at(l);
            return (
              <linearGradient
                key={`${w}>${l}`}
                id={`rps-g-${w}-${l}`}
                gradientUnits="userSpaceOnUse"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
              >
                <stop offset="0%" stopColor={FIGHTERS[w].color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={FIGHTERS[w].color} stopOpacity="1" />
              </linearGradient>
            );
          })}
        </defs>
        {RULES.map(([w, l]) => {
          const on = w === sw && l === sl;
          const ar = arrowGeometry(at(w), at(l));
          return (
            <g key={`${w}>${l}`} className={`rps-arrow ${on ? "on" : ""}`}>
              {on && <path d={ar.d} className="rps-arrow-glow" stroke={FIGHTERS[w].color} />}
              <path d={ar.d} className="rps-arrow-shaft" stroke={`url(#rps-g-${w}-${l})`} />
              {on && <path d={ar.d} className="rps-arrow-flow" />}
              <path d={ar.head} className="rps-arrow-head" fill={FIGHTERS[w].color} />
            </g>
          );
        })}
      </svg>
      {RING.map((id, i) => (
        <div
          key={id}
          className={`rps-wheel-node ${id === sw ? "win" : ""} ${id === sl ? "lose" : ""}`}
          style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%`, animationDelay: `${i * 0.35}s` }}
        >
          <img src={IMG(id)} alt="" draggable="false" />
          <span>{FIGHTERS[id].name}</span>
        </div>
      ))}
      {sw && (
        <div className="rps-wheel-center">
          <div className="rps-wheel-caption" key={spot}>
            <b style={{ color: FIGHTERS[sw].color }}>{FIGHTERS[sw].name}</b>
            <span>{VERBS[`${sw}>${sl}`]}</span>
            <b style={{ color: FIGHTERS[sl].color }}>{FIGHTERS[sl].acc}</b>
          </div>
        </div>
      )}
    </div>
  );
});

const RuleList = memo(function RuleList({ spot }) {
  return (
    <ol className="rps-rules">
      {RULES.map(([w, l], i) => (
        <li key={`${w}>${l}`} className={i === spot ? "on" : ""}>
          <img src={IMG(w)} alt="" />
          <span>
            <b style={{ color: FIGHTERS[w].color }}>{FIGHTERS[w].name}</b> {VERBS[`${w}>${l}`]}{" "}
            {FIGHTERS[l].acc}
          </span>
          <img src={IMG(l)} alt="" className="lost" />
        </li>
      ))}
    </ol>
  );
});

// ---------------------------------------------------------------- verdict

const Verdict = memo(function Verdict({ reveal, namesById }) {
  const nm = (id) => namesById[id] || "Гравець";
  const shown = [...new Set(Object.values(reveal.choices))];
  if (reveal.replay && shown.length === 1) {
    return (
      <div className="rps-verdict-box">
        <div className="rps-clash">
          <img src={IMG(shown[0])} alt="" className="rps-clash-img mirror" />
          <span className="rps-vs">=</span>
          <img src={IMG(shown[0])} alt="" className="rps-clash-img" />
        </div>
        <p className="rps-banner">Усі обрали «{FIGHTERS[shown[0]].name}» — ще раз!</p>
      </div>
    );
  }

  if (reveal.winningChoice) {
    const w = reveal.winningChoice;
    const losers = shown.filter((c) => c !== w);
    return (
      <div className="rps-verdict-box">
        <div className="rps-clash">
          <img src={IMG(w)} alt="" className="rps-clash-img winner" />
          <span className="rps-vs">VS</span>
          <div className="rps-clash-losers">
            {losers.map((c, i) => (
              <img
                key={c}
                src={IMG(c)}
                alt=""
                className="rps-clash-img loser"
                style={{ animationDelay: `${0.55 + i * 0.12}s` }}
              />
            ))}
          </div>
        </div>
        <div className="rps-lines">
          {losers.map((c) => (
            <p key={c} className="rps-banner">
              {ruleText(w, c)}!
            </p>
          ))}
        </div>
        <p className="rps-sub">Вилітають: {(reveal.eliminated || []).map(nm).join(", ")}</p>
      </div>
    );
  }

  // the free-for-all: points per choice
  const scores = reveal.scores || {};
  const out = reveal.outChoices || [];
  const sorted = [...shown].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  return (
    <div className="rps-verdict-box">
      <p className="rps-banner">Кругова бійка!</p>
      <div className="rps-scoreboard">
        {sorted.map((c, i) => (
          <div
            key={c}
            className={`rps-score-chip ${out.includes(c) ? "out" : ""}`}
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <img src={IMG(c)} alt="" />
            <b>{(scores[c] ?? 0) > 0 ? `+${scores[c]}` : String(scores[c] ?? 0).replace("-", "−")}</b>
          </div>
        ))}
      </div>
      <div className="rps-lines small">
        {battleLines(reveal.choices).map(([w, l]) => (
          <span key={`${w}>${l}`}>{ruleText(w, l)}</span>
        ))}
      </div>
      {reveal.replay ? (
        <p className="rps-sub">Усі рівні — ще раз!</p>
      ) : (
        <p className="rps-sub">
          Найменше очок — {out.map((c) => FIGHTERS[c].name).join(" і ")}. Вилітають:{" "}
          {(reveal.eliminated || []).map(nm).join(", ")}
        </p>
      )}
    </div>
  );
});

/** The player cards — memoised so the clock tick doesn't repaint them. */
const Arena = memo(function Arena({ ids, reveal, judged, lockedIds, namesById, slotsById }) {
  const locked = new Set(lockedIds || []);
  const out = new Set(judged ? reveal?.eliminated || [] : []);
  const nm = (id) => namesById[id] || "Гравець";
  return (
    <div className={`rps-arena n${Math.min(ids.length, 8)}`}>
      {ids.map((id, i) => {
        const c = reveal?.choices?.[id];
        const state = reveal
          ? judged
            ? out.has(id)
              ? "out"
              : reveal.replay
              ? "tie"
              : "in"
            : ""
          : locked.has(id)
          ? "ready"
          : "thinking";
        return (
          <div key={id} className={`rps-card ${reveal ? "flipped" : ""} ${state}`}>
            <div className="rps-card-inner" style={{ transitionDelay: `${i * 110}ms` }}>
              <div className="rps-card-back">
                <img className="rps-card-sprite" src={SPRITE(slotsById[id])} alt="" />
                <span className="rps-card-q">{locked.has(id) ? "✓" : "?"}</span>
              </div>
              <div className="rps-card-front">
                {c && <img className="rps-card-fighter" src={IMG(c)} alt="" />}
                {c && <span className="rps-card-fname">{FIGHTERS[c].name}</span>}
              </div>
            </div>
            <div className="rps-card-name">{nm(id)}</div>
            {state === "out" && <div className="rps-card-x">✕</div>}
          </div>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------- component

export default function RockPaperScissorsMinigame({
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

  const [go, setGo] = useState(null); // { startAt, offset }
  const [round, setRound] = useState(null); // { round, alive, deadlineAt, choiceMs }
  const [myChoice, setMyChoice] = useState(null);
  const [progress, setProgress] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [judged, setJudged] = useState(false);
  const [lastReveal, setLastReveal] = useState(null);
  const [eliminated, setEliminated] = useState(false);
  const [now, setNow] = useState(() => gameClock.now());
  const sceneDoneRef = useRef(false);
  const beepRef = useRef(null);

  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return;
    const onGo = (d) =>
      setGo({
        startAt: Number(d.startAt),
        offset: Number(d.serverNow ?? gameClock.now()) - gameClock.now(),
      });
    const onRound = (d) => {
      setRound(d);
      setReveal(null);
      setJudged(false);
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
      setLastReveal(d);
      setJudged(false);
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

  // flip first, then the verdict (and the hit sound on the TV)
  useEffect(() => {
    if (!reveal) return;
    if (isDisplay) sfx("/assets/sounds/click-sound.mp3", 0.5);
    let loseTimer = null;
    const t = gameClock.setTimeout(() => {
      setJudged(true);
      const out = reveal.eliminated || [];
      if (myPlayerId && out.includes(myPlayerId)) {
        setEliminated(true);
        playLoseSound();
      }
      if (isDisplay && out.length) {
        sfx("/assets/sounds/knife-slice.mp3", 0.7);
        loseTimer = gameClock.setTimeout(playLoseSound, 380);
      }
      if (isDisplay && reveal.replay) sfx("/assets/sounds/notification.mp3", 0.5);
    }, JUDGE_DELAY_MS);
    return () => {
      gameClock.clearTimeout(t);
      if (loseTimer) gameClock.clearTimeout(loseTimer);
    };
  }, [reveal, isDisplay, myPlayerId]);

  // background music on the TV for the whole minigame (pauses with the game)
  const musicOn = isDisplay && (!!isActive || !!results);
  useEffect(() => {
    if (!musicOn) return;
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
    const id = gameClock.setInterval(() => setNow(gameClock.now()), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!results || results.minigameId !== "rps" || !isDisplay) return;
    sfx("/assets/sounds/bell.mp3", 0.6);
    if (sceneDoneRef.current) return;
    const t = gameClock.setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, 9000);
    return () => gameClock.clearTimeout(t);
  }, [results, isDisplay, onSceneDone]);

  const serverNow = go ? now + go.offset : 0;
  const countdownNum =
    go && !round && serverNow < go.startAt
      ? Math.max(1, Math.ceil((go.startAt - serverNow) / 1000))
      : null;

  // 3-2-1 beeps on the TV
  useEffect(() => {
    if (!isDisplay || countdownNum == null || countdownNum > 3) return;
    if (beepRef.current === countdownNum) return;
    beepRef.current = countdownNum;
    sfx("/assets/sounds/beep.mp3", 0.5);
  }, [isDisplay, countdownNum]);

  const msLeft = round?.deadlineAt ? Math.max(0, round.deadlineAt - serverNow) : 0;
  const choiceSecsLeft = round?.deadlineAt ? Math.ceil(msLeft / 1000) : null;
  const timeFrac = round?.choiceMs ? Math.min(1, msLeft / round.choiceMs) : 0;
  const spot = Math.floor(now / RULE_SPOTLIGHT_MS) % RULES.length;

  const choose = (id) => {
    if (myChoice || eliminated || reveal) return;
    setMyChoice(id); // optimistic
    sfx("/assets/sounds/click-sound.mp3", 0.5);
    socket?.emit("minigameEvent", { name: "rps:choose", data: { choice: id } });
  };

  const nm = (id) => namesById[id] || "Гравець";
  const cls = isDisplay ? "rps-display" : "rps-mobile";
  // ---------------------------------------------------------------- end screen
  if (results && results.minigameId === "rps") {
    const winner = results.winnerId;
    const loser = results.lifeLoserId;
    const lastRound = (results.rounds || []).slice(-1)[0] || lastReveal;
    const winnerChoice = lastRound?.choices?.[winner];
    const loserChoice = lastRound?.choices?.[loser];
    return (
      <section className={`rps-root ${cls} rps-end-screen`}>
        <div className="rps-bg-glow" />
        <Title />
        <div className="rps-end">
          {winner && (
            <div className="rps-end-card win">
              <div className="rps-crown">👑</div>
              <img className="rps-end-sprite" src={SPRITE(slotsById[winner])} alt="" />
              {winnerChoice && <img className="rps-end-fighter" src={IMG(winnerChoice)} alt="" />}
              <p className="rps-end-name">{nm(winner)}</p>
              <p className="rps-end-tag">переможець · +10 балів</p>
            </div>
          )}
          {loser && (
            <div className="rps-end-card lose">
              <img className="rps-end-sprite" src={SPRITE(slotsById[loser])} alt="" />
              {loserChoice && <img className="rps-end-fighter" src={IMG(loserChoice)} alt="" />}
              <p className="rps-end-name">{nm(loser)}</p>
              <p className="rps-end-tag">вилітає останнім · −1 життя</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- not active
  if (!isActive || !go) {
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-bg-glow" />
        <Title />
        <div className="rps-parade">
          {BUTTON_ORDER.map((id, i) => (
            <img key={id} src={IMG(id)} alt="" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
        <div className="rps-wait">{isDisplay ? "Приготуйтесь до бійки…" : "Дивіться на головний екран"}</div>
      </section>
    );
  }

  // ------------------------------------------------ rules + 3-2-1 countdown
  if (countdownNum != null) {
    return (
      <section className={`rps-root ${cls} rps-prep`}>
        <div className="rps-bg-glow" />
        <Title small={!isDisplay} />
        <div className="rps-prep-grid">
          {isDisplay && <RuleWheel spot={spot} />}
          <div className="rps-prep-side">
            <RuleList spot={spot} />
            <ul className="rps-group-rules">
              <li>Кожен б'є двох і програє двом.</li>
              <li>Один вибір б'є всіх інших — далі йде тільки він.</li>
              <li>
                Кругова бійка: <b>+1</b> за кожного, кого б'єш, <b>−1</b> за кожного, хто б'є тебе.
                Найменше очок — вибуває.
              </li>
              <li>
                Хто вилетить <b>останнім</b> — втрачає життя.
              </li>
            </ul>
          </div>
        </div>
        {countdownNum <= 3 ? (
          <div className="rps-countdown" key={countdownNum}>
            {countdownNum}
          </div>
        ) : (
          <div className="rps-getready">Бійка почнеться за {countdownNum}…</div>
        )}
      </section>
    );
  }

  const timerRing = choiceSecsLeft != null && !reveal && (
    <div className={`rps-timer ${choiceSecsLeft <= 3 ? "hot" : ""}`}>
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="17" className="track" />
        <circle
          cx="20"
          cy="20"
          r="17"
          className="bar"
          strokeDasharray={`${2 * Math.PI * 17}`}
          strokeDashoffset={`${2 * Math.PI * 17 * (1 - timeFrac)}`}
        />
      </svg>
      <span>{choiceSecsLeft}</span>
    </div>
  );

  // ---------------------------------------------------------------- display
  if (isDisplay) {
    const alive = round?.alive || [];
    const ids = reveal ? Object.keys(reveal.choices) : alive;
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-bg-glow" />
        <div className="rps-topbar">
          <Title small />
          <div className="rps-round-pill">Раунд {round?.round}</div>
          {timerRing}
        </div>
        <Arena
          ids={ids}
          reveal={reveal}
          judged={judged}
          lockedIds={progress?.lockedIds}
          namesById={namesById}
          slotsById={slotsById}
        />
        <div className="rps-bottom">
          {reveal ? (
            judged ? (
              <Verdict reveal={reveal} namesById={namesById} />
            ) : (
              <p className="rps-banner pulse">Розкриваємо…</p>
            )
          ) : (
            <p className="rps-status-line">
              Обирайте на телефонах! {progress ? `${progress.submitted} / ${progress.total} готові` : ""}
            </p>
          )}
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- mobile
  if (!amContestant) {
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-bg-glow" />
        <Title small />
        <p className="rps-wait">
          Твоя відповідь правильна — ця бійка серед тих, хто помилився. Дивись на екран!
        </p>
      </section>
    );
  }

  if (reveal) {
    const mine = reveal.choices?.[myPlayerId];
    const imOut = judged && (reveal.eliminated || []).includes(myPlayerId);
    const imIn = judged && !imOut && mine && !reveal.replay;
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-bg-glow" />
        {mine ? (
          <>
            <img
              className={`rps-mine ${imOut ? "out" : ""} ${imIn ? "in" : ""}`}
              src={IMG(mine)}
              alt=""
            />
            <p className="rps-mine-name">{FIGHTERS[mine].name}</p>
          </>
        ) : (
          <p className="rps-wait">Ти вже поза грою — дивись на екран</p>
        )}
        {judged && mine && (
          <>
            {imOut && <p className="rps-status rps-status-out">ТИ ВИБУВАЄШ</p>}
            {imIn && <p className="rps-status rps-status-in">ТИ ЙДЕШ ДАЛІ!</p>}
            {reveal.replay && <p className="rps-status rps-status-tie">НІЧИЯ — ЩЕ РАЗ</p>}
            <div className="rps-lines small">
              {battleLines(reveal.choices)
                .filter(([w, l]) => w === mine || l === mine)
                .map(([w, l]) => (
                  <span key={`${w}>${l}`} className={w === mine ? "good" : "bad"}>
                    {ruleText(w, l)}
                  </span>
                ))}
            </div>
          </>
        )}
      </section>
    );
  }

  if (eliminated) {
    return (
      <section className={`rps-root ${cls}`}>
        <div className="rps-bg-glow" />
        <p className="rps-status rps-status-out">ТИ ПОЗА ГРОЮ</p>
        <p className="rps-wait">Дивись на головний екран</p>
      </section>
    );
  }

  return (
    <section className={`rps-root ${cls} rps-pick`}>
      <div className="rps-bg-glow" />
      <div className="rps-mobile-top">
        <span className="rps-round-pill">Раунд {round?.round}</span>
        {timerRing}
      </div>
      {myChoice ? (
        <div className="rps-locked">
          <img className="rps-mine in" src={IMG(myChoice)} alt="" />
          <p className="rps-mine-name">{FIGHTERS[myChoice].name}</p>
          <p className="rps-wait">
            Вибір зроблено. Чекаємо на інших…
            {progress ? ` ${progress.submitted}/${progress.total}` : ""}
          </p>
        </div>
      ) : (
        <>
          <p className="rps-pick-title">Обери бійця!</p>
          <div className="rps-choices">
            {BUTTON_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`rps-choice c-${id}`}
                style={{ "--c": FIGHTERS[id].color }}
                onClick={() => choose(id)}
              >
                <img src={IMG(id)} alt="" draggable="false" />
                <span className="rps-choice-label">{FIGHTERS[id].name}</span>
                <span className="rps-choice-beats">
                  б'є: {BEATS[id].map((b) => FIGHTERS[b].acc).join(", ")}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
