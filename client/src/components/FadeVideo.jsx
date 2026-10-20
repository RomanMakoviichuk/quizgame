import { forwardRef, useState } from "react";
import "./FadeVideo.css";

/**
 * A <video> that never shows a stale picture: every new `src` gets a fresh
 * element (keyed by src), hidden until it really plays, then faded in over
 * black. Without this, swapping `src` keeps the last frame of the old clip on
 * screen until the new one has loaded — the "old scene, then the new one" glitch.
 * All other props go to the <video> as usual.
 */
const FadeVideo = forwardRef(function FadeVideo({ src, className = "", onPlaying, ...rest }, ref) {
  const [readySrc, setReadySrc] = useState(null);
  const ready = !!src && readySrc === src;
  return (
    <video
      key={src || "none"}
      ref={ref}
      src={src}
      className={`${className} fade-video ${ready ? "fade-video-on" : "fade-video-wait"}`}
      onPlaying={(e) => {
        setReadySrc(src);
        onPlaying?.(e);
      }}
      {...rest}
    />
  );
});

export default FadeVideo;
