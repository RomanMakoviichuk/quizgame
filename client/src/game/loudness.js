/**
 * Measured loudness of the game's media (dBFS, gated RMS over 0.4 s blocks,
 * measured in the browser from the actual files) and the level each kind of
 * sound should play at. audioLeveler.js turns the difference into a gain for
 * every <audio>/<video>, so a quiet host and a loud music bed end up where
 * they belong. Add a file here after measuring it; unknown files play as is.
 */
export const TARGET_DB = {
  voice: -14, // the host / narration in videos: always the loudest thing in the game
  sfx: -22, // short effects
  music: -26, // background music beds: well under the voice (and ducked further while it speaks)
  fanfare: -20, // victory stings (minigame triumph, a tug round won): the music steps back for them
};

export const MEASURED_DB = {
  // music beds
  "/assets/minigames/hot-bomb/background.mp3": -11.2,
  "/assets/minigames/memory/background.mp3": -14.3,
  "/assets/minigames/name-that-tune/background.mp3": -12.8,
  "/assets/minigames/rat/background.mp3": -19.8,
  "/assets/minigames/rps/background.mp3": -16,
  "/assets/minigames/tug-of-war/background.mp3": -10.5,
  "/assets/minigames/math-rush/background.mp3": -12.7,
  "/assets/final/end-music.mp3": -19.8,
  "/assets/final/music.mp3": -13.5,
  "/assets/menu/music.mp3": -11.5,
  "/assets/intro/music.mp3": -18.1,
  // voice: the host and the narrated clips
  "/assets/minigames/true-false/game.mp4": -22,
  "/assets/minigames/true-false/aftermath.mp4": -22.1,
  "/assets/rounds/question/1.mp4": -30.7,
  "/assets/rounds/question/2.mp4": -20.3,
  "/assets/rounds/question/3.mp4": -28.6,
  "/assets/rounds/question/4.mp4": -28.4,
  "/assets/rounds/announce/round-1/1.mp4": -18.9,
  "/assets/rounds/announce/round-2/1.mp4": -17.6,
  "/assets/rounds/announce/round-2/2.mp4": -20.4,
  "/assets/rounds/announce/round-3/1.mp4": -18.7,
  "/assets/rounds/announce/round-4/1.mp4": -13.8,
  "/assets/rounds/announce/round-5/2.mp4": -20,
  "/assets/rounds/announce/round-6/1.mp4": -17.2,
  "/assets/rounds/announce/round-7/1.mp4": -23.5,
  "/assets/rounds/announce/round-7/2.mp4": -20.5,
  "/assets/rounds/announce/round-8/1.mp4": -27.4,
  "/assets/rounds/announce/round-8/2.mp4": -25.2,
  "/assets/rounds/announce/round-9/1.mp4": -20.3,
  "/assets/rounds/announce/round-9/2.mp4": -20.1,
  "/assets/rounds/results/fallback/score.mp4": -11.9,
  "/assets/rounds/results/fallback/score-all-correct.mp4": -20.2,
  "/assets/rules/rules.mp4": -18.2,
  "/assets/intro/end.mp4": -16.6,
  "/assets/intro/intro.mp4": -33.1,
  "/assets/final/monster.mp4": -35.6,
  "/assets/rounds/after-round/1.mp4": -19.2,
  "/assets/rounds/after-round/2.mp4": -15.9,
  "/assets/rounds/after-round/3.mp4": -18.1,
  "/assets/rounds/after-round/4.mp4": -18.4,
  "/assets/rounds/after-round/5.mp4": -17.8,
  "/assets/rounds/after-round/6.mp4": -19.3,
  "/assets/rounds/after-round/7.mp4": -20.1,
  "/assets/rounds/after-round/8.mp4": -19.9,
  "/assets/rounds/after-round/9.mp4": -18.3,
  "/assets/rounds/results/all-correct/1.mp4": -23.5,
  "/assets/rounds/results/all-correct/2.mp4": -18.5,
  "/assets/rounds/results/all-correct/3.mp4": -15.0,
  "/assets/rounds/results/all-correct/4.mp4": -15.0,
  "/assets/rounds/results/all-correct/5.mp4": -18.3,
  "/assets/rounds/results/all-correct/6.mp4": -18.1,
  "/assets/rounds/results/all-correct/7.mp4": -16.1,
  "/assets/rounds/results/all-wrong/1.mp4": -16.0,
  "/assets/rounds/results/partial/1.mp4": -17.7,
  "/assets/rounds/results/partial/2.mp4": -17.2,
  "/assets/rounds/results/partial/3.mp4": -19.5,
  "/assets/rounds/results/partial/4.mp4": -19.0,
  "/assets/rounds/results/partial/5.mp4": -19.2,
  "/assets/rounds/results/partial/6.mp4": -19.5,
  "/assets/rounds/results/partial/7.mp4": -20.0,
  "/assets/rounds/announce/round-1/2.mp4": -18.3,
  "/assets/rounds/announce/round-5/1.mp4": -39.0,
  "/assets/minigames/tug-of-war/happy.mp3": -25.9,
  "/assets/rounds/announce/round-3/2.mp4": -31.8,
  "/assets/rounds/announce/round-4/2.mp4": -19.0,
  "/assets/rounds/announce/round-5/3.mp4": -19.3,
  "/assets/rounds/announce/round-6/2.mp4": -30.4,
  // effects
  "/assets/minigames/hot-bomb/bomb boom.mp3": -14.9,
  "/assets/minigames/hot-bomb/change player.mp3": -28.7,
  "/assets/minigames/hot-bomb/timer.mp3": -28.4,
  "/assets/minigames/rat/1.mp3": -17.7,
  "/assets/sounds/lose/1.mp3": -25.6,
  "/assets/sounds/beep.mp3": -31.4,
  "/assets/sounds/bell.mp3": -31.7,
  "/assets/sounds/death/1.mp3": -16.9,
  "/assets/sounds/kill/1.mp3": -26.9,
  "/assets/sounds/knife-slice.mp3": -19.8,
  "/assets/sounds/notification.mp3": -25,
  "/assets/sounds/result.mp3": -32.4,
  "/assets/sounds/win.mp3": -19.1,
  "/assets/minigames/rat/2.mp3": -24.1,
  "/assets/minigames/rat/3.mp3": -19.1,
  "/assets/minigames/rat/4.mp3": -22.2,
  "/assets/minigames/rat/5.mp3": -16.5,
  "/assets/minigames/rat/6.mp3": -23,
  "/assets/minigames/rat/7.mp3": -18.4,
  "/assets/minigames/rat/8.mp3": -27.1,
  "/assets/sounds/lose/2.mp3": -17.2,
  "/assets/sounds/lose/3.mp3": -18.6,
  "/assets/sounds/lose/4.mp3": -17.2,
  "/assets/sounds/chain.mp3": -15.6,
  "/assets/sounds/click.mp3": -21.4,
  "/assets/sounds/death/2.mp3": -27.2,
  "/assets/sounds/death/3.mp3": -23.7,
  "/assets/sounds/death/4.mp3": -20.5,
  "/assets/sounds/kill/2.mp3": -20.3,
  "/assets/sounds/kill/3.mp3": -16.4,
  "/assets/sounds/kill/4.mp3": -25.1,
  "/assets/sounds/typewriter.mp3": -30.9,
  // more voice
  // more music
};

/** By-ear corrections on top of the measured level (linear factor): what still sounds off in the game. */
export const TRIM = {
  "/assets/minigames/true-false/game.mp4": 1.2, // the host under the True/False round sounded quiet next to the rest
  "/assets/minigames/true-false/aftermath.mp4": 1.2,
};

const isMusic = (p) =>
  /\/background\.mp3$|\/music\.mp3$|\/end-music\.mp3$/i.test(p);
const isVoice = (p) => /\.mp4$/i.test(p);
const isFanfare = (p) => /\/sounds\/win\.mp3$|\/sounds\/victory\/|\/happy\.mp3$/i.test(p); // the music steps back under them

// the monster lurking in the final's shadow: a quiet background growl, not a voice (no ducking)
const isAmbient = (p) => /\/final\/monster\.mp4$/i.test(p);

export function kindOf(path) {
  if (isAmbient(path)) return "sfx";
  if (isMusic(path)) return "music";
  if (isFanfare(path)) return "fanfare";
  if (isVoice(path)) return "voice";
  return "sfx";
}

function pathOf(src) {
  try {
    return decodeURIComponent(new URL(src, window.location.href).pathname);
  } catch {
    return "";
  }
}

/** The kind of what an element plays ("voice" | "music" | "fanfare" | "sfx"; the tune game's songs count as music). */
export function kindOfSrc(src) {
  const path = pathOf(src);
  if (path.startsWith("/tune/")) return "music";
  return kindOf(path);
}

/** Linear gain that brings this file to its kind's target (1 when unmeasured), clamped to 0.15..10. */
export function gainFor(src) {
  const path = pathOf(src);
  const measured = MEASURED_DB[path];
  if (measured == null) return 1;
  const g = 10 ** ((TARGET_DB[kindOf(path)] - measured) / 20) * (TRIM[path] ?? 1);
  return Math.max(0.15, Math.min(10, g));
}
