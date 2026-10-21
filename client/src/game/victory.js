/**
 * Victory sounds: every win in the game (a minigame's winner, the final's
 * champion…) plays a random one of client/public/assets/sounds/victory/N.mp3,
 * never the same one twice in a row. Add a file there and raise COUNT.
 *
 * Long tracks fade out after `maxMs`, so a fanfare never runs into the next scene.
 */
const COUNT = 7;
const DIR = "/assets/sounds/victory";
let last = 0;

/** A random victory track (not the one played last). */
export function randomVictory() {
  let n = 1 + Math.floor(Math.random() * COUNT);
  if (COUNT > 1 && n === last) n = (n % COUNT) + 1;
  last = n;
  return `${DIR}/${n}.mp3`;
}

/** Play a random victory track now; returns the element (or null). */
export function playVictory(volume = 0.5, maxMs = 8000) {
  try {
    const a = new Audio(randomVictory());
    a.volume = volume;
    a.play().catch(() => {});
    if (maxMs > 0) {
      window.setTimeout(() => {
        const fade = window.setInterval(() => {
          a.volume = Math.max(0, a.volume - volume / 10);
          if (a.volume <= 0.001) {
            window.clearInterval(fade);
            a.pause();
          }
        }, 60);
      }, maxMs);
    }
    return a;
  } catch {
    return null; // audio unavailable
  }
}
