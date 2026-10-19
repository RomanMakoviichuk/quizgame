import { useEffect, useState } from "react";
import "./TypewriterSubtitles.css";
import gameClock from "../game/gameClock";

/**
 * Horror-style subtitles with typewriter effect.
 * @param {string} text - Full text to display
 * @param {number} speed - ms per character
 * @param {boolean} active - start typing when true
 * @param {function} onComplete - called when typing finishes
 */
export default function TypewriterSubtitles({ text, speed = 80, active, onComplete }) {
  const [displayed, setDisplayed] = useState("");
  const safeText = String(text ?? "").replace(/\s*\.?\s*undefined\s*$/i, "").trimEnd();

  useEffect(() => {
    if (!active || !safeText) {
      setDisplayed("");
      return;
    }
    setDisplayed("");
    let i = 0;
    const id = gameClock.setInterval(() => {
      if (i >= safeText.length) {
        gameClock.clearInterval(id);
        onComplete?.();
        return;
      }
      const nextChar = safeText[i];
      if (typeof nextChar !== "string") {
        gameClock.clearInterval(id);
        onComplete?.();
        return;
      }
      setDisplayed((prev) => prev + nextChar);
      i++;
    }, speed);
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
