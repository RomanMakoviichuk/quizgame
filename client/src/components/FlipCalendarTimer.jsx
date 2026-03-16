import { useEffect, useState, useRef } from "react";
import "./FlipCalendarTimer.css";

/**
 * Таймер у вигляді календаря — сторінки перелистуються з цифрами.
 * @param {number} timeLeft - Залишок часу в секундах (15 -> 0)
 */
export default function FlipCalendarTimer({ timeLeft }) {
  const [displayNum, setDisplayNum] = useState(timeLeft);
  const [prevNum, setPrevNum] = useState(timeLeft);
  const [isFlipping, setIsFlipping] = useState(false);
  const prevTimeRef = useRef(timeLeft);

  useEffect(() => {
    if (timeLeft !== prevTimeRef.current) {
      setPrevNum(prevTimeRef.current);
      setDisplayNum(timeLeft);
      setIsFlipping(true);
      prevTimeRef.current = timeLeft;
    }
  }, [timeLeft]);

  const handleFlipEnd = () => {
    setIsFlipping(false);
  };

  if (timeLeft < 0) return null;

  return (
    <div
      className={`flip-calendar-timer ${timeLeft <= 5 ? "flip-urgent" : ""} ${timeLeft <= 3 && timeLeft > 0 ? "flip-pulse" : ""}`}
      role="timer"
      aria-live="polite"
    >
      <div className="flip-calendar">
        <div
          key={`${prevNum}-${displayNum}`}
          className={`flip-card ${isFlipping ? "flip-animate" : ""}`}
          onAnimationEnd={handleFlipEnd}
        >
          <div className="flip-face flip-front">
            <span className="flip-number">{prevNum}</span>
          </div>
          <div className="flip-face flip-back">
            <span className="flip-number">{displayNum}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
