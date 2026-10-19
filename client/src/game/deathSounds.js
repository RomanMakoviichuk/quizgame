/**
 * Kill + death sounds — played on the display when a character dies: losing the
 * last life in the main game (becoming a ghost) or being swallowed by the shadow
 * in the final. A random "kill" hit first, then a random death sound right
 * after it. Never the same clip twice in a row within a folder.
 */
import gameClock from "./gameClock";

const folder = (name, count) =>
  Array.from({ length: count }, (_, i) => `/assets/sounds/${encodeURIComponent(name)}/${i + 1}.mp3`);

const KILL_SOUNDS = folder("Kill sounds", 5);
const DEATH_SOUNDS = folder("Death sounds", 6);
const KILL_TO_DEATH_MS = 550;

function picker(list) {
  let last = -1;
  return () => {
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === last) i = (i + 1) % list.length;
    last = i;
    return list[i];
  };
}
const nextKill = picker(KILL_SOUNDS);
const nextDeath = picker(DEATH_SOUNDS);

function playOnce(src, volume) {
  if (typeof Audio === "undefined") return;
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {}
}

export function playKillSound(volume = 1) {
  playOnce(nextKill(), volume);
}

export function playDeathSound(volume = 0.9) {
  playOnce(nextDeath(), volume);
}

/** The whole death: kill hit now, death sound a moment later (pause-aware). */
export function playKillAndDeath(volume = 0.95) {
  playKillSound(volume);
  gameClock.setTimeout(() => playDeathSound(volume), KILL_TO_DEATH_MS);
}

/** Warm the cache so the first death isn't silent while the files download. */
export function preloadDeathSounds() {
  if (typeof Audio === "undefined") return;
  [...KILL_SOUNDS, ...DEATH_SOUNDS].forEach((src) => {
    try {
      const a = new Audio();
      a.preload = "auto";
      a.src = src;
    } catch {}
  });
}
