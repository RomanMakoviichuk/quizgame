import { useEffect, useState } from "react";
import "./TypewriterSubtitles.css";

/**
 * Horror-style subtitles with typewriter effect.
 * @param {string} text - Full text to display
 * @param {number} speed - ms per character
 * @param {boolean} active - start typing when true
 * @param {function} onComplete - called when typing finishes
 */
export default function TypewriterSubtitles({ text, speed = 80, active, onComplete }) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    if (!active || !text) {
      setDisplayed("");
      return;
    }
    setDisplayed("");
    let i = 0;
    const id = setInterval(() => {
      if (i >= text.length) {
        clearInterval(id);
        onComplete?.();
        return;
      }
      setDisplayed((prev) => prev + text[i]);
      i++;
    }, speed);
    return () => clearInterval(id);
  }, [text, active, speed]);

  if (!text) return null;

  return (
    <div className="typewriter-subtitles">
      <span className="typewriter-text">{displayed}</span>
      <span className="typewriter-cursor">|</span>
    </div>
  );
}
