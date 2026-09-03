import { useEffect, useMemo, useRef, useState } from "react";
import "./TrueFalseAftermath.css";

const HEART_DELAY_MS = 2500;

/**
 * Після міні-гри: відео aftermg.mp4 на весь екран; таблиця балів з’являється
 * після початкового фрагменту ролика; сцена триває рівно стільки, скільки триває відео.
 * @param {boolean} [stylingDebug] — dev: зациклити відео, не викликати onComplete; бейдж з підказкою.
 */
export default function TrueFalseAftermath({ data, onComplete, stylingDebug = false }) {
  const { minigameScores, namesById, livesById, contestantIds, loserIds } = data;
  const videoRef = useRef(null);
  const [showTable, setShowTable] = useState(false);
  const [heartPhase, setHeartPhase] = useState(false);
  const finishedRef = useRef(false);
  const [tableAtSec, setTableAtSec] = useState(3);
  const [videoDuration, setVideoDuration] = useState(0);
  const loopPrevTimeRef = useRef(0);

  const rows = useMemo(() => {
    return [...contestantIds]
      .sort((a, b) => (minigameScores[b] ?? 0) - (minigameScores[a] ?? 0))
      .map((id, i) => ({
        rank: i + 1,
        id,
        name: namesById[id] ?? "Гравець",
        score: minigameScores[id] ?? 0,
        lives: Number.isFinite(Number(livesById?.[id])) ? Number(livesById[id]) : 3,
      }));
  }, [contestantIds, minigameScores, namesById, livesById]);

  useEffect(() => {
    const v = videoRef.current;
    const onTime = () => {
      if (v && v.currentTime >= tableAtSec) setShowTable(true);
    };
    v?.addEventListener("timeupdate", onTime);
    const fallback = window.setTimeout(() => setShowTable(true), (tableAtSec + 0.4) * 1000);
    return () => {
      v?.removeEventListener("timeupdate", onTime);
      window.clearTimeout(fallback);
    };
  }, [tableAtSec]);

  useEffect(() => {
    if (!showTable) return;
    const roomMs =
      videoDuration > 0
        ? Math.max(0, (videoDuration - tableAtSec - 1.2) * 1000)
        : HEART_DELAY_MS * 2;
    const delayMs = Math.min(HEART_DELAY_MS, roomMs);
    const t = window.setTimeout(() => setHeartPhase(true), delayMs);
    return () => window.clearTimeout(t);
  }, [showTable, videoDuration, tableAtSec]);

  useEffect(() => {
    if (!stylingDebug) return;
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const t = v.currentTime;
      if (loopPrevTimeRef.current > 2 && t < 0.75) {
        setShowTable(false);
        setHeartPhase(false);
      }
      loopPrevTimeRef.current = t;
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [stylingDebug]);

  const finishScene = () => {
    if (stylingDebug) return;
    if (finishedRef.current) return;
    finishedRef.current = true;
    onComplete?.();
  };

  const loseSet = useMemo(() => new Set(loserIds || []), [loserIds]);

  return (
    <div className="truefalse-aftermath-root" role="dialog" aria-label="Результати міні-гри">
      <video
        ref={videoRef}
        className="truefalse-aftermath-video"
        src="/assets/questions/video/aftermg.mp4"
        autoPlay
        playsInline
        preload="auto"
        loop={stylingDebug}
        onLoadedMetadata={(e) => {
          const el = e.target;
          el.volume = 0.45;
          const d = el.duration;
          if (Number.isFinite(d) && d > 0) {
            setVideoDuration(d);
            const t = Math.min(3, Math.max(0.35, Math.min(d * 0.2, d - 1)));
            setTableAtSec(t);
          }
        }}
        onEnded={stylingDebug ? undefined : finishScene}
        onError={() => {
          window.setTimeout(() => {
            if (!stylingDebug) finishScene();
          }, 500);
        }}
      />

      {stylingDebug && (
        <div className="truefalse-aftermath-debug-badge">
          <strong>Aftermath debug</strong>
          <span>Вимкнути: ?aftermathDebug=0 · правки в TrueFalseAftermath.css</span>
        </div>
      )}

      {showTable && (
        <div className="truefalse-aftermath-panel">
          <h2 className="truefalse-aftermath-title">Результати «Правда / Брехня»</h2>
          <p className="truefalse-aftermath-sub">Правильні відповіді в міні-грі</p>
          <div className="truefalse-aftermath-table-scroll">
            <table className="truefalse-aftermath-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Гравець</th>
                  <th>Балів</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={loseSet.has(r.id) ? "truefalse-aftermath-row-risk" : ""}>
                    <td>{r.rank}</td>
                    <td>{r.name}</td>
                    <td className="truefalse-aftermath-scorecell">{r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="truefalse-aftermath-lives">
            {rows.map((r) => {
              const loses = loseSet.has(r.id);
              const n = Math.min(10, Math.max(0, r.lives));
              return (
                <div
                  key={`life-${r.id}`}
                  className={`truefalse-aftermath-life-row ${
                    heartPhase && loses ? "truefalse-aftermath-life-row--hit" : ""
                  }`}
                >
                  <span className="truefalse-aftermath-life-name">{r.name}</span>
                  <span
                    className="truefalse-aftermath-hearts"
                    aria-label={`Життів: ${heartPhase && loses ? Math.max(0, r.lives - 1) : r.lives}`}
                  >
                    {Array.from({ length: n }).map((_, i) => (
                      <span
                        key={i}
                        className={
                          heartPhase && loses && i === n - 1 && n > 0
                            ? "truefalse-aftermath-heart truefalse-aftermath-heart--lost"
                            : "truefalse-aftermath-heart"
                        }
                      >
                        ❤
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
