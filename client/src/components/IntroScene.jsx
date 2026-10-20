import { useEffect, useRef, useState } from "react";
import gameClock from "../game/gameClock";

const INTRO_BASE = "/assets/intro";

export default function IntroScene({ players, onFinished }) {
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(null);
  const hasRunRef = useRef(false);
  const introAudioRef = useRef(null);
  const aliveRef = useRef(true); // false once unmounted (e.g. the admin skipped the intro)

  // The intro soundtrack is a detached Audio() (not in the DOM), so the admin
  // pause can't find it there — follow the game clock directly.
  useEffect(
    () =>
      gameClock.subscribe((isPaused) => {
        const audio = introAudioRef.current;
        if (!audio) return;
        if (isPaused) audio.pause();
        else if (audio.currentTime > 0 && !audio.ended) audio.play().catch(() => {});
      }),
    []
  );
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

  // Two <video> elements take turns: the next clip loads in the hidden one while
  // the current one plays, and is shown only once it really plays — so a scene
  // never flashes the last frame of the one before.
  const videoARef = useRef(null);
  const videoBRef = useRef(null);
  const shownRef = useRef(null); // the element on screen now
  const currentRef = useRef(null); // the element of the clip playing / starting now

  const idleVideo = () => {
    const a = videoARef.current;
    const b = videoBRef.current;
    return currentRef.current === a ? b : a;
  };

  const missingRef = useRef(new Set()); // clips that don't exist (e.g. no scene_N for a character)

  /**
   * Start loading the next clip in the hidden element. `upcoming` is the rest of
   * the order: a clip that turns out to be missing is skipped and the one after
   * it loads instead, so the swap stays seamless.
   */
  const preloadNext = (upcoming) => {
    const v = idleVideo();
    const src = upcoming.find((u) => !missingRef.current.has(u));
    if (!v || !src || v.dataset.src === src) return;
    v.dataset.src = src;
    v.src = src;
    v.preload = "auto";
    v.onerror = () => {
      v.onerror = null;
      missingRef.current.add(src);
      if (v !== currentRef.current) preloadNext(upcoming.slice(upcoming.indexOf(src) + 1));
    };
    try {
      v.load();
    } catch {}
  };

  const playVideo = (src, { withAudio = false, onMetadata } = {}) =>
    new Promise((resolve) => {
      if (missingRef.current.has(src)) return resolve();
      const video = idleVideo();
      if (!video) return resolve();
      currentRef.current = video;
      let settled = false;
      const cleanup = () => {
        video.removeEventListener("ended", handleEnded);
        video.removeEventListener("error", handleError);
        video.removeEventListener("playing", handlePlaying);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      function handleEnded() {
        done();
      }
      function handleError() {
        done(); // a missing clip (e.g. no scene_N for this character) is skipped
      }
      function handlePlaying() {
        video.removeEventListener("playing", handlePlaying);
        // swap: the new clip on screen, the old one stopped and hidden
        const old = shownRef.current;
        shownRef.current = video;
        video.classList.add("intro-video-on");
        if (old && old !== video) {
          old.classList.remove("intro-video-on");
          try {
            old.pause();
          } catch {}
        }
        onMetadata?.(video);
      }

      if (video.dataset.src !== src) {
        // never load over the picture on screen: black until the new clip plays
        if (video === shownRef.current) video.classList.remove("intro-video-on");
        video.onerror = null;
        video.dataset.src = src;
        video.src = src;
        try {
          video.load();
        } catch {}
      } else if (video.error) {
        return done(); // preloaded and already known to be missing
      }
      try {
        video.currentTime = 0;
      } catch {}
      video.muted = false;
      video.addEventListener("ended", handleEnded);
      video.addEventListener("error", handleError);
      video.addEventListener("playing", handlePlaying);

      if (withAudio) {
        let audio = introAudioRef.current;
        if (!audio) {
          audio = new Audio(`${INTRO_BASE}/music.mp3`);
          introAudioRef.current = audio;
        }
        audio.currentTime = 0;
        audio.volume = 1;
        audio.play().catch(() => {});
      }

      video.play().catch(() => done());
    });

  useEffect(() => {
    if (hasRunRef.current) {
      return;
    }
    hasRunRef.current = true;

    const run = async () => {
      const maxPlayers = Math.min(players?.length || 0, 8);
      const usedPlayers = (players || []).slice(0, maxPlayers);

      const slotOf = (p, i) =>
        p?.characterSlot && p.characterSlot >= 1 && p.characterSlot <= 8 ? p.characterSlot : i + 1;
      // the whole clip order up front, so each clip can preload the next one
      const order = [`${INTRO_BASE}/intro.mp4`];
      usedPlayers.forEach((p, i) => {
        order.push(`${INTRO_BASE}/players/${slotOf(p, i)}.mp4`, `${INTRO_BASE}/scenes/${slotOf(p, i)}.mp4`);
      });
      order.push(`${INTRO_BASE}/end.mp4`);
      let at = 0;
      const play = (src, opts) => {
        const pos = order.indexOf(src, at);
        if (pos >= 0) at = pos + 1;
        const started = playVideo(src, opts);
        // the hidden element is free once this clip is loading in the other one
        if (order[at]) setTimeout(() => preloadNext(order.slice(at)), 300);
        return started;
      };

      // 1. intro.mp4 + intro.mp3
      await play(`${INTRO_BASE}/intro.mp4`, { withAudio: true });
      if (!aliveRef.current) return;

      // 2. Reveal for each player: player_SLOT.mp4 + scene_SLOT.mp4 (SLOT = characterSlot 1..8)
      for (let i = 0; i < usedPlayers.length; i++) {
        const p = usedPlayers[i];
        const slot =
          p?.characterSlot && p.characterSlot >= 1 && p.characterSlot <= 8
            ? p.characterSlot
            : i + 1;
        // Підтягуємо тривалість відео і запускаємо анімацію гравця тільки
        // коли player_SLOT.mp4 вже завантажив metadata (щоб не було появи до відео).
        await play(`${INTRO_BASE}/players/${slot}.mp4`, {
          onMetadata: (v) => {
            const ms = Math.max(1200, Math.min(8000, Math.round((v.duration || 3) * 1000)));
            setRevealMs(ms);
            setRevealKey((k) => k + 1);
            setCurrentPlayerIndex(i);
          },
        });
        if (!aliveRef.current) return;
        setCurrentPlayerIndex(null);
        await play(`${INTRO_BASE}/scenes/${slot}.mp4`);
        if (!aliveRef.current) return;
      }

      // 3. end.mp4
      await play(`${INTRO_BASE}/end.mp4`, {
        onMetadata: (v) => {
          const durationMs = Math.round((v.duration || 0) * 1000);
          const fadeMs = 10000;
          const actualFadeMs = Math.min(fadeMs, Math.max(0, durationMs));
          const startFadeInMs = Math.max(0, durationMs - actualFadeMs);
          if (fadeTimeoutRef.current) gameClock.clearTimeout(fadeTimeoutRef.current);
          fadeTimeoutRef.current = gameClock.setTimeout(() => fadeOutIntroAudio(actualFadeMs), startFadeInMs);
        },
      });

      if (!aliveRef.current) return;
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
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (fadeTimeoutRef.current) gameClock.clearTimeout(fadeTimeoutRef.current);
      if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);
      // skipped: the intro music must not keep playing under the rules video
      try {
        introAudioRef.current?.pause();
      } catch {}
    };
  }, []);

  const activePlayer =
    currentPlayerIndex != null ? players[currentPlayerIndex] : null;

  const getAvatarSrc = (player, index) => {
    if (!player) {
      const fallbackSlot = ((index ?? 0) % 8) + 1;
      return `/assets/characters/alive/${fallbackSlot}.png`;
    }

    // 1. Якщо з сервера приходить characterSlot (1..8) — використовуємо його завжди
    if (player.characterSlot && player.characterSlot >= 1 && player.characterSlot <= 8) {
      return `/assets/characters/alive/${player.characterSlot}.png`;
    }

    // 2. Якщо є власний avatar у гравця — беремо його
    if (player.avatar) return player.avatar;

    // 3. Фолбек по індексу, як раніше
    const slot = ((index ?? 0) % 8) + 1;
    return `/assets/characters/alive/${slot}.png`;
  };

  return (
    <div className="intro-root">
      <video ref={videoARef} className="intro-video" playsInline preload="auto" />
      <video ref={videoBRef} className="intro-video" playsInline preload="auto" />

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

