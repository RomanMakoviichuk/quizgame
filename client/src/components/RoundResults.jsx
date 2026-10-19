import { useEffect, useRef, useState } from "react";
import FireTitle from "./FireTitle";
import gameClock from "../game/gameClock";
import "./RoundResults.css";

/**
 * The round's results check on the TV (~10s), played over the round's reaction
 * clip (`videoSrc`, with its sound) — or over the muted main video when there
 * is none. The board sits along the top so the host in the clip stays visible:
 *   0.0  the scene fades in, "РАУНД N · ПЕРЕВІРКА ВІДПОВІДЕЙ" drops in
 *   0.5  the players' cards drop in one by one (character, name, lives, score)
 *   2.8  verdict stamps, card by card: ✓ +10 (hop, green glow) or ✕ (shake, red)
 *   ~6.5 the summary: "Вгадали X з N" + the round's mood line
 *   end  when both the ~10s board and the clip are over: fade to black -> onDone()
 * CSS animations (frozen by the game pause); game-clock timers for the stamp clicks and the end.
 */
export const ROUND_RESULTS_MS = 10000;
const STAMP_START_MS = 2800;
const STAMP_STEP_MS = 420;
const STAMP_SOUND = "/assets/sounds/click-sound.mp3";
const CLOSE_MS = 600;
const MAIN_VIDEO = "/assets/videos/main.mp4";

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

export default function RoundResults({ players = [], roundIndex = 1, scoreCorrect = 10, videoSrc = null, onDone }) {
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
    // a soft "click" with every stamp
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

  const summaryAt = STAMP_START_MS + list.length * STAMP_STEP_MS + 300;

  return (
    <div
      className={`rr-root ${closing ? "closing" : ""}`}
      style={{
        "--rr-ms": `${ROUND_RESULTS_MS}ms`,
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

      <header className="rr-head">
        <p className="rr-kicker">Раунд {roundIndex}</p>
        <div className="rr-title">
          <FireTitle text="ПЕРЕВІРКА ВІДПОВІДЕЙ" />
        </div>
      </header>
      <div className="rr-board" aria-hidden /> {/* the dark plate behind the board */}

      <div className="rr-cards" style={{ "--n": Math.max(1, list.length) }}>
        {list.map((p, i) => {
          const lives = Number.isFinite(Number(p.lives)) ? Math.max(0, Number(p.lives)) : 3;
          const gained = p.lastCorrect && !p.isGhost ? scoreCorrect : 0;
          return (
            <div
              key={p.id}
              className={`rr-card ${p.lastCorrect ? "ok" : "bad"} ${p.isGhost ? "ghost" : ""}`}
              style={{ "--i": i }}
            >
              <div className="rr-portrait">
                <img src={sprite(p, i)} alt="" />
              </div>
              <b className="rr-name">{p.name}</b>
              <span className="rr-lives">{lives ? "❤".repeat(Math.min(5, lives)) : "👻"}</span>
              <span className="rr-score">
                {Number(p.score) || 0}
                {gained > 0 && <em>+{gained}</em>}
              </span>
              <span className="rr-stamp" aria-label={p.lastCorrect ? "правильно" : "неправильно"}>
                {p.lastCorrect ? "✓" : "✕"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="rr-summary">
        <p className="rr-count">
          Вгадали <b>{right}</b> з {list.length}
        </p>
        <p className="rr-mood">{mood(right, list.length)}</p>
      </div>

      <div className="rr-blackout" aria-hidden />
    </div>
  );
}
