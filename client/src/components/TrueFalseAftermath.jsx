import { useEffect, useMemo, useRef, useState } from "react";
import "./TrueFalseAftermath.css";
import gameClock from "../game/gameClock";
import FadeVideo from "./FadeVideo";

const HEART_DELAY_MS = 2500;

/**
 * Після міні-гри: відео true-false/aftermath.mp4 на весь екран; таблиця балів з’являється
 * після початкового фрагменту ролика; сцена триває рівно стільки, скільки триває відео.
 * @param {boolean} [stylingDebug] — dev: зациклити відео, не викликати onComplete; бейдж з підказкою.
 */
const SPRITE = (slot) =>
  `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const DEAD_SPRITE = (slot) =>
  `/assets/characters/dead/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/sounds/lose/${n}.mp3`);

export default function TrueFalseAftermath({ data, onComplete, stylingDebug = false, slotsById = {} }) {
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
    const fallback = gameClock.setTimeout(() => setShowTable(true), (tableAtSec + 0.4) * 1000);
    return () => {
      v?.removeEventListener("timeupdate", onTime);
      gameClock.clearTimeout(fallback);
    };
  }, [tableAtSec]);

  useEffect(() => {
    if (!showTable) return;
    const roomMs =
      videoDuration > 0
        ? Math.max(0, (videoDuration - tableAtSec - 1.2) * 1000)
        : HEART_DELAY_MS * 2;
    const delayMs = Math.min(HEART_DELAY_MS, roomMs);
    const t = gameClock.setTimeout(() => setHeartPhase(true), delayMs);
    return () => gameClock.clearTimeout(t);
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
  const best = Math.max(1, ...rows.map((r) => r.score));

  useEffect(() => {
    if (!heartPhase || !loseSet.size) return;
    try {
      const a = new Audio(LOSE_SOUNDS[Math.floor(Math.random() * LOSE_SOUNDS.length)]);
      a.volume = 0.8;
      a.play().catch(() => {});
    } catch {
      /* audio unavailable */
    }
  }, [heartPhase, loseSet]);

  return (
    <div className="truefalse-aftermath-root" role="dialog" aria-label="Результати міні-гри">
      <FadeVideo
        ref={videoRef}
        className="truefalse-aftermath-video"
        src="/assets/minigames/true-false/aftermath.mp4"
        autoPlay
        playsInline
        preload="auto"
        loop={stylingDebug}
        onLoadedMetadata={(e) => {
          const el = e.target;
          el.volume = 1; // the host's voice: its level is set by game/loudness.js
          const d = el.duration;
          if (Number.isFinite(d) && d > 0) {
            setVideoDuration(d);
            const t = Math.min(3, Math.max(0.35, Math.min(d * 0.2, d - 1)));
            setTableAtSec(t);
          }
        }}
        onEnded={stylingDebug ? undefined : finishScene}
        onError={() => {
          gameClock.setTimeout(() => {
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
        <div className="tfa-panel">
          <header className="tfa-brand">
            <span className="tfa-t">ПРАВДА</span>
            <span className="tfa-or">чи</span>
            <span className="tfa-f">БРЕХНЯ</span>
          </header>
          <p className="tfa-sub">Підсумок · правильних відповідей</p>
          <div className="tfa-rows">
            {rows.map((r, i) => {
              const loses = loseSet.has(r.id);
              const hit = heartPhase && loses;
              const n = Math.min(10, Math.max(0, r.lives));
              return (
                <div
                  key={r.id}
                  className={`tfa-row ${loses ? "risk" : ""} ${hit ? "hit" : ""} ${i === 0 && !loses ? "lead" : ""}`}
                  style={{ animationDelay: `${0.15 + i * 0.12}s` }}
                >
                  <span className="tfa-rank">{i === 0 && !loses ? "👑" : r.rank}</span>
                  <img
                    className="tfa-sprite"
                    src={hit && r.lives <= 1 ? DEAD_SPRITE(slotsById[r.id]) : SPRITE(slotsById[r.id])}
                    alt=""
                  />
                  <div className="tfa-mid">
                    <span className="tfa-name">{r.name}</span>
                    <div className="tfa-bar">
                      <div
                        className="tfa-bar-fill"
                        style={{ transform: `scaleX(${r.score / best})`, transitionDelay: `${0.4 + i * 0.12}s` }}
                      />
                    </div>
                  </div>
                  <span className="tfa-score">{r.score}</span>
                  <span className="tfa-hearts" aria-label={`Життів: ${hit ? Math.max(0, r.lives - 1) : r.lives}`}>
                    {Array.from({ length: n }).map((_, k) => (
                      <span key={k} className={`tfa-heart ${hit && k === n - 1 ? "lost" : ""}`}>
                        ❤
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
          {heartPhase && loseSet.size > 0 && (
            <p className="tfa-verdict">
              💀 {rows.filter((r) => loseSet.has(r.id)).map((r) => r.name).join(", ")} — мінус життя!
            </p>
          )}
        </div>
      )}
    </div>
  );
}
