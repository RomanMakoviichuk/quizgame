import { useEffect, useState } from "react";
import "./PauseOverlay.css";

/**
 * Admin pause (server/clock.js + game/gameClock.js do the freezing).
 *
 * - The admin's phone gets a floating ⏸ button while a game is running.
 * - While paused every screen shows the pause card; only the admin can resume,
 *   or end the game for everybody (back to the start screens, asked twice).
 *
 * Rendered with the class `pause-layer`, which stays animated while the rest
 * of the page has its animations frozen (html.game-paused).
 */
export default function PauseOverlay({
  paused,
  pausedBy,
  canPause,
  isAdmin,
  isDisplay,
  onPause,
  onResume,
  onAbort,
}) {
  const [confirmExit, setConfirmExit] = useState(false);
  useEffect(() => {
    if (!paused) setConfirmExit(false);
  }, [paused]);

  if (!paused) {
    if (!canPause || !isAdmin || isDisplay) return null;
    return (
      <button
        type="button"
        className="pause-layer pause-fab"
        onClick={onPause}
        aria-label="Поставити гру на паузу"
      >
        <span className="pause-fab-icon" aria-hidden>
          <i />
          <i />
        </span>
      </button>
    );
  }

  return (
    <div
      className={`pause-layer pause-overlay ${isDisplay ? "pause-overlay-tv" : ""}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="pause-card">
        <div className="pause-glyph" aria-hidden>
          <i />
          <i />
        </div>
        <h2 className="pause-title">Пауза</h2>
        <p className="pause-sub">
          {pausedBy ? `Пауза від адміна: ${pausedBy}` : "Гру призупинено"}
          <br />
          Тінь теж чекає…
        </p>
        {confirmExit && (isDisplay || isAdmin) ? (
          <div className="pause-confirm">
            <p className="pause-confirm-q">
              Завершити гру для всіх і вийти в головне меню?
            </p>
            <button
              type="button"
              className="pause-exit pause-exit-yes"
              onClick={onAbort}
            >
              Так, вийти
            </button>
            <button
              type="button"
              className="pause-exit"
              onClick={() => setConfirmExit(false)}
            >
              Ні, повернутись
            </button>
          </div>
        ) : isAdmin && !isDisplay ? (
          <>
            <button type="button" className="pause-resume" onClick={onResume}>
              ▶ Продовжити гру
            </button>
            <button
              type="button"
              className="pause-exit"
              onClick={() => setConfirmExit(true)}
            >
              Вийти в головне меню
            </button>
          </>
        ) : (
          <>
            <p className="pause-wait">Чекаємо, поки адмін продовжить гру</p>
            {isDisplay && (
              <button
                type="button"
                className="pause-exit"
                onClick={() => setConfirmExit(true)}
              >
                Вийти в головне меню
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
