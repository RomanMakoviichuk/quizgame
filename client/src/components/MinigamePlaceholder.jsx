import { useEffect } from "react";
import "./MinigamePlaceholder.css";

/**
 * Placeholder for mini-game. Emits done after delay.
 */
export default function MinigamePlaceholder({ roundIndex, onDone, isDisplay }) {
  useEffect(() => {
    if (!isDisplay) return;
    const t = setTimeout(() => onDone?.(), 3000);
    return () => clearTimeout(t);
  }, [isDisplay, onDone]);

  return (
    <div className="minigame-placeholder">
      <h2 className="minigame-title">Міні-гра</h2>
      <p className="minigame-hint">Раунд {roundIndex} — міні-гра (placeholder)</p>
    </div>
  );
}
