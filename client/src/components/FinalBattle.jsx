import { useEffect, useMemo, useRef, useState } from "react";
import "./FinalBattle.css";
import FireTitle from "./FireTitle";
import gameClock from "../game/gameClock";
import { playKillAndDeath, preloadDeathSounds } from "../game/deathSounds";

/**
 * Фінальна гонка гри «Хто є хто!».
 *
 * The server (server/finalBattle.js + phases.js) owns every rule: positions,
 * the 3/2/1 podium, darkness, winner. This component only renders the state it
 * receives and sends one thing back: the player's answer index ("finalAnswer"),
 * plus the display's "finalBattleIntroDone" handshake.
 *
 *   uiMode="display" — the TV: the hall, racers, the creeping shadow, sound
 *   uiMode="mobile"  — the phone: status, the 4 answer buttons, silent
 *
 * The hall is cut into EXIT+1 vertical strips — one per cell. The shadow
 * always covers whole strips: whoever stands in a covered strip is out.
 *
 * Wire events: finalBattle (intro, via `intro` prop) · finalQuestion ·
 * finalAnswerAck · finalAnswerProgress · finalStepResult.
 */

const SLOT = (n) => (n >= 1 && n <= 8 ? n : 1);
const aliveSprite = (slot) => `/assets/images/Characters/alivecharacters/${SLOT(slot)}.png`;
const deadSprite = (slot) => `/assets/images/Characters/deathcharacters/${SLOT(slot)}.png`;
export const spriteOf = (p) =>
  p.wasGhost || p.status === "consumed" ? deadSprite(p.characterSlot) : aliveSprite(p.characterSlot);

const BG = "/assets/images/FinalBattle/background.webp";

// Hall geometry, % of the scene. Strips 0..exit run from TRACK_LEFT to TRACK_RIGHT;
// the lit doorway of the background sits just right of the last strip.
const TRACK_LEFT = 2;
const TRACK_RIGHT = 93;
// Racers stand in rows between these heights (% of the scene). Up to 4 rows;
// each racer keeps its row unless a neighbour is too close horizontally.
const ROWS_TOP = 34;
const ROWS_BOTTOM = 93;
const MAX_ROWS = 4;
const stripW = (exit) => (TRACK_RIGHT - TRACK_LEFT) / (exit + 1);
const stripLeft = (i, exit) => TRACK_LEFT + i * stripW(exit);
const cellX = (cell, exit) => stripLeft(Math.max(0, Math.min(exit, cell)), exit) + stripW(exit) / 2;
/**
 * Strips 0..darkness are death. The black body of the shadow covers strips
 * 0..darkness-1; strip `darkness` itself is the red killing edge (drawn as
 * part of the shadow so both move together). Anyone in the red strip is out.
 */
const shadowX = (darkness, exit) => stripLeft(Math.max(0, Math.min(exit + 1, darkness)), exit);

// Display intro timeline (ms). The server falls back after INTRO_MAX_MS anyway.
const INTRO = { TITLE: 4200, RULES: 9000, COUNT: 3000 };

const LETTERS = ["A", "B", "C", "D"];

function useCountdown(endsAt, clock) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!endsAt) return setLeft(0);
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - clock.now()) / 1000)));
    tick();
    const t = gameClock.setInterval(tick, 200);
    return () => gameClock.clearInterval(t);
  }, [endsAt, clock]);
  return left;
}

function useViewport() {
  const read = () => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1920,
    h: typeof window !== "undefined" ? window.innerHeight : 1080,
  });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

/**
 * Give every visible racer a row so that no two dolls in one row are closer
 * than `minGap` (% of width). A racer keeps last step's row when it can, so the
 * picture stays readable; otherwise it takes the nearest free row, and if all
 * rows are crowded, the one with the most room.
 */
function assignRows(racers, rows, minGap, prev) {
  const out = {};
  const placed = Array.from({ length: rows }, () => []);
  const ordered = [...racers].sort((a, b) => b.x - a.x || (a.id < b.id ? -1 : 1));
  ordered.forEach((r, i) => {
    const pref = prev[r.id] ?? r.index % rows;
    const order = Array.from({ length: rows }, (_, k) => k).sort(
      (a, b) => Math.abs(a - pref) - Math.abs(b - pref) || a - b
    );
    const room = (row) => Math.min(Infinity, ...placed[row].map((x) => Math.abs(x - r.x)));
    const row = order.find((k) => room(k) >= minGap) ?? order.reduce((best, k) => (room(k) > room(best) ? k : best), order[0]);
    placed[row].push(r.x);
    out[r.id] = row;
  });
  return out;
}

/** No winner: everyone died before the final ("draw") or in it ("all_consumed"). */
export function drawText(ending) {
  return ending === "draw"
    ? "Нічия — усі загинули ще до фіналу"
    : "Нічия — тінь забрала всіх, ніхто не дістався світла";
}

function statusLabel(p) {
  if (p.status === "escaped") return "НА СВОБОДІ";
  if (p.status === "consumed") return "ПОГЛИНУТО";
  return p.wasGhost ? "ПРИВИД" : "ЖИВИЙ";
}

/** Stable pseudo-random particles (no re-shuffle on re-render). */
function useParticles(count, seed) {
  return useMemo(() => {
    let s = seed;
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: count }, () => ({
      x: rnd() * 100,
      y: rnd() * 100,
      size: 0.15 + rnd() * 0.45,
      delay: -rnd() * 20,
      dur: 8 + rnd() * 14,
      hue: rnd(),
    }));
  }, [count, seed]);
}

export default function FinalBattle({ uiMode = "display", socket, intro, myPlayerId }) {
  const isDisplay = uiMode === "display";
  const clock = useMemo(() => {
    let offset = 0;
    return {
      sync: (serverNow) => {
        if (Number.isFinite(Number(serverNow))) offset = Number(serverNow) - gameClock.now();
      },
      now: () => gameClock.now() + offset,
    };
  }, []);

  const [race, setRace] = useState(() => ({
    exit: intro?.exit ?? 30,
    darkness: intro?.darkness ?? 0,
    step: intro?.step ?? 0,
    participants: intro?.participants || [],
    winnerId: null,
    ending: null,
  }));
  const [stage, setStage] = useState("intro"); // intro | question | reveal | done
  const [introPart, setIntroPart] = useState("title"); // title | rules | count
  const [countNum, setCountNum] = useState(3);
  const [question, setQuestion] = useState(null);
  const [answeredIds, setAnsweredIds] = useState([]);
  const [myAnswer, setMyAnswer] = useState(null); // index acknowledged by the server
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [result, setResult] = useState(null);
  const [shake, setShake] = useState(0);
  const introDoneRef = useRef(false);

  const audio = {
    ambient: useRef(null),
    sting: useRef(null),
    beep: useRef(null),
    win: useRef(null),
    step: useRef(null),
  };
  const play = (ref, volume = 1) => {
    if (!isDisplay || !ref.current) return;
    try {
      ref.current.currentTime = 0;
      ref.current.volume = volume;
      ref.current.play().catch(() => {});
    } catch {}
  };

  // ------------------------------------------------------------ socket
  useEffect(() => {
    if (!socket) return undefined;
    const onQuestion = (d) => {
      clock.sync(d?.serverNow);
      setStage("question");
      setQuestion(d);
      setAnsweredIds([]);
      setMyAnswer(null);
      setPendingAnswer(null);
      setResult(null);
      setRace((r) => ({ ...r, step: d.step }));
    };
    const onAck = (d) => setMyAnswer(Number(d?.answerIndex));
    const onProgress = (d) => setAnsweredIds(d?.answeredIds || []);
    const onResult = (d) => {
      setResult(d);
      setStage(d.ending ? "done" : "reveal");
      setRace({
        exit: d.exit,
        darkness: d.darkness,
        step: d.step,
        participants: d.participants || [],
        winnerId: d.winnerId,
        ending: d.ending,
      });
    };
    socket.on("finalQuestion", onQuestion);
    socket.on("finalAnswerAck", onAck);
    socket.on("finalAnswerProgress", onProgress);
    socket.on("finalStepResult", onResult);
    return () => {
      socket.off("finalQuestion", onQuestion);
      socket.off("finalAnswerAck", onAck);
      socket.off("finalAnswerProgress", onProgress);
      socket.off("finalStepResult", onResult);
    };
  }, [socket, clock]);

  // ------------------------------------------------------------ display intro
  useEffect(() => {
    if (!isDisplay || stage !== "intro") return undefined;
    const timers = [];
    const at = (ms, fn) => timers.push(gameClock.setTimeout(fn, ms));
    play(audio.sting, 0.8);
    at(INTRO.TITLE, () => setIntroPart("rules"));
    [0, 1000, 2000].forEach((ms, i) =>
      at(INTRO.TITLE + INTRO.RULES + ms, () => {
        setIntroPart("count");
        setCountNum(3 - i);
        play(audio.beep, 0.6);
      })
    );
    at(INTRO.TITLE + INTRO.RULES + INTRO.COUNT, () => {
      if (introDoneRef.current) return;
      introDoneRef.current = true;
      socket?.emit("finalBattleIntroDone");
    });
    return () => timers.forEach((id) => gameClock.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDisplay, stage, socket]);

  // ambient loop for the whole final (display only)
  useEffect(() => {
    if (!isDisplay) return undefined;
    preloadDeathSounds();
    const a = audio.ambient.current;
    if (a) {
      a.volume = 0.4;
      a.play().catch(() => {});
    }
    return () => a?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDisplay]);

  // step sounds + camera shake (display only)
  useEffect(() => {
    if (!result || !isDisplay) return undefined;
    const timers = [];
    if (result.movers?.length) timers.push(gameClock.setTimeout(() => play(audio.step, 0.6), 300));
    if (result.darkness && result.darkness.to > result.darkness.from) {
      timers.push(gameClock.setTimeout(() => setShake((n) => n + 1), 1500));
    }
    // kill + death sounds per victim, as the black burst closes over them (~1.9s)
    (result.consumed || []).forEach((_, i) =>
      timers.push(gameClock.setTimeout(() => playKillAndDeath(0.95), 1900 + i * 650))
    );
    if (result.winnerId) {
      // victory fanfare with the winner card; the background music steps back for it
      timers.push(
        gameClock.setTimeout(() => {
          if (audio.ambient.current) audio.ambient.current.volume = 0.12;
          play(audio.win, 1);
        }, 1600)
      );
    }
    return () => timers.forEach((id) => gameClock.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const timeLeft = useCountdown(stage === "question" ? question?.endsAt : null, clock);

  const me = race.participants.find((p) => p.id === myPlayerId) || null;
  const winner = race.participants.find((p) => p.id === race.winnerId) || null;

  const sendAnswer = (idx) => {
    if (!socket || stage !== "question" || myAnswer !== null || pendingAnswer !== null) return;
    if (!me || me.status !== "racing") return;
    setPendingAnswer(idx);
    socket.emit("finalAnswer", { answerIndex: idx });
  };

  if (isDisplay) {
    return (
      <DisplayScene
        race={race}
        stage={stage}
        introPart={introPart}
        countNum={countNum}
        question={question}
        timeLeft={timeLeft}
        answeredIds={answeredIds}
        result={result}
        winner={winner}
        audio={audio}
        shake={shake}
        moves={intro?.rules?.moves || [4, 3, 2]}
        otherMove={intro?.rules?.otherMove ?? 1}
      />
    );
  }

  return (
    <MobileController
      race={race}
      me={me}
      stage={stage}
      question={question}
      timeLeft={timeLeft}
      myAnswer={myAnswer ?? pendingAnswer}
      acknowledged={myAnswer !== null}
      result={result}
      winner={winner}
      onAnswer={sendAnswer}
    />
  );
}

// ======================================================================= TV

function DisplayScene({ race, stage, introPart, countNum, question, timeLeft, answeredIds, result, winner, audio, shake, moves, otherMove }) {
  const { exit, darkness, participants } = race;
  const vp = useViewport();
  const n = Math.max(1, participants.length);
  const rows = Math.min(MAX_ROWS, n);
  const rowH = (ROWS_BOTTOM - ROWS_TOP) / rows; // % of height == vh here
  // full-height dolls with the name under them, sized to their row
  const spriteVh = Math.max(9, Math.min(19, rowH * 0.78));
  const spriteWPct = ((spriteVh / 100) * vp.h * 1.3 * 100) / vp.w; // doll + name, % of width
  const rowsRef = useRef({});
  const visible = participants
    .map((p, index) => ({ id: p.id, index, x: cellX(p.pos, exit), p }))
    .filter((r) => r.p.status !== "consumed" || (result?.consumed || []).includes(r.id));
  const rowById = assignRows(visible, rows, spriteWPct, rowsRef.current);
  rowsRef.current = { ...rowsRef.current, ...rowById };
  const answered = new Set(answeredIds);
  const moverById = Object.fromEntries((result?.movers || []).map((m) => [m.id, m]));
  const consumedNow = new Set(result?.consumed || []);
  const dust = useParticles(36, 7);
  const sw = stripW(exit);
  const showPanel = stage === "question" && question;
  const correctText =
    result && question && stage !== "question" ? question.options?.[result.correctIndex] : null;

  return (
    <div className={`fb-scene fb-stage-${stage} ${race.ending ? `fb-ending-${race.ending}` : ""}`}>
      <audio ref={audio.ambient} src="/assets/sounds/final_background.mp3" loop preload="auto" />
      <audio ref={audio.sting} src="/assets/sounds/chain.mp3" preload="auto" />
      <audio ref={audio.beep} src="/assets/sounds/beep.mp3" preload="auto" />
      <audio ref={audio.win} src="/assets/sounds/win.mp3" preload="auto" />
      <audio ref={audio.step} src="/assets/sounds/notification.mp3" preload="auto" />

      <StitchDefs />
      <div className="fb-world" key={`shake-${shake}`} data-shake={shake > 0 ? "1" : "0"}>
        {/* ------------------------------------------------ the hall */}
        <div className="fb-bg" style={{ backgroundImage: `url(${BG})` }} aria-hidden />
        <div className="fb-torches" aria-hidden>
          {[10.7, 38.6, 65.6].map((x, i) => (
            <span key={x} style={{ left: `${x}%`, animationDelay: `${-i * 0.7}s` }} />
          ))}
        </div>
        <div className="fb-doorglow" aria-hidden />
        <div className="fb-dust" aria-hidden>
          {dust.map((p, i) => (
            <span
              key={i}
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.size}vw`,
                height: `${p.size}vw`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.dur}s`,
              }}
            />
          ))}
        </div>

        {/* ------------------------------------------------ strips (one per cell) */}
        <div className="fb-strips" aria-hidden>
          {Array.from({ length: exit + 1 }, (_, i) => {
            const covered = i <= darkness;
            return (
              <div
                key={i}
                className={[
                  "fb-strip",
                  i % 5 === 0 ? "fb-strip-major" : "",
                  i === exit ? "fb-strip-exit" : "",
                  covered ? "fb-strip-covered" : "",
                ].join(" ")}
                style={{ left: `${stripLeft(i, exit)}%`, width: `${sw}%` }}
              >
                {(i % 5 === 0 || i === exit) && <em>{i === exit ? "ВИХІД" : i}</em>}
              </div>
            );
          })}
        </div>

        {/* ------------------------------------------------ racers */}
        {participants.map((p) => {
          const mv = moverById[p.id];
          const dyingNow = consumedNow.has(p.id);
          const row = rowById[p.id] ?? rowsRef.current[p.id] ?? 0;
          const cls = [
            "fb-racer",
            p.wasGhost ? "fb-racer-ghost" : "",
            p.status === "consumed" ? (dyingNow ? "fb-racer-dying" : "fb-racer-gone") : "",
            p.status === "escaped" ? "fb-racer-escaped" : "",
            mv ? "fb-racer-moved" : "",
            stage === "intro" ? "fb-racer-enter" : "",
          ].join(" ");
          return (
            <div
              key={p.id}
              className={cls}
              style={{
                left: `${cellX(p.pos, exit)}%`,
                top: `${ROWS_TOP + rowH * row + rowH * 0.42}%`,
                zIndex: 20 + row,
                animationDelay: stage === "intro" ? `${0.8 + row * 0.25}s` : undefined,
                ["--sprite"]: `${spriteVh}vh`,
              }}
            >
              {mv && stage !== "question" && (
                <span className={`fb-move-badge fb-rank-${mv.rank}`}>+{mv.to - mv.from}</span>
              )}
              {stage === "question" && answered.has(p.id) && (
                <span className="fb-answered">
                  <StitchMark kind="answered" />
                </span>
              )}
              {stage !== "question" && result && !mv && (p.status === "racing" || dyingNow) &&
                (result.correctIds?.includes(p.id) ? (
                  <span className="fb-verdict fb-verdict-right" key={`v-${result.step}`}>
                    <StitchMark kind="right" />
                  </span>
                ) : (
                  <span className="fb-verdict fb-verdict-wrong" key={`v-${result.step}`}>
                    <StitchMark kind="wrong" />
                  </span>
                ))}
              <span className="fb-racer-floor" />
              <img className="fb-racer-sprite" src={spriteOf(p)} alt="" />
              <span className="fb-racer-name">
                {p.wasGhost && p.status === "racing" ? "👻 " : ""}
                {p.name}
              </span>
              {dyingNow && <span className="fb-racer-swallow" aria-hidden />}
            </div>
          );
        })}

        {/* ------------------------------------------------ the shadow */}
        <div className="fb-shadow" style={{ width: `${shadowX(darkness, exit)}%` }} aria-hidden>
          <div className="fb-shadow-kill" style={{ width: `${sw}vw`, right: `-${sw}vw` }} />
          <div className="fb-shadow-edge">
            <i />
            <i />
            <i />
          </div>
          <div className="fb-shadow-lurk">
            <ShadowLurker summon={(result?.consumed?.length || 0) > 0 ? `${result.step}` : null} />
          </div>
        </div>
        <div className="fb-vignette" aria-hidden />
      </div>

      {/* ------------------------------------------------ question panel (hidden while racers move) */}
      <div className={`fb-panel ${showPanel ? "fb-panel-in" : "fb-panel-out"}`}>
        {question && (
          <>
            <div className="fb-panel-head">
              <span>Питання {question.step}</span>
              <span className={`fb-timer ${timeLeft <= 3 ? "fb-timer-low" : ""}`}>{timeLeft}</span>
            </div>
            <h2 className="fb-question">{question.text}</h2>
            <div
              className={`fb-options ${
                question.options.every((o) => String(o).length <= 22) ? "fb-options-row" : ""
              }`}
            >
              {question.options.map((o, idx) => (
                <div key={idx} className="fb-option">
                  <b>{LETTERS[idx]}</b> {o}
                </div>
              ))}
            </div>
            {showPanel && (
              <div className="fb-timebar" key={question.step}>
                <span style={{ animationDuration: `${question.answerMs || 10000}ms` }} />
              </div>
            )}
          </>
        )}
      </div>

      {correctText && stage === "reveal" && (
        <div className="fb-correct-chip" key={`chip-${result.step}`}>
          <span>Правильно:</span> <b>{LETTERS[result.correctIndex]}</b> {correctText}
        </div>
      )}

      {/* ------------------------------------------------ intro overlays */}
      {stage === "intro" && introPart === "title" && (
        <div className="fb-overlay fb-overlay-title">
          <div className="fb-title">
            <FireTitle text="ФІНАЛЬНА БИТВА" />
          </div>
          <p className="fb-subtitle">Тінь уже йде за вами. Біжіть до світла.</p>
        </div>
      )}
      {stage === "intro" && introPart === "rules" && (
        <div className="fb-overlay fb-overlay-rules">
          <div className="fb-rules">
            <h2>Правила втечі</h2>
            <ul>
              <li>
                Старт — за балами всієї гри: лідер починає <b>з середини</b> доріжки, решта — ближче до тіні.
              </li>
              <li>Відповідайте на телефонах. Рахується лише <b>перша</b> відповідь.</li>
              <li>
                Найшвидші правильні відповіді: <b>+{moves[0]}</b>, <b>+{moves[1]}</b> і <b>+{moves[2]}</b> смуги
                вперед, кожна наступна правильна — <b>+{otherMove}</b>.
              </li>
              <li>Хто першим дістанеться світла на смузі {exit} — переміг.</li>
              <li>Позаду насувається тінь. Кого вона накриє — той вибуває.</li>
              <li>👻 Привиди теж біжать. У них ще є шанс вирватися.</li>
            </ul>
          </div>
        </div>
      )}
      {stage === "intro" && introPart === "count" && (
        <div className="fb-overlay fb-overlay-count">
          <span key={countNum} className="fb-count">
            {countNum}
          </span>
        </div>
      )}

      {/* ------------------------------------------------ endings */}
      {stage === "done" && race.ending === "escaped" && winner && <WinnerScene winner={winner} />}
      {stage === "done" && race.ending === "all_consumed" && (
        <div className="fb-overlay fb-overlay-lose">
          <div className="fb-title">
            <FireTitle text="НІЧИЯ" />
          </div>
          <p className="fb-subtitle">Тінь забрала всіх — ніхто не дістався світла</p>
        </div>
      )}
    </div>
  );
}

const LURKER_SRC = "/assets/videos/characters%20animations/finaly%20monstter.mp4";
const LURKER_SHOW_MS = 4300; // visible part of the 6s clip; it fades out before the clip ends
const LURKER_FIRST_MS = 6000;
const lurkerGap = () => 7000 + Math.random() * 6000; // hidden time between appearances

/**
 * The thing that waits in the shadow: a clip on black, blended into the black
 * of the shadow (mix-blend-mode: screen) so only the monster shows. It surfaces
 * every so often, and always when the shadow takes someone (`summon` changes).
 * Timers run on gameClock, so it freezes with the admin pause.
 */
function ShadowLurker({ summon }) {
  const videoRef = useRef(null);
  const [shown, setShown] = useState(false);
  const timers = useRef({ hide: null, next: null });
  const appearRef = useRef(() => {});

  appearRef.current = () => {
    const t = timers.current;
    gameClock.clearTimeout(t.hide);
    gameClock.clearTimeout(t.next);
    const v = videoRef.current;
    if (v) {
      try {
        v.currentTime = 0;
        v.volume = 0.55;
        v.play().catch(() => {
          v.muted = true;
          v.play().catch(() => {});
        });
      } catch {}
    }
    setShown(true);
    t.hide = gameClock.setTimeout(() => setShown(false), LURKER_SHOW_MS);
    t.next = gameClock.setTimeout(() => appearRef.current(), LURKER_SHOW_MS + 1600 + lurkerGap());
  };

  useEffect(() => {
    const t = timers.current;
    t.next = gameClock.setTimeout(() => appearRef.current(), LURKER_FIRST_MS);
    return () => {
      gameClock.clearTimeout(t.hide);
      gameClock.clearTimeout(t.next);
    };
  }, []);

  // the shadow just took someone: it surfaces as the victim disappears
  useEffect(() => {
    if (!summon) return undefined;
    const id = gameClock.setTimeout(() => appearRef.current(), 1700);
    return () => gameClock.clearTimeout(id);
  }, [summon]);

  return (
    <video
      ref={videoRef}
      className={`fb-lurker ${shown ? "fb-lurker-shown" : ""}`}
      src={LURKER_SRC}
      preload="auto"
      playsInline
      onEnded={(e) => e.currentTarget.pause()}
    />
  );
}

/**
 * Answer marks in the game's look: a round burlap patch with a stitched rim,
 * the ✕ / ✓ sewn on in thread (red for wrong, gold for right), drawn stitch
 * by stitch. Shared fills live in <StitchDefs /> (rendered once per scene).
 */
function StitchDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <pattern id="fb-burlap" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="#6a4a2c" />
          <path d="M0 1h4M0 3h4" stroke="#7e5a37" strokeWidth="0.9" />
          <path d="M1 0v4M3 0v4" stroke="#56391f" strokeWidth="0.7" opacity="0.8" />
        </pattern>
        <radialGradient id="fb-patch-shade" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="60%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.45" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function StitchMark({ kind }) {
  const thread = kind === "wrong" ? "#e0281b" : "#f2c14e";
  const threadHi = kind === "wrong" ? "#ff8a73" : "#fff1b8";
  const strokes =
    kind === "wrong"
      ? ["M13 13 L27 27", "M27 13 L13 27"]
      : ["M12.5 20.5 L18 26 L28 14"];
  return (
    <svg className={`fb-stitch fb-stitch-${kind}`} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="17.5" fill="url(#fb-burlap)" />
      <circle cx="20" cy="20" r="17.5" fill="url(#fb-patch-shade)" />
      <circle className="fb-stitch-rim" cx="20" cy="20" r="15" fill="none" />
      {strokes.map((d, i) => (
        <g key={d} style={{ ["--i"]: i }}>
          <path className="fb-stitch-shadow" d={d} />
          <path className="fb-stitch-thread" d={d} stroke={thread} />
          <path className="fb-stitch-twist" d={d} stroke={threadHi} />
        </g>
      ))}
    </svg>
  );
}

function WinnerScene({ winner }) {
  const confetti = useParticles(70, 13);
  return (
    <div className="fb-overlay fb-overlay-win">
      {/* just the hall behind the winner — no racers, no shadow */}
      <div className="fb-win-bg" style={{ backgroundImage: `url(${BG})` }} aria-hidden />
      <div className="fb-win-rays" aria-hidden />
      <div className="fb-confetti" aria-hidden>
        {confetti.map((c, i) => (
          <span
            key={i}
            style={{
              left: `${c.x}%`,
              animationDelay: `${1.6 + c.hue * 2.4}s`,
              animationDuration: `${3 + c.size * 6}s`,
              background: ["#ffd76a", "#ff6b4a", "#9dffbf", "#f4f1e8", "#c58cff"][i % 5],
              transform: `rotate(${c.y * 3.6}deg)`,
            }}
          />
        ))}
      </div>
      <div className="fb-win-card">
        <p className="fb-win-kicker">ПЕРЕМОЖЕЦЬ</p>
        <div className="fb-win-medal">
          {/* reaching the light brings a ghost back: the winner is shown alive */}
          <img className="fb-win-sprite" src={aliveSprite(winner.characterSlot)} alt="" />
        </div>
        <div className="fb-win-name">
          <FireTitle text={winner.name} />
        </div>
        <p className="fb-subtitle">
          {winner.wasGhost
            ? "Привид дістався світла й повертається до живих!"
            : "Світло знайдено. Решта лишилась у темряві…"}
        </p>
      </div>
    </div>
  );
}

// ================================================================= credits

const CREDIT_AUTHOR = "Роман Анатолійович";
const CREDIT_ROLES = [
  "Ідея та сценарій",
  "Режисер",
  "Геймдизайн",
  "Голос ведучого",
  "Художник персонажів",
  "Анімація та відео",
  "Музика та звук",
  "Програмування",
  "Тестування",
  "Продюсер",
];

/**
 * Display-only end credits after gameFinished. Placeholder texts — edit freely.
 * Calls onDone when the roll finishes (or on "Пропустити").
 */
const CREDITS_MUSIC = "/assets/sounds/End Game/background.mp3";
const CREDITS_VOLUME = 0.7;

export function FinalCredits({ result, onDone }) {
  const standings = result?.standings || [];
  const winner = standings.find((s) => s.id === result?.winnerId) || null;
  const ROLL_MS = 45000;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // end-credits music: fades in with the roll, follows the pause, fades out when the credits go
  useEffect(() => {
    const a = new Audio(CREDITS_MUSIC);
    a.loop = true;
    a.volume = 0;
    let fade = null;
    const fadeTo = (target, ms, then) => {
      window.clearInterval(fade);
      const from = a.volume;
      const t0 = performance.now();
      fade = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        a.volume = Math.max(0, Math.min(1, from + (target - from) * k));
        if (k >= 1) {
          window.clearInterval(fade);
          then?.();
        }
      }, 50);
    };
    const play = () => a.play().catch(() => {});
    if (!gameClock.isPaused()) play();
    fadeTo(CREDITS_VOLUME, 2500);
    const unsub = gameClock.subscribe((paused) => (paused ? a.pause() : play()));
    return () => {
      unsub();
      fadeTo(0, 1500, () => a.pause());
    };
  }, []);

  useEffect(() => {
    const t = gameClock.setTimeout(() => onDoneRef.current?.(), ROLL_MS + 1500);
    return () => gameClock.clearTimeout(t);
  }, []);

  return (
    <div className="fb-credits" style={{ ["--roll"]: `${ROLL_MS}ms` }}>
      <div className="fb-credits-bg" style={{ backgroundImage: `url(${BG})` }} aria-hidden />
      <button type="button" className="fb-credits-skip" onClick={() => onDone?.()}>
        Пропустити ⏭
      </button>
      <div className="fb-credits-roll">
        <div className="fb-credits-title">
          <FireTitle text="ХТО Є ХТО!" />
        </div>
        {winner ? (
          <section>
            <h3>Переможець</h3>
            <img className="fb-credits-winner" src={aliveSprite(winner.characterSlot)} alt="" />
            <p className="fb-credits-big">{winner.name}</p>
          </section>
        ) : (
          <section>
            <h3>Нічия</h3>
            <p>{drawText(result?.ending)}</p>
          </section>
        )}
        <section>
          <h3>У ролях</h3>
          <div className="fb-credits-cast">
            {standings.map((s) => (
              <div key={s.id} className="fb-credits-castrow">
                <img src={spriteOf(s)} alt="" />
                <span>{s.name}</span>
                <em>
                  {s.status === "escaped" ? "на свободі" : s.status === "consumed" ? "у тіні" : `смуга ${s.pos}`}
                  {s.wasGhost ? " · привид" : ""}
                </em>
              </div>
            ))}
          </div>
        </section>
        {CREDIT_ROLES.map((role) => (
          <section key={role}>
            <h3>{role}</h3>
            <p>{CREDIT_AUTHOR}</p>
          </section>
        ))}
        <section>
          <h3>Особлива подяка</h3>
          <p>Усім, хто дійшов до фіналу</p>
        </section>
        <section className="fb-credits-end">
          <p className="fb-credits-big">Дякуємо за гру!</p>
          <p className="fb-credits-warning">Тінь повернеться… будьте розумними</p>
        </section>
        <section className="fb-credits-bravo">
          <h3>Хто взагалі молодець і красавчик?</h3>
          <p className="fb-credits-big">{CREDIT_AUTHOR}</p>
        </section>
      </div>
    </div>
  );
}

// ================================================================= results

const statusChip = (s) =>
  s.status === "escaped"
    ? { cls: "free", text: "На свободі" }
    : s.status === "consumed"
      ? { cls: "lost", text: "У тіні" }
      : { cls: "hall", text: `Смуга ${s.pos}` };

/**
 * Final standings (after the race; on the TV after the credits). Same look as
 * the final: the hall in the background, a podium for the top three, cards
 * for everyone else. Works on the phone too (single column).
 */
export function FinalResults({ result, myPlayerId, onExit }) {
  const standings = result?.standings || [];
  const winner = standings.find((s) => s.id === result?.winnerId) || null;
  const top = standings.slice(0, 3);
  const podium = [top[1], top[0], top[2]].filter(Boolean); // 2 · 1 · 3
  const rest = standings.slice(3);
  const portrait = (s) => (s.id === result?.winnerId ? aliveSprite(s.characterSlot) : spriteOf(s));

  return (
    <div className="fr-screen">
      <div className="fr-bg" style={{ backgroundImage: `url(${BG})` }} aria-hidden />
      <div className="fr-inner">
        <header className="fr-head">
          <p className="fr-kicker">Фінальна битва</p>
          <h1 className="fr-title">
            <FireTitle text="РЕЗУЛЬТАТИ" />
          </h1>
          <p className="fr-sub">
            {winner ? (
              <>
                Переможець фіналу — <b>{winner.name}</b>
                {winner.wasGhost ? " · привид повертається до живих" : ""}
              </>
            ) : (
              drawText(result?.ending)
            )}
          </p>
        </header>

        <section className="fr-podium">
          {podium.map((s) => {
            const chip = statusChip(s);
            return (
              <article
                key={s.id}
                className={`fr-step fr-place-${s.place} ${s.id === myPlayerId ? "fr-me" : ""}`}
              >
                <div className="fr-portrait">
                  <img src={portrait(s)} alt="" className={s.status === "consumed" ? "fr-lost-img" : ""} />
                </div>
                <div className="fr-plinth">
                  <span className="fr-place">{s.place}</span>
                  <span className="fr-name">
                    {s.name}
                    {s.wasGhost ? " 👻" : ""}
                  </span>
                  <span className={`fr-chip fr-chip-${chip.cls}`}>{chip.text}</span>
                  <span className="fr-rating">★ {s.score}</span>
                </div>
              </article>
            );
          })}
        </section>

        {rest.length > 0 && (
          <section className="fr-list">
            {rest.map((s) => {
              const chip = statusChip(s);
              return (
                <article key={s.id} className={`fr-row ${s.id === myPlayerId ? "fr-me" : ""}`}>
                  <span className="fr-row-place">{s.place}</span>
                  <img src={portrait(s)} alt="" className={s.status === "consumed" ? "fr-lost-img" : ""} />
                  <span className="fr-row-name">
                    {s.name}
                    {s.wasGhost ? " 👻" : ""}
                  </span>
                  <span className={`fr-chip fr-chip-${chip.cls}`}>{chip.text}</span>
                  <span className="fr-rating">★ {s.score}</span>
                </article>
              );
            })}
          </section>
        )}

        <footer className="fr-foot">
          <span className="fr-legend">★ — рейтинг основної гри</span>
          <button type="button" className="fr-exit" onClick={onExit}>
            Вийти в меню
          </button>
        </footer>
      </div>
    </div>
  );
}

// ==================================================================== phone

function MobileController({ race, me, stage, question, timeLeft, myAnswer, acknowledged, result, winner, onAnswer }) {
  if (!me) {
    return (
      <section className="fb-mobile">
        <div className="fb-m-title">ФІНАЛЬНА БИТВА</div>
        <p className="fb-m-note">Дивіться на головний екран</p>
      </section>
    );
  }

  const exit = race.exit || 30;
  const consumed = me.status === "consumed";
  const escaped = me.status === "escaped";
  const myMove = result?.movers?.find((m) => m.id === me.id);
  const wasCorrect = result?.correctIds?.includes(me.id);
  const answered = result?.answeredIds?.includes(me.id);

  let feedback = null;
  if (stage === "reveal" || stage === "done") {
    if (myMove) {
      const d = myMove.to - myMove.from;
      feedback = { cls: "good", text: `${myMove.rank}-й! +${d} ${d === 1 ? "смуга" : "смуги"}` };
    } else if (wasCorrect) feedback = { cls: "meh", text: "Правильно, але не в трійці" };
    else if (answered) feedback = { cls: "bad", text: "Неправильно" };
    else if (!consumed && !escaped) feedback = { cls: "bad", text: "Не встиг відповісти" };
  }

  return (
    <section className={`fb-mobile ${me.wasGhost ? "fb-mobile-ghost" : ""}`}>
      <div className="fb-m-head">
        <img className="fb-m-sprite" src={spriteOf(me)} alt="" />
        <div>
          <div className={`fb-m-status fb-m-status-${me.status}`}>
            {me.wasGhost && me.status === "racing" ? "ТИ ПРИВИД" : statusLabel(me)}
          </div>
          <div className="fb-m-cell">
            Смуга <b>{me.pos}</b> / {exit}
          </div>
        </div>
      </div>

      <div className="fb-m-bar" aria-label="Прогрес до виходу">
        <span className="fb-m-bar-dark" style={{ width: `${(Math.min(race.darkness + 1, exit + 1) / (exit + 1)) * 100}%` }} />
        <span className="fb-m-bar-me" style={{ left: `${((me.pos + 0.5) / (exit + 1)) * 100}%` }} />
        <span className="fb-m-bar-exit">🚪</span>
      </div>
      {!consumed && !escaped && (
        <p className="fb-m-note">
          Тінь за <b>{Math.max(0, me.pos - race.darkness)}</b> смуг позаду
        </p>
      )}

      {stage === "intro" && <p className="fb-m-big">Дивіться на екран — гонка от-от почнеться</p>}

      {consumed && <p className="fb-m-big">Тінь тебе накрила. Дивись, хто вирветься!</p>}

      {stage === "question" && question && !consumed && !escaped && (
        <>
          <div className="fb-m-qhead">
            <span>Питання {question.step}</span>
            <span className={`fb-m-timer ${timeLeft <= 3 ? "low" : ""}`}>{timeLeft}</span>
          </div>
          <h3 className="fb-m-question">{question.text}</h3>
          <div className="fb-m-options">
            {question.options.map((o, idx) => (
              <button
                key={idx}
                type="button"
                className={`fb-m-option ${myAnswer === idx ? "selected" : ""}`}
                disabled={myAnswer !== null}
                onClick={() => onAnswer(idx)}
              >
                <b>{LETTERS[idx]}</b> {o}
              </button>
            ))}
          </div>
          {myAnswer !== null && (
            <p className="fb-m-note">{acknowledged ? "Відповідь прийнято. Чекаємо інших…" : "Надсилаємо…"}</p>
          )}
        </>
      )}

      {feedback && <div className={`fb-m-feedback ${feedback.cls}`}>{feedback.text}</div>}

      {stage === "done" && (
        <p className="fb-m-big">
          {race.ending === "escaped" && winner
            ? winner.id === me.id
              ? "🏆 ПЕРЕМОГА! ТИ НА СВОБОДІ!"
              : `Переможець: ${winner.name}`
            : "Нічия — тінь забрала всіх"}
        </p>
      )}
    </section>
  );
}
