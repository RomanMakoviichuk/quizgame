import { useEffect, useRef, useState } from "react";
import gameClock from "../game/gameClock";
import "./RoundResults.css";

/**
 * The round's results check on the TV (~10s) — «Лялькова вечірка», night version:
 * a thread across the top, every player's felt tag hangs on it from a clothes-peg,
 * and the verdicts are SEWN on one by one: a green button with a stitched tick
 * (+10, a ghost +5) or a red stitched cross (the tag sags). A big tag with
 * "Вгадали X з N" is pinned last. It plays over the round's reaction clip
 * (`videoSrc`, with its sound) — or the muted main video when there is none —
 * and keeps to the top-left, so the host in the clip stays in view.
 *   0.0  fade in, the ribbon "Раунд N · Перевірка відповідей", the thread is pulled
 *   0.5  the tags drop onto the thread one by one and swing
 *   2.6  verdicts, tag by tag (STAMP_STEP_MS apart), each with a soft click
 *   ~6   the summary tag
 *   end  when both the ~10s board and the clip are over: fade to black -> onDone()
 * CSS animations (frozen by the game pause); game-clock timers for the clicks and the end.
 */
export const ROUND_RESULTS_MS = 10000;
const STAMP_START_MS = 2600;
const STAMP_STEP_MS = 380;
const STAMP_SOUND = "/assets/sounds/click-sound.mp3";
const CLOSE_MS = 600;
const MAIN_VIDEO = "/assets/videos/main.mp4";
const GHOST_SHARE = 0.5; // server: GHOST_SCORE_SHARE

const sprite = (p, i) =>
  `/assets/images/Characters/${p.isGhost ? "deathcharacters" : "alivecharacters"}/${
    p.characterSlot >= 1 && p.characterSlot <= 8 ? p.characterSlot : (i % 8) + 1
  }.png`;

function mood(right, total) {
  if (!total) return "";
  if (right === total) return "Усі вгадали! Підозріло розумна компанія 🤨";
  if (right === 0) return "Ніхто не вгадав… темрява задоволена 💀";
  if (right === 1) return "Лише один розумник на всю вечірку 🧠";
  if (right / total >= 0.5) return "Непогано! Але дехто явно спав 😴";
  return "Більшість схибила — буде весело 😈";
}

/** The verdict sewn onto a tag: a green button with a stitched tick, or a red stitched cross. */
function Verdict({ ok }) {
  return ok ? (
    <svg className="rr-verdict ok" viewBox="0 0 60 60" aria-label="правильно">
      <circle cx="30" cy="30" r="26" className="rr-btn" />
      <circle cx="30" cy="30" r="20" className="rr-btn-rim" />
      {[[22, 22], [38, 22], [22, 38], [38, 38]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="2.6" className="rr-hole" />
      ))}
      <path d="M17 31 L26 40 L44 20" className="rr-stitch" />
    </svg>
  ) : (
    <svg className="rr-verdict bad" viewBox="0 0 60 60" aria-label="неправильно">
      <path d="M14 14 L46 46" className="rr-stitch" />
      <path d="M46 14 L14 46" className="rr-stitch late" />
    </svg>
  );
}

export default function RoundResults({ players = [], roundIndex = 1, scoreCorrect = 10, videoSrc = null, answer = null, onDone }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const list = players.slice(0, 8);
  const right = list.filter((p) => p.lastCorrect).length;
  const [closing, setClosing] = useState(false);
  // the scene ends when the board has run its course AND the reaction clip is over
  const doneRef = useRef({ board: false, clip: !videoSrc, closed: false });
  const tryClose = (key) => {
    const d = doneRef.current;
    d[key] = true;
    if (d.closed || !d.board || !d.clip) return;
    d.closed = true;
    setClosing(true);
    gameClock.setTimeout(() => onDoneRef.current?.(), CLOSE_MS);
  };
  const tryCloseRef = useRef(tryClose);
  tryCloseRef.current = tryClose;

  useEffect(() => {
    const timers = [];
    // a soft "click" with every verdict sewn on
    list.forEach((_, i) => {
      timers.push(
        gameClock.setTimeout(() => {
          try {
            const a = new Audio(STAMP_SOUND);
            a.volume = 0.45;
            a.play().catch(() => {});
          } catch {
            /* audio unavailable */
          }
        }, STAMP_START_MS + i * STAMP_STEP_MS)
      );
    });
    timers.push(gameClock.setTimeout(() => tryCloseRef.current("board"), ROUND_RESULTS_MS - CLOSE_MS));
    // a clip that never ends (stalled / broken) must not hold the game
    if (videoSrc) timers.push(gameClock.setTimeout(() => tryCloseRef.current("clip"), 30000));
    return () => timers.forEach((t) => gameClock.clearTimeout(t));
    // one showing per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summaryAt = STAMP_START_MS + list.length * STAMP_STEP_MS + 250;

  return (
    <div
      className={`rr-root ${closing ? "closing" : ""}`}
      style={{
        "--rr-stamp0": `${STAMP_START_MS}ms`,
        "--rr-step": `${STAMP_STEP_MS}ms`,
        "--rr-summary": `${summaryAt}ms`,
      }}
    >
      {videoSrc ? (
        <video
          className="rr-bg"
          src={videoSrc}
          autoPlay
          playsInline
          aria-hidden
          onLoadedMetadata={(e) => {
            e.target.volume = 1;
          }}
          onEnded={() => tryClose("clip")}
          onError={() => tryClose("clip")}
        />
      ) : (
        <video className="rr-bg" src={MAIN_VIDEO} autoPlay loop muted playsInline aria-hidden />
      )}
      <div className="rr-shade" aria-hidden />

      <p className="rr-ribbon">
        Раунд {roundIndex} <span>·</span> Перевірка відповідей
      </p>
      {answer?.text && (
        <div className="rr-answer">
          <small>Правильна відповідь</small>
          <b>
            <i>{"ABCD"[answer.index] || "✓"}</i>
            {answer.text}
          </b>
        </div>
      )}

      <div className="rr-thread" aria-hidden />
      <div className="rr-tags">
        {list.map((p, i) => {
          const lives = Number.isFinite(Number(p.lives)) ? Math.max(0, Number(p.lives)) : 3;
          const gained = p.lastCorrect ? (p.isGhost ? Math.ceil(scoreCorrect * GHOST_SHARE) : scoreCorrect) : 0;
          return (
            <div
              key={p.id}
              className={`rr-tag-slot ${p.lastCorrect ? "ok" : "bad"} ${p.isGhost ? "ghost" : ""}`}
              style={{ "--i": i }}
            >
              <span className="rr-peg" aria-hidden />
              <div className="rr-tag">
                <img src={sprite(p, i)} alt="" />
                <b className="rr-name">{p.name}</b>
                <span className="rr-lives">{lives ? "❤".repeat(Math.min(5, lives)) : "👻"}</span>
                <span className="rr-score">{Number(p.score) || 0}</span>
                <Verdict ok={!!p.lastCorrect} />
                {gained > 0 && <em className="rr-plus">+{gained}</em>}
              </div>
            </div>
          );
        })}
        <div className="rr-tag-slot rr-total-slot" style={{ "--i": list.length }}>
          <span className="rr-peg" aria-hidden />
          <div className="rr-tag rr-total">
            <small>Вгадали</small>
            <b>
              {right}
              <span>з {list.length}</span>
            </b>
          </div>
        </div>
      </div>

      <p className="rr-mood">{mood(right, list.length)}</p>
      <div className="rr-blackout" aria-hidden />
    </div>
  );
}
