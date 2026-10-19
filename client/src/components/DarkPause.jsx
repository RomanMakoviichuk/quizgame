import { useEffect, useRef } from "react";
import gameClock from "../game/gameClock";
import "./DarkPause.css";

/**
 * A quiet beat in the dark (TV): just a black screen, then onDone().
 * One game-clock timer (pause-safe).
 */
export const DARK_PAUSE_MS = 3000;

export default function DarkPause({ onDone, ms = DARK_PAUSE_MS }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const t = gameClock.setTimeout(() => onDoneRef.current?.(), ms);
    return () => gameClock.clearTimeout(t);
    // one pause per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dark-pause" />
  );
}
