import { useEffect, useMemo, useRef, useState } from "react";
import "./RatMinigame.css";
import gameClock from "../game/gameClock";

/**
 * «Серед нас: КРИСА» (id: rat) — a secret vote over a phone charger.
 * Server-authoritative (server/minigames/rat.js): the server owns the clock,
 * keeps the votes secret and decides the outcome once. This component only
 * renders and forwards the player's own choice.
 *
 * Events in:  rat:go { voteStartAt, voteEndAt, serverNow, total }
 *             rat:progress { voted, total }       (how many decided — never what)
 *             rat:ack { choice }                  (the own locked vote, to this phone only)
 * Event out:  minigameEvent rat:vote { choice: "steal" | "keep" }, rat:hello (page reopened)
 * Results:    results.rat { scenario, total, steal, keep, stealIds, keepIds, abstainIds, winnerIds }
 *
 * TV: a classroom after school (web/classroom.webp) with the charger
 * (web/charger.webp) on the front desk, a chalkboard and an alarm clock drawn
 * in CSS/SVG. The screen is split into zones that never overlap: the board on
 * top, the charger (and its animation) in the middle, the cork boards with the
 * players on the sides during the reveal, the verdict at the bottom.
 *
 * Reveal: "Час вийшов…" -> the counts -> polaroids of every player get pinned
 * to two cork boards one by one -> the verdict with its own animation.
 */

const DIR = "/assets/minigames/rat";
const ROOM_BG = `${DIR}/web/classroom.webp`;
const CHARGER = `${DIR}/web/charger.webp`;
const MUSIC = `${DIR}/background.mp3`;
const MUSIC_VOLUME = 1; // level set by game/loudness.js
// the k-th decision plays k.mp3 — the same sound whatever was chosen, so nothing leaks
const DECISION_SOUND = (k) => `${DIR}/${((k - 1) % 8) + 1}.mp3`;
const DECISION_VOLUME = 0.32; // decisions are a background cue, quieter than the music
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/sounds/lose/${n}.mp3`);
const SPRITE = (slot) => `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const TICK_MS = 200;

// reveal timeline (ms after the results arrive)
const REVEAL = { COUNTS: 2800, CARDS: 4800, CARD_STEP: 450, VERDICT_PAUSE: 700, HOLD: 8000 };
const verdictAt = (total) => REVEAL.CARDS + total * REVEAL.CARD_STEP + REVEAL.VERDICT_PAUSE;

const HOST_LINES = [
  "Тридцять секунд на совість. Або на хитрість…",
  "Одна зарядка. Хто наважиться її підмутити?",
  "Хтось уже тягне лапку до кабелю…",
  "Думаєте, вам можна довіряти?",
  "Двоє крис — і обидві попадуться!",
  "Не чіпати — теж рішення. Сміливе чи наївне?",
  "Я нікому не скажу… до дзвінка.",
  "Батарейка 1%… а зарядка он, на парті…",
];

const VERDICT = {
  trust: { text: "Ви довірилися одне одному. Сьогодні всі молодці!", board: "Всі молодці! 12 балів ★", tone: "good" },
  rat: {
    text: (name) => `ЗНАЙШЛАСЯ КРИСА! ${name} забирає перемогу. Решта — мінус життя!`,
    board: (name) => `Зарядки немає! Криса — ${name}`,
    tone: "rat",
  },
  manyRats: { text: "Попались, криси! Хто мутив — мінус життя. Чесні — в безпеці!", board: "Крис спіймали на гарячому!", tone: "caught" },
  allRats: { text: "Ви всі вирішили бути хитрими. І всі програли! Оце ви команда!", board: "Самі криси. Батьків — до школи!", tone: "bad" },
};

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

// ---------------------------------------------------------------- drawn props

/** A real-looking chalkboard: wooden frame, chalk tray, an eraser that wipes on every change. */
function Chalkboard({ boardKey, children, small }) {
  return (
    <div className={`rat-chalkboard ${small ? "small" : ""}`}>
      <div className="rat-slate">
        <div className="rat-slate-content" key={boardKey}>
          {children}
        </div>
        <span className="rat-eraser-wipe" key={`w${boardKey}`} />
      </div>
      <div className="rat-tray">
        <i className="chalk c1" />
        <i className="chalk c2" />
        <i className="chalk c3" />
        <i className="eraser" />
      </div>
    </div>
  );
}

/**
 * A real alarm clock = the vote timer. It reads 11:59:30 when the vote opens
 * and runs to 12:00 — the bell. The second hand ticks 6° a second, the minute
 * and hour hands creep, the red sector is the time left before the bell.
 */
function AlarmClock({ msLeft, totalMs, done }) {
  const total = Math.max(1000, totalMs || 30000);
  const elapsed = Math.max(0, Math.min(total, total - msLeft));
  const secs = Math.ceil(msLeft / 1000);
  const hot = !done && secs <= 5;
  const startSec = 60 - total / 1000; // 30 s before the bell -> 11:59:30
  const secTick = startSec + Math.floor(elapsed / 1000); // ticks once a second
  const secAngle = done ? 360 : secTick * 6;
  const minuteAngle = (59 + (startSec + elapsed / 1000) / 60) * 6;
  const hourAngle = (11 + (59 + (startSec + elapsed / 1000) / 60) / 60) * 30;
  // red sector from the second hand to 12 (what is left)
  const R = 38;
  const polar = (deg) => [60 + R * Math.sin((deg * Math.PI) / 180), 72 - R * Math.cos((deg * Math.PI) / 180)];
  const [sx, sy] = polar(secAngle);
  const left = 360 - secAngle;
  const sector = !done && left > 0.5 ? `M60 72 L${sx.toFixed(2)} ${sy.toFixed(2)} A${R} ${R} 0 ${left > 180 ? 1 : 0} 1 60 ${72 - R} Z` : null;
  return (
    <div className={`rat-alarm ${hot ? "hot" : ""} ${done ? "done" : ""}`}>
      <svg viewBox="0 0 120 132" aria-hidden="true">
        <defs>
          <radialGradient id="ratFace" cx="0.45" cy="0.4" r="0.7">
            <stop offset="0" stopColor="#fffdf6" />
            <stop offset="1" stopColor="#efe6d2" />
          </radialGradient>
          <linearGradient id="ratBell" x1="0" x2="1">
            <stop offset="0" stopColor="#f6d77a" />
            <stop offset="1" stopColor="#b8862b" />
          </linearGradient>
          <linearGradient id="ratCase" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ef5a5a" />
            <stop offset="1" stopColor="#9e1d1d" />
          </linearGradient>
        </defs>
        {/* bells + hammer */}
        <g className="bells">
          <path d="M14 34 a22 22 0 0 1 34 -22 z" fill="url(#ratBell)" stroke="#6b5313" strokeWidth="2" />
          <path d="M106 34 a22 22 0 0 0 -34 -22 z" fill="url(#ratBell)" stroke="#6b5313" strokeWidth="2" />
          <rect x="56.5" y="8" width="7" height="10" rx="2" fill="#6b5313" />
          <line className="hammer" x1="60" y1="18" x2="60" y2="6" stroke="#6b5313" strokeWidth="3" strokeLinecap="round" />
        </g>
        {/* legs */}
        <path d="M30 114 l-10 15" stroke="#2b2b33" strokeWidth="6" strokeLinecap="round" />
        <path d="M90 114 l10 15" stroke="#2b2b33" strokeWidth="6" strokeLinecap="round" />
        {/* case + face */}
        <circle cx="60" cy="72" r="52" fill="url(#ratCase)" stroke="#6a1010" strokeWidth="2.5" />
        <circle cx="60" cy="72" r="45" fill="url(#ratFace)" stroke="#7a1414" strokeWidth="1.5" />
        {sector && <path d={sector} fill="rgba(232, 69, 90, 0.28)" />}
        {/* minute ticks + hour marks */}
        {Array.from({ length: 60 }, (_, i) => (
          <line
            key={i}
            x1="60"
            y1="29"
            x2="60"
            y2={i % 5 === 0 ? 35 : 31.5}
            stroke="#2b2b33"
            strokeWidth={i % 5 === 0 ? 2.2 : 0.8}
            transform={`rotate(${i * 6} 60 72)`}
          />
        ))}
        {[
          ["12", 60, 43],
          ["3", 92, 76],
          ["6", 60, 108],
          ["9", 28, 76],
        ].map(([t, x, y]) => (
          <text key={t} x={x} y={y} textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="Manrope, sans-serif" fill="#2b2b33">
            {t}
          </text>
        ))}
        {/* hands */}
        <line x1="60" y1="72" x2="60" y2="50" stroke="#2b2b33" strokeWidth="4" strokeLinecap="round" transform={`rotate(${hourAngle} 60 72)`} />
        <line x1="60" y1="72" x2="60" y2="38" stroke="#2b2b33" strokeWidth="2.6" strokeLinecap="round" transform={`rotate(${minuteAngle} 60 72)`} />
        <g className="sec" style={{ transform: `rotate(${secAngle}deg)` }}>
          <line x1="60" y1="80" x2="60" y2="32" stroke="#d0102e" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="60" cy="80" r="2.4" fill="#d0102e" />
        </g>
        <circle cx="60" cy="72" r="3.2" fill="#2b2b33" />
        <circle cx="60" cy="72" r="1.3" fill="#d0102e" />
        {/* glass glare */}
        <path d="M30 52 a36 36 0 0 1 40 -22" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <b key={hot ? secs : "t"}>{done ? "ДЗВІНОК!" : secs}</b>
    </div>
  );
}

/** The charger on the desk + what happens to it. `prize`: idle | kept | stolen | caught | broken */
function DeskScene({ prize = "idle", rats = 0 }) {
  return (
    <div className="rat-desk" aria-hidden="true">
      <div className={`rat-charger-spot ${prize}`}>
        <span className="rat-charger-glow" />
        {prize !== "stolen" && <img className="rat-charger" src={CHARGER} alt="" />}
        {prize === "stolen" && (
          <>
            <img className="rat-charger carried" src={CHARGER} alt="" />
            <img className="rat-charger ghost" src={CHARGER} alt="" />
            <span className="rat-missing q1">?</span>
            <span className="rat-missing q2">?</span>
            <span className="rat-missing q3">?</span>
            <div className="rat-note">
              ЗАРЯДКИ
              <br />
              НЕМАЄ!
              <small>— криса 🐾</small>
            </div>
          </>
        )}
        {prize === "kept" && (
          <>
            <i className="rat-sparkle s1">✨</i>
            <i className="rat-sparkle s2">⭐</i>
            <i className="rat-sparkle s3">✨</i>
            <i className="rat-sparkle s4">💚</i>
          </>
        )}
        {prize === "broken" && (
          <>
            <i className="rat-smoke m1">💨</i>
            <i className="rat-smoke m2">⚡</i>
            <i className="rat-smoke m3">💨</i>
          </>
        )}
      </div>
      {prize === "stolen" && <span className="rat-thief">🐀</span>}
      {(prize === "caught" || prize === "broken") &&
        Array.from({ length: rats }, (_, i) => (
          <span key={i} className={`rat-runner ${i % 2 ? "r" : "l"}`} style={{ "--i": i }}>
            🐀
          </span>
        ))}
      {prize === "broken" && (
        <div className="rat-fight">
          <span>💥</span>
          <span>⭐</span>
          <span>💢</span>
          <span>🌀</span>
        </div>
      )}
      {prize === "caught" && <div className="rat-stamp">ПОПАЛИСЬ!</div>}
      {prize === "kept" && (
        <div className="rat-confetti">
          {Array.from({ length: 26 }, (_, i) => (
            <i key={i} style={{ "--x": `${(i * 41) % 100}%`, "--d": `${(i % 9) * 0.18}s`, "--c": ["#5fe08c", "#ffd36b", "#7dfcff", "#ff9aae"][i % 4] }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Classroom background with light, dust and the occasional paper plane / peeking rat. */
function Classroom({ tense, children }) {
  return (
    <>
      <div className={`rat-class ${tense ? "tense" : ""}`} style={{ backgroundImage: `url(${ROOM_BG})` }} aria-hidden="true">
        <span className="rat-sunbeam" />
        <span className="rat-lampglow" />
        <div className="rat-dust">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ "--x": `${(i * 37) % 100}%`, "--d": `${-i * 1.7}s`, "--t": `${9 + (i % 5) * 2}s` }} />
          ))}
        </div>
        <span className="rat-plane" />
        <span className="rat-peek">🐀</span>
      </div>
      {children}
    </>
  );
}

function Title({ small }) {
  return (
    <header className={`rat-head ${small ? "small" : ""}`}>
      <p className="rat-kicker">СЕРЕД НАС</p>
      <h2 className="rat-title">
        КРИСА <span aria-hidden="true">🐀</span>
      </h2>
    </header>
  );
}

function Lives({ n }) {
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return <p className="rat-lives dead">💀 Життів не лишилось — тепер ти привид</p>;
  return (
    <div className="rat-lives">
      <span>Залишилось життів</span>
      <b>{"❤".repeat(Math.min(10, n))}</b>
    </div>
  );
}

const RulesList = () => (
  <ul className="rat-rulelist">
    <li>
      <i>✋✋✋</i>
      <span>
        Ніхто не підмутив — <u className="good">ніхто не програє</u>
      </span>
    </li>
    <li>
      <i>🐀✋✋</i>
      <span>
        Рівно один підмутив — <u className="rat">він виграє</u>, решта −1 ❤
      </span>
    </li>
    <li>
      <i>🐀🐀✋</i>
      <span>
        Кілька крис — <u className="bad">криси −1 ❤</u>, решта в безпеці
      </span>
    </li>
    <li>
      <i>🐀🐀🐀</i>
      <span>
        Підмутили всі — <u className="bad">усі −1 ❤</u>
      </span>
    </li>
  </ul>
);

// ---------------------------------------------------------------- component

export default function RatMinigame({
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
  const [go, setGo] = useState(null); // { voteStartAt, voteEndAt, offset, total }
  const [progress, setProgress] = useState({ voted: 0, total: 0 });
  const [myVote, setMyVote] = useState(null); // locked choice (server ack)
  const [picked, setPicked] = useState(null); // selected, not confirmed yet
  const [, setTick] = useState(0);
  const revealT0 = useRef(null);
  const sceneDoneRef = useRef(false);
  const beepRef = useRef(null);
  const soundRef = useRef({});
  const heardVotes = useRef(0);

  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return;
    const onGo = (d) => {
      if (!d || !Number.isFinite(Number(d.voteStartAt))) return;
      setGo({
        voteStartAt: Number(d.voteStartAt),
        voteEndAt: Number(d.voteEndAt),
        offset: Number(d.serverNow ?? gameClock.now()) - gameClock.now(),
        total: Number(d.total) || 0,
      });
    };
    const onProgress = (d) => setProgress({ voted: Number(d?.voted) || 0, total: Number(d?.total) || 0 });
    const onAck = (d) => {
      if (d?.choice) setMyVote(d.choice);
    };
    socket.on("rat:go", onGo);
    socket.on("rat:progress", onProgress);
    socket.on("rat:ack", onAck);
    return () => {
      socket.off("rat:go", onGo);
      socket.off("rat:progress", onProgress);
      socket.off("rat:ack", onAck);
    };
  }, [socket]);

  // a phone that (re)opened mid-game asks for the clock and its own locked vote
  const amContestant = contestantIds.includes(myPlayerId);
  useEffect(() => {
    if (isDisplay || !isActive || !socket || !amContestant) return;
    socket.emit("minigameEvent", { name: "rat:hello", data: {} });
  }, [isDisplay, isActive, socket, amContestant]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  const isResults = !!results && results.minigameId === "rat" && !!results.rat;
  if (isResults && revealT0.current == null) revealT0.current = gameClock.now();
  const sinceReveal = isResults ? gameClock.now() - revealT0.current : 0;

  const serverNow = go ? gameClock.now() + go.offset : 0;
  const beforeVote = !!go && serverNow < go.voteStartAt;
  const voting = !!go && serverNow >= go.voteStartAt && serverNow < go.voteEndAt;
  const msLeft = go ? Math.max(0, go.voteEndAt - serverNow) : 0;
  const countdownNum = beforeVote ? Math.max(1, Math.ceil((go.voteStartAt - serverNow) / 1000)) : null;
  const total = go?.total || progress.total || contestantIds.length;
  const secsLeft = Math.ceil(msLeft / 1000);

  // TV: music for the whole minigame
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

  // TV sounds: 3-2-1, the vote opens, the last 5 seconds tick
  const beepKey =
    countdownNum != null && countdownNum <= 3 ? `c${countdownNum}` : voting ? (secsLeft <= 5 ? `e${secsLeft}` : "open") : null;
  useEffect(() => {
    if (!isDisplay || !beepKey || beepRef.current === beepKey) return;
    beepRef.current = beepKey;
    sfx(beepKey === "open" ? "/assets/sounds/bell.mp3" : "/assets/sounds/beep.mp3", 0.45);
  }, [isDisplay, beepKey]);

  // TV: a sound for every new decision (counted, never what was chosen)
  useEffect(() => {
    if (!isDisplay) return;
    while (heardVotes.current < progress.voted) {
      heardVotes.current += 1;
      sfx(DECISION_SOUND(heardVotes.current), DECISION_VOLUME);
    }
  }, [isDisplay, progress.voted]);

  // reveal sounds + scene end
  const outcome = isResults ? results.rat : null;
  const vAt = outcome ? verdictAt(outcome.total) : 0;
  const stage = !outcome ? null : sinceReveal < REVEAL.COUNTS ? 0 : sinceReveal < REVEAL.CARDS ? 1 : sinceReveal < vAt ? 2 : 3;
  const amLoser = isResults && (results.loserIds || []).includes(myPlayerId);
  useEffect(() => {
    if (stage == null || soundRef.current[stage]) return;
    soundRef.current[stage] = true;
    if (isDisplay) {
      if (stage === 0) sfx("/assets/sounds/bell.mp3", 0.5);
      if (stage === 3) {
        if (outcome.scenario === "trust") sfx("/assets/sounds/win.mp3", 0.45);
        else {
          sfx("/assets/sounds/result.mp3", 0.5);
          gameClock.setTimeout(() => sfx(randomLoseSound(), 0.8), 1400);
        }
      }
    } else if (stage === 3 && amLoser) {
      sfx(randomLoseSound(), 0.8);
    }
  }, [stage, isDisplay, outcome, amLoser]);
  useEffect(() => {
    if (!isResults || !isDisplay || sceneDoneRef.current) return;
    const t = gameClock.setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, verdictAt(results.rat.total) + REVEAL.HOLD);
    return () => gameClock.clearTimeout(t);
  }, [isResults, isDisplay, onSceneDone, results]);

  const hostIdx = Math.floor((serverNow || gameClock.now()) / 5000) % HOST_LINES.length;
  const nm = (id) => namesById[id] || "Гравець";
  const cls = `rat-root ${isDisplay ? "rat-display" : "rat-mobile"}`;

  const vote = () => {
    if (!picked || myVote || !voting) return;
    socket?.emit("minigameEvent", { name: "rat:vote", data: { choice: picked } });
  };

  // polaroids for the reveal: the ones who kept first, the rats last (suspense)
  const revealOrder = useMemo(() => {
    if (!outcome) return [];
    return [...outcome.keepIds.map((id) => ({ id, side: "keep" })), ...outcome.stealIds.map((id) => ({ id, side: "steal" }))];
  }, [outcome]);

  const lineup = (tense) => (
    <div className={`rat-lineup ${tense ? "tense" : ""}`}>
      {contestantIds.map((id, i) => (
        <div key={id} className="rat-student" style={{ "--i": i }}>
          {tense && <i className="rat-sweat">💦</i>}
          <img src={SPRITE(slotsById[id])} alt="" />
          <span>{nm(id)}</span>
        </div>
      ))}
    </div>
  );

  // ================================================================== results
  if (isResults) {
    const o = outcome;
    const ratName = o.scenario === "rat" ? nm(o.stealIds[0]) : "";
    const verdictText = o.scenario === "rat" ? VERDICT.rat.text(ratName) : VERDICT[o.scenario].text;
    const boardText = o.scenario === "rat" ? VERDICT.rat.board(ratName) : VERDICT[o.scenario].board;
    const prizeState =
      stage < 3 ? "idle" : { trust: "kept", rat: "stolen", manyRats: "caught", allRats: "broken" }[o.scenario];

    if (!isDisplay) {
      const mine = o.stealIds.includes(myPlayerId) ? "steal" : o.keepIds.includes(myPlayerId) ? "keep" : null;
      const won = o.winnerIds.includes(myPlayerId);
      const livesBefore = Number(results.livesById?.[myPlayerId]);
      const bg = <div className="rat-phone-bg" style={{ backgroundImage: `url(${ROOM_BG})` }} />;
      if (!mine || stage < 3) {
        return (
          <section className={cls}>
            {bg}
            <div className="rat-phone-board">
              <Title small />
            </div>
            <img className="rat-phone-charger" src={CHARGER} alt="" />
            <p className="rat-big">{mine ? "Час вийшов" : "Дивись на екран"}</p>
            <p className="rat-muted">{stage < 3 ? "Подивимось, хто тут КРИСА… Дивись на головний екран" : verdictText}</p>
          </section>
        );
      }
      const headline = won
        ? o.scenario === "rat"
          ? "ТИ — КРИСА, І ТИ ВИГРАВ!"
          : o.scenario === "manyRats"
            ? "ТИ ЧЕСНИЙ — ТИ В БЕЗПЕЦІ!"
            : "КОМАНДНА ПЕРЕМОГА!"
        : o.scenario === "manyRats"
          ? "ТЕБЕ СПІЙМАЛИ!"
          : "ТИ ПРОГРАВ";
      return (
        <section className={`${cls} ${won ? "won" : "lost"}`}>
          {bg}
          <div className="rat-phone-board">
            <Title small />
          </div>
          <p className={`rat-big ${won ? "good" : "bad"}`}>{headline}</p>
          <p className="rat-muted">{verdictText}</p>
          <p className="rat-mychoice">
            Твій вибір:{" "}
            <b className={mine}>{mine === "steal" ? "🐀 ПІДМУТИТИ" : o.abstainIds.includes(myPlayerId) ? "⏳ не встиг (НЕ ЧІПАТИ)" : "✋ НЕ ЧІПАТИ"}</b>
          </p>
          {!won && (
            <>
              <p className="rat-life">−1 ❤</p>
              {/* the server takes the life only after this scene, so count it in here */}
              <Lives n={livesBefore - 1} />
            </>
          )}
          <p className="rat-counts">
            🐀 {o.steal} · ✋ {o.keep}
          </p>
        </section>
      );
    }

    // TV reveal
    const shown = stage < 2 ? 0 : Math.min(revealOrder.length, Math.floor((sinceReveal - REVEAL.CARDS) / REVEAL.CARD_STEP) + 1);
    const visible = revealOrder.slice(0, shown);
    const column = (side) =>
      visible
        .filter((c) => c.side === side)
        .map((c, i) => {
          const lost = stage === 3 && (results.loserIds || []).includes(c.id);
          const won = stage === 3 && o.scenario === "rat" && o.winnerIds.includes(c.id); // a crown only for the lone rat
          return (
            <div key={c.id} className={`rat-polaroid ${side} ${lost ? "lost" : ""} ${won ? "won" : ""}`} style={{ "--r": `${((i * 7) % 11) - 5}deg` }}>
              <span className="pin" />
              {won && <span className="rat-crown">👑</span>}
              <img src={SPRITE(slotsById[c.id])} alt="" />
              <b>{nm(c.id)}</b>
              {o.abstainIds.includes(c.id) && <i>проспав ⏳</i>}
              {lost && <em>−1 ❤</em>}
            </div>
          );
        });
    return (
      <section className={`${cls} rat-reveal stage-${stage} ${o.scenario}`}>
        <Classroom tense={stage === 0}>
          <DeskScene prize={prizeState} rats={Math.min(6, Math.max(2, o.steal))} />
        </Classroom>
        <Chalkboard boardKey={`r${stage}`}>
          {stage === 0 && (
            <>
              <b className="big">Час вийшов!</b>
              <span>Подивимось, хто тут КРИСА…</span>
            </>
          )}
          {(stage === 1 || stage === 2) && (
            <>
              <span className="tally">
                🐀 Підмутили: <b>{o.steal}</b>
              </span>
              <span className="tally">
                ✋ Не чіпали: <b>{o.keep}</b>
              </span>
              {o.abstainIds.length > 0 && <small>(з них проспали: {o.abstainIds.length})</small>}
            </>
          )}
          {stage === 3 && <b className={`big verdict ${o.scenario}`}>{boardText}</b>}
        </Chalkboard>
        {stage >= 1 && (
          <>
            <div className="rat-cork keep">
              <h3>
                ✋ НЕ ЧІПАЛИ <span>{o.keep}</span>
              </h3>
              <div className="rat-cork-cards">{column("keep")}</div>
              {stage >= 2 && o.keep === 0 && <p className="rat-cork-empty">Нікого 🙈</p>}
            </div>
            <div className="rat-cork steal">
              <h3>
                🐀 ПІДМУТИЛИ <span>{o.steal}</span>
              </h3>
              <div className="rat-cork-cards">{column("steal")}</div>
              {stage >= 2 && o.steal === 0 && <p className="rat-cork-empty">Нікого 😇</p>}
            </div>
          </>
        )}
        {stage === 3 && <div className={`rat-verdict ${VERDICT[o.scenario].tone}`}>{verdictText}</div>}
      </section>
    );
  }

  // ================================================================== phone
  if (!isDisplay) {
    const bg = <div className="rat-phone-bg" style={{ backgroundImage: `url(${ROOM_BG})` }} />;
    const board = (
      <div className="rat-phone-board">
        <Title small />
      </div>
    );
    if (!amContestant) {
      return (
        <section className={cls}>
          {bg}
          {board}
          <img className="rat-phone-charger" src={CHARGER} alt="" />
          <p className="rat-muted">Ти відповів правильно — цього разу ти лише глядач. Дивись на головний екран!</p>
        </section>
      );
    }
    if (!isActive || !go) {
      return (
        <section className={cls}>
          {bg}
          {board}
          <img className="rat-phone-charger" src={CHARGER} alt="" />
          <p className="rat-muted">Дивись на головний екран</p>
        </section>
      );
    }
    if (beforeVote) {
      return (
        <section className={`${cls} rat-phone-prep`}>
          {bg}
          {board}
          <img className="rat-phone-charger" src={CHARGER} alt="" />
          <div className="rat-phone-rules">
            <RulesList />
          </div>
          <p className="rat-muted">Голосування за {countdownNum}…</p>
          {countdownNum <= 3 && (
            <div className="rat-countdown" key={countdownNum}>
              {countdownNum}
            </div>
          )}
        </section>
      );
    }
    const timer = (
      <div className="rat-phone-top">
        <span className={`rat-phone-time ${secsLeft <= 5 ? "hot" : ""}`}>⏰ {voting ? secsLeft : 0}</span>
        <span className="rat-phone-total">Учасників: {total}</span>
      </div>
    );
    if (myVote) {
      return (
        <section className={`${cls} rat-locked`}>
          {bg}
          {timer}
          {board}
          <div className="rat-lock-card">
            <span className="rat-lock-icon">🔒</span>
            <b>Твій вибір зафіксовано</b>
            <span className={`rat-lock-choice ${myVote}`}>{myVote === "steal" ? "🐀 ПІДМУТИТИ" : "✋ НЕ ЧІПАТИ"}</span>
            <small>Змінити вже не можна</small>
          </div>
          <p className="rat-muted">{voting ? "Очікуємо на рішення інших…" : "Голосування завершено. Дивись на головний екран!"}</p>
        </section>
      );
    }
    if (!voting) {
      return (
        <section className={cls}>
          {bg}
          {timer}
          {board}
          <p className="rat-big">Час вийшов</p>
          <p className="rat-muted">Ти не встиг — це зараховано як «НЕ ЧІПАТИ».</p>
        </section>
      );
    }
    return (
      <section className={`${cls} rat-vote`}>
        {bg}
        {timer}
        {board}
        <p className="rat-pitch">Підмути й виграй сам — або не чіпай і виграйте разом.</p>
        <div className="rat-choices">
          <button type="button" className={`rat-choice steal ${picked === "steal" ? "picked" : ""}`} onClick={() => setPicked("steal")}>
            <span className="rat-choice-icon">🐀</span>
            <b>
              ПІДМУТИТИ
              <br />
              ЗАРЯДКУ
            </b>
            <small>Ризикнути заради себе</small>
          </button>
          <button type="button" className={`rat-choice keep ${picked === "keep" ? "picked" : ""}`} onClick={() => setPicked("keep")}>
            <span className="rat-choice-icon">✋</span>
            <b>
              НЕ
              <br />
              ЧІПАТИ
            </b>
            <small>Довіритися іншим</small>
          </button>
        </div>
        <button type="button" className={`rat-confirm ${picked || ""}`} disabled={!picked} onClick={vote}>
          {picked ? "ПІДТВЕРДИТИ ВИБІР" : "Обери варіант"}
        </button>
      </section>
    );
  }

  // ================================================================== TV
  if (!isActive || !go) {
    return (
      <section className={cls}>
        <Classroom>
          <DeskScene />
        </Classroom>
        <Chalkboard boardKey="wait">
          <b className="big">СЕРЕД НАС: КРИСА 🐀</b>
          <span>Урок довіри починається…</span>
        </Chalkboard>
      </section>
    );
  }

  if (beforeVote) {
    return (
      <section className={`${cls} rat-prep`}>
        <Classroom>
          <DeskScene />
        </Classroom>
        <Chalkboard boardKey="rules">
          <b className="title">СЕРЕД НАС: КРИСА 🐀</b>
          <span className="howto">
            На парті — зарядка. На телефоні таємно обери <u className="rat">«ПІДМУТИТИ»</u> або <u className="good">«НЕ ЧІПАТИ»</u> і натисни «ПІДТВЕРДИТИ».
          </span>
          <RulesList />
          <small>30 секунд · вибір не змінити · не встиг = «не чіпав»</small>
        </Chalkboard>
        {lineup(false)}
        {countdownNum <= 3 ? (
          <div className="rat-countdown" key={countdownNum}>
            {countdownNum}
          </div>
        ) : (
          <p className="rat-getready">Дзвінок за {countdownNum}…</p>
        )}
      </section>
    );
  }

  // the vote (and the moment between its end and the results)
  const tense = voting && secsLeft <= 5;
  return (
    <section className={`${cls} rat-voting ${tense ? "tense" : ""}`}>
      <Classroom tense={tense}>
        <DeskScene />
      </Classroom>
      <Chalkboard boardKey={voting ? `h${hostIdx}` : "end"}>
        <b className="big host">🎙️ {voting ? HOST_LINES[hostIdx] : "Дзвінок! Хто тут КРИСА?.."}</b>
        <span className="rat-chalk-dots">
          {voting ? "Рішень: " : "Голосування завершено "}
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < progress.voted ? "on" : ""} />
          ))}
        </span>
      </Chalkboard>
      <AlarmClock msLeft={msLeft} totalMs={go.voteEndAt - go.voteStartAt} done={!voting} />
      {lineup(tense)}
    </section>
  );
}
