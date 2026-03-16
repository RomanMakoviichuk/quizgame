import { useEffect, useState } from "react";
import "./BombTimer.css";

/**
 * Анімований таймер-бомба для раундів гри.
 * @param {number} timeLeft - Залишок часу в секундах (15 -> 0)
 * @param {number} totalSeconds - Початкова тривалість (для анімації фітіля)
 */
export default function BombTimer({ timeLeft, totalSeconds = 15 }) {
  const [exploded, setExploded] = useState(false);

  useEffect(() => {
    if (timeLeft === 0) {
      setExploded(true);
    } else {
      setExploded(false);
    }
  }, [timeLeft]);

  if (timeLeft < 0) return null;

  const isUrgent = timeLeft <= 5;
  const isLast3 = timeLeft <= 3 && timeLeft > 0;
  const fuseProgress = totalSeconds > 0 ? ((totalSeconds - timeLeft) / totalSeconds) * 100 : 0;

  return (
    <div
      className={`bomb-timer ${isUrgent ? "bomb-urgent" : ""} ${isLast3 ? "bomb-pulse" : ""} ${exploded ? "bomb-exploded" : ""}`}
      role="timer"
      aria-live="polite"
    >
      <div className="bomb-fuse-wrap">
        <div
          className="bomb-fuse"
          style={{ "--fuse-burned": `${fuseProgress}%` }}
        >
          <div className="bomb-fuse-fire" />
        </div>
      </div>
      <div className="bomb-body">
        <span className="bomb-number">{timeLeft}</span>
      </div>
      {exploded && (
        <div className="bomb-explosion">
          <div className="bomb-explosion-inner" />
        </div>
      )}
    </div>
  );
}
