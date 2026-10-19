import { useEffect, useState, useRef } from "react";
import "./HorrorTimer.css";
import gameClock from "../game/gameClock";

/**
 * Хоррор-тематичний таймер: жирні білі цифри + мілісекунди.
 * @param {number} timeLeft - Залишок часу в секундах (15 -> 0), для синхронізації
 * @param {string} questionId - ID питання (для скидання таймера)
 * @param {number} totalSeconds - Загальна тривалість
 */
export default function HorrorTimer({ timeLeft, questionId, totalSeconds = 15 }) {
  const [display, setDisplay] = useState({ sec: timeLeft, ms: 0 });
  const startTimeRef = useRef(null);
  const questionIdRef = useRef(questionId);

  useEffect(() => {
    if (questionId && questionId !== questionIdRef.current) {
      questionIdRef.current = questionId;
      startTimeRef.current = gameClock.now();
    }
  }, [questionId]);

  useEffect(() => {
    if (!questionId || timeLeft < 0) return;
    if (!startTimeRef.current) startTimeRef.current = gameClock.now();

    const tick = () => {
      const elapsed = (gameClock.now() - startTimeRef.current) / 1000;
      const remaining = Math.max(0, totalSeconds - elapsed);
      const sec = Math.floor(remaining);
      const msVal = Math.floor((remaining - sec) * 100);
      setDisplay({ sec, ms: msVal });
    };

    tick();
    const id = gameClock.setInterval(tick, 50);
    return () => gameClock.clearInterval(id);
  }, [questionId, timeLeft, totalSeconds]);

  if (timeLeft < 0) return null;

  const { sec, ms } = display;
  const isUrgent = sec <= 5;
  const isLast3 = sec <= 3 && sec > 0;

  return (
    <div
      className={`horror-timer ${isUrgent ? "horror-urgent" : ""} ${isLast3 ? "horror-pulse" : ""}`}
      role="timer"
      aria-live="polite"
    >
      <div className="horror-timer-inner">
        <span className="horror-seconds">{sec}</span>
        <span className="horror-sep">.</span>
        <span className="horror-ms">{String(ms).padStart(2, "0")}</span>
      </div>
      <div className="horror-timer-glow" />
    </div>
  );
}
