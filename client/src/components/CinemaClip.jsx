import { useEffect, useRef, useState } from "react";
import gameClock from "../game/gameClock";
import { markAutoMuted } from "../game/audioLeveler";
import "./CinemaClip.css";

/**
 * A full-screen clip between game scenes (display only):
 *   black -> fades the picture and the sound in once it really plays
 *   -> fades both out over the last `fadeOutMs` -> a short black breath
 *   (`holdMs`) -> onDone() once.
 * It can never stall the game: a broken file, a blocked autoplay or a clip
 * that never ends all lead to onDone() (a safety timer on the game clock,
 * so a pause doesn't trip it).
 *
 * layer "top"   — covers everything (round announcements)
 * layer "under" — sits under the game UI (the results sequence)
 */
export default function CinemaClip({
  src,
  onDone,
  volume = 1,
  fit = "cover",
  layer = "top",
  fadeInMs = 700,
  fadeOutMs = 700,
  holdMs = 100, // the clips end with their own black: no long extra hold
}) {
  const videoRef = useRef(null);
  const [stage, setStage] = useState("wait"); // wait | on | off
  const doneRef = useRef(false);
  const fadingOutRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const timers = useRef({ safety: null, hold: null, ramp: null });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const t = timers.current;

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current?.();
    };
    // sound follows the picture (the CSS transition does the opacity)
    const rampTo = (target, ms) => {
      window.clearInterval(t.ramp);
      const from = v.volume;
      const t0 = performance.now();
      t.ramp = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
        try {
          v.volume = Math.max(0, Math.min(1, from + (target - from) * k));
        } catch {
          /* detached */
        }
        if (k >= 1) window.clearInterval(t.ramp);
      }, 40);
    };
    const fadeOut = () => {
      if (fadingOutRef.current) return;
      fadingOutRef.current = true;
      setStage("off");
      rampTo(0, fadeOutMs);
    };
    const armSafety = (ms) => {
      gameClock.clearTimeout(t.safety);
      t.safety = gameClock.setTimeout(() => {
        fadeOut();
        t.hold = gameClock.setTimeout(finish, fadeOutMs + holdMs);
      }, ms);
    };

    const onPlaying = () => {
      // two frames later, so the browser has painted the invisible start and the fade really runs
      requestAnimationFrame(() => requestAnimationFrame(() => setStage((s) => (s === "wait" ? "on" : s))));
      if (!fadingOutRef.current) rampTo(volume, fadeInMs);
    };
    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) armSafety(v.duration * 1000 + 4000);
    };
    const onTime = () => {
      if (Number.isFinite(v.duration) && v.duration - v.currentTime <= fadeOutMs / 1000) fadeOut();
    };
    const onEnded = () => {
      fadeOut();
      gameClock.clearTimeout(t.hold);
      t.hold = gameClock.setTimeout(finish, holdMs);
    };
    const onError = () => {
      gameClock.clearTimeout(t.hold);
      t.hold = gameClock.setTimeout(finish, 150);
    };

    v.volume = 0;
    v.addEventListener("playing", onPlaying);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    armSafety(30000); // until the real length is known
    const playMuted = () => {
      // sound refused (no click on this page yet): play muted, the sound comes back on the first click
      v.muted = true;
      markAutoMuted(v);
      v.play().catch(onError);
    };
    v.play().catch((err) => {
      // only a refused autoplay mutes the clip; an interrupted play (a new load) just tries again with sound
      if (err?.name === "NotAllowedError") playMuted();
      else v.play().catch((e) => (e?.name === "NotAllowedError" ? playMuted() : onError()));
    });

    return () => {
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
      gameClock.clearTimeout(t.safety);
      gameClock.clearTimeout(t.hold);
      window.clearInterval(t.ramp);
    };
    // one clip per mount (the parent keys it by src)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`cinema-clip layer-${layer} st-${stage}`} style={{ "--cc-in": `${fadeInMs}ms`, "--cc-out": `${fadeOutMs}ms` }}>
      <video ref={videoRef} className={`cinema-clip-video fit-${fit}`} src={src} playsInline preload="auto" />
    </div>
  );
}
