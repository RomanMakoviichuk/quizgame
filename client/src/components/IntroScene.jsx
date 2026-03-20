import { useEffect, useRef, useState } from "react";

const INTRO_BASE = "/assets/videos/intro";

export default function IntroScene({ players, onFinished }) {
  const videoRef = useRef(null);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(null);
  const hasRunRef = useRef(false);
  const introAudioRef = useRef(null);
  const [revealMs, setRevealMs] = useState(3000);
  const [revealKey, setRevealKey] = useState(0);
  const fadeTimeoutRef = useRef(null);
  const fadeRafRef = useRef(null);

  const fadeOutIntroAudio = (fadeMs = 5000) => {
    const audio = introAudioRef.current;
    if (!audio) return;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const startVol = clamp01(Number.isFinite(audio.volume) ? audio.volume : 1);
    if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / Math.max(1, fadeMs));
      audio.volume = clamp01(startVol * (1 - t));
      if (t < 1 && !audio.paused) fadeRafRef.current = requestAnimationFrame(tick);
    };
    fadeRafRef.current = requestAnimationFrame(tick);
  };

  const playVideo = (src, { withAudio = false, onMetadata } = {}) =>
    new Promise((resolve) => {
      const video = videoRef.current;
      if (!video) return resolve();

      const handleEnded = () => {
        video.removeEventListener("ended", handleEnded);
        video.removeEventListener("error", handleError);
        resolve();
      };

      const handleError = (e) => {
        video.removeEventListener("ended", handleEnded);
        video.removeEventListener("error", handleError);
        resolve();
      };

      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.onloadedmetadata = null;

      // зупиняємо попереднє відео перед новим load()
      try {
        video.pause();
      } catch {}

      video.src = src;
      video.currentTime = 0;
      video.load();
      video.addEventListener("ended", handleEnded);
      video.addEventListener("error", handleError);
      video.onloadedmetadata = () => {
        onMetadata?.(video);
      };

      if (withAudio) {
        let audio = introAudioRef.current;
        if (!audio) {
          audio = new Audio(`${INTRO_BASE}/intro.mp3`);
          introAudioRef.current = audio;
        }
        audio.currentTime = 0;
        audio.volume = 1;
        audio.play().catch(() => {});
      }

      video.play().catch((err) => {
        resolve();
      });
    });

  useEffect(() => {
    if (hasRunRef.current) {
      return;
    }
    hasRunRef.current = true;

    const run = async () => {
      const maxPlayers = Math.min(players?.length || 0, 8);
      const usedPlayers = (players || []).slice(0, maxPlayers);

      // 1. intro.mp4 + intro.mp3
      await playVideo(`${INTRO_BASE}/intro.mp4`, { withAudio: true });

      // 2. Reveal for each player: player_SLOT.mp4 + scene_SLOT.mp4 (SLOT = characterSlot 1..8)
      for (let i = 0; i < usedPlayers.length; i++) {
        const p = usedPlayers[i];
        const slot =
          p?.characterSlot && p.characterSlot >= 1 && p.characterSlot <= 8
            ? p.characterSlot
            : i + 1;
        // Підтягуємо тривалість відео і запускаємо анімацію гравця тільки
        // коли player_SLOT.mp4 вже завантажив metadata (щоб не було появи до відео).
        await playVideo(`${INTRO_BASE}/player_${slot}.mp4`, {
          onMetadata: (v) => {
            const ms = Math.max(1200, Math.min(8000, Math.round((v.duration || 3) * 1000)));
            setRevealMs(ms);
            setRevealKey((k) => k + 1);
            setCurrentPlayerIndex(i);
          },
        });
        setCurrentPlayerIndex(null);
        await playVideo(`${INTRO_BASE}/scene_${slot}.mp4`);
      }

      // 3. end.mp4
      await playVideo(`${INTRO_BASE}/end.mp4`, {
        onMetadata: (v) => {
          const durationMs = Math.round((v.duration || 0) * 1000);
          const fadeMs = 10000;
          const actualFadeMs = Math.min(fadeMs, Math.max(0, durationMs));
          const startFadeInMs = Math.max(0, durationMs - actualFadeMs);
          if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
          fadeTimeoutRef.current = setTimeout(() => fadeOutIntroAudio(actualFadeMs), startFadeInMs);
        },
      });

      setCurrentPlayerIndex(null);
      // зупинити intro.mp3 після завершення інтро
      if (introAudioRef.current) {
        try {
          introAudioRef.current.pause();
          introAudioRef.current.currentTime = 0;
          introAudioRef.current.volume = 1;
        } catch {}
      }
      onFinished?.();
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);
    };
  }, []);

  const activePlayer =
    currentPlayerIndex != null ? players[currentPlayerIndex] : null;

  const getAvatarSrc = (player, index) => {
    if (!player) {
      const fallbackSlot = ((index ?? 0) % 8) + 1;
      return `/assets/images/Characters/alivecharacters/${fallbackSlot}.png`;
    }

    // 1. Якщо з сервера приходить characterSlot (1..8) — використовуємо його завжди
    if (player.characterSlot && player.characterSlot >= 1 && player.characterSlot <= 8) {
      return `/assets/images/Characters/alivecharacters/${player.characterSlot}.png`;
    }

    // 2. Якщо є власний avatar у гравця — беремо його
    if (player.avatar) return player.avatar;

    // 3. Фолбек по індексу, як раніше
    const slot = ((index ?? 0) % 8) + 1;
    return `/assets/images/Characters/alivecharacters/${slot}.png`;
  };

  return (
    <div className="intro-root">
      <video
        ref={videoRef}
        className="intro-video"
        playsInline
        muted={false}
      />

      {activePlayer && (
        <div className="player-overlay" style={{ ["--reveal-ms"]: `${revealMs}ms` }}>
          <div className="player-name player-name-intro player-name-anim player-name-topright" key={revealKey}>
            {activePlayer.name}
          </div>
        </div>
      )}
    </div>
  );
}

