import { useEffect, useState } from "react";

/**
 * «Увімкнути звук» (TV only). The browser plays nothing with sound until the page
 * has had a click — a TV page reloaded mid-game would stay silent. This button
 * shows whenever a sound was refused (audioLeveler.js fires "sound-blocked");
 * the click itself brings every refused sound back, then the button goes away.
 */
export default function SoundUnlock() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = () => {
      if (!navigator.userActivation?.hasBeenActive) setShown(true);
    };
    const hide = () => setShown(false);
    window.addEventListener("sound-blocked", show);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("keydown", hide);
    return () => {
      window.removeEventListener("sound-blocked", show);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("keydown", hide);
    };
  }, []);
  if (!shown) return null;
  return (
    <button
      type="button"
      onClick={() => setShown(false)}
      style={{
        position: "fixed",
        left: "50%",
        bottom: "1.5rem",
        transform: "translateX(-50%)",
        zIndex: 10000,
        padding: "0.8rem 1.6rem",
        borderRadius: 999,
        border: "2px solid rgba(255,255,255,0.35)",
        background: "rgba(139,0,0,0.85)",
        color: "#fff",
        font: "700 1.1rem 'Playpen Sans', cursive",
        boxShadow: "0 0 24px rgba(255,45,68,0.6)",
        cursor: "pointer",
      }}
    >
      🔊 Натисніть, щоб увімкнути звук
    </button>
  );
}
