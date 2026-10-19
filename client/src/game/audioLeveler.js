import { gainFor, kindOfSrc } from "./loudness";

/**
 * One loudness for the whole game on the TV, the host's voice on top.
 *
 * Every <audio> / <video> / new Audio() is routed, the first time it plays,
 * through its own gain (loudness.js: the file's measured level -> the level
 * of its kind: voice -14 dB > effects -22 dB > music -26 dB) and then one
 * shared chain: a gentle compressor that evens out what is left, and a
 * limiter so nothing ever peaks. While any voice plays, every music bed is
 * ducked a further 6 dB and comes back smoothly when the voice stops. The gain
 * follows the element when its src changes (the background video switches
 * clips). The volumes set in code still work (fades, ducking in the tune game).
 *
 * Elements are only routed while the audio context is running (it starts on
 * the first click/tap), so nothing is ever silenced by the autoplay policy.
 * Elements already taken by another Web Audio graph (the tune analyser) are
 * left alone. Not used on phones.
 */
const DUCK = 0.5; // music under a speaking voice: -6 dB
const DUCK_TIME = 0.25; // seconds (time constant) for the music to dip / come back

let ctx = null;
let input = null;
const routed = new WeakSet();
const tracks = new Set(); // { el, gain, base, kind }

function build() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  ctx = new Ctx();
  const leveler = ctx.createDynamicsCompressor();
  leveler.threshold.value = -18;
  leveler.knee.value = 10;
  leveler.ratio.value = 2.5;
  leveler.attack.value = 0.01;
  leveler.release.value = 0.3;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.15;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  leveler.connect(makeup);
  makeup.connect(limiter);
  limiter.connect(ctx.destination);
  input = leveler;
  return true;
}

// (new Audio() elements are never in the page, so "playing" is the only test)
const speaking = () => [...tracks].some((t) => t.kind === "voice" && !t.el.paused && !t.el.ended);

/** Duck or restore every music bed after any voice starts or stops. */
function updateDucking() {
  const duck = speaking();
  for (const t of tracks) {
    const target = t.kind === "music" && duck ? t.base * DUCK : t.base;
    t.gain.gain.setTargetAtTime(target, ctx.currentTime, DUCK_TIME);
  }
}

function route(el) {
  if (!ctx || ctx.state !== "running" || routed.has(el)) return;
  routed.add(el); // also when it fails: never try the same element twice
  try {
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const track = { el, gain, base: 1, kind: "sfx" };
    const fit = () => {
      const src = el.currentSrc || el.src;
      track.kind = kindOfSrc(src);
      track.base = gainFor(src);
      gain.gain.value = track.base;
      updateDucking();
    };
    fit();
    el.addEventListener("loadedmetadata", fit); // a new src on the same element
    ["playing", "pause", "ended", "emptied"].forEach((ev) => el.addEventListener(ev, updateDucking));
    // a one-shot effect is forgotten when it ends (looping beds and videos stay)
    el.addEventListener("ended", () => {
      if (!el.loop) tracks.delete(track);
    });
    source.connect(gain);
    gain.connect(input);
    tracks.add(track);
  } catch {
    /* already in another graph (e.g. the tune analyser) — it plays as it is */
  }
}

export function installAudioLeveler() {
  if (typeof window === "undefined" || ctx || !build()) return;
  const resume = () => {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => window.addEventListener(ev, resume, { passive: true }));
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function levelAndPlay(...args) {
    route(this);
    return play.apply(this, args);
  };
}
