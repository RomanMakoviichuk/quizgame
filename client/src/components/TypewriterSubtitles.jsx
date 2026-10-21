import { useEffect, useState } from "react";
import "./TypewriterSubtitles.css";
import gameClock from "../game/gameClock";

/**
 * Horror-style subtitles with typewriter effect.
 * The typing follows the clock, not the number of timer ticks: a busy computer
 * drops ticks but the text still ends on time, and a long question is typed
 * faster so it never takes more than MAX_TYPE_MS.
 * @param {string} text - Full text to display
 * @param {number} speed - ms per character (at most; long texts go faster)
 * @param {boolean} active - start typing when true
 * @param {function} onComplete - called when typing finishes
 */
const MAX_TYPE_MS = 3000;
const TICK_MS = 30;

export default function TypewriterSubtitles({ text, speed = 80, active, onComplete }) {
  const [displayed, setDisplayed] = useState("");
  const safeText = String(text ?? "").replace(/\s*\.?\s*undefined\s*$/i, "").trimEnd();

  useEffect(() => {
    if (!active || !safeText) {
      setDisplayed("");
      return;
    }
    setDisplayed("");
    const total = Math.min(safeText.length * speed, MAX_TYPE_MS);
    const startedAt = gameClock.now(); // game time: a pause holds the typing
    const id = gameClock.setInterval(() => {
      const n = Math.min(safeText.length, Math.ceil(((gameClock.now() - startedAt) / total) * safeText.length));
      setDisplayed(safeText.slice(0, n));
      if (n >= safeText.length) {
        gameClock.clearInterval(id);
        onComplete?.();
      }
    }, TICK_MS);
    return () => gameClock.clearInterval(id);
  }, [safeText, active, speed]);

  if (!safeText) return null;

  return (
    <div className="typewriter-subtitles">
      <span className="typewriter-text">{displayed}</span>
      <span className="typewriter-cursor">|</span>
    </div>
  );
}
