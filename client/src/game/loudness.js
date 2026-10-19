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
};

export const MEASURED_DB = {
  // music beds
  "/assets/minigames/bomb/background.mp3": -11.2,
  "/assets/minigames/items/background.mp3": -14.3,
  "/assets/minigames/Name That Tune/background.mp3": -12.8,
  "/assets/minigames/rat/background.mp3": -19.8,
  "/assets/minigames/RPS/background.mp3": -16,
  "/assets/minigames/tug of war/background.mp3": -10.5,
  "/assets/minigames/tupomath/background.mp3": -12.7,
  "/assets/sounds/End Game/background.mp3": -19.8,
  "/assets/sounds/final_background.mp3": -13.5,
  "/assets/sounds/mainmenu.mp3": -11.5,
  "/assets/videos/intro/intro.mp3": -18.1,
  // voice: the host and the narrated clips
  "/assets/minigames/truefalse.mp4": -22,
  "/assets/questions/audio/round1/easy_1.mp3": -20.3,
  "/assets/questions/video/aftermg.mp4": -22.1,
  "/assets/questions/video/questions/1.mp4": -30.7,
  "/assets/questions/video/questions/2.mp4": -20.3,
  "/assets/questions/video/questions/3.mp4": -28.6,
  "/assets/questions/video/questions/5.mp4": -28.4,
  "/assets/questions/video/Round_1/1.mp4": -16.6,
  "/assets/questions/video/Round_1/2.mp4": -18.9,
  "/assets/questions/video/Round_2/1.mp4": -17.6,
  "/assets/questions/video/Round_2/2.mp4": -20.4,
  "/assets/questions/video/Round_3/1.mp4": -18.7,
  "/assets/questions/video/Round_4/1.mp4": -13.8,
  "/assets/questions/video/Round_5/1.mp4": -24.8,
  "/assets/questions/video/Round_5/2.mp4": -20,
  "/assets/questions/video/Round_6/1.mp4": -17.2,
  "/assets/questions/video/Round_7/1.mp4": -23.5,
  "/assets/questions/video/Round_7/2.mp4": -20.5,
  "/assets/questions/video/Round_8/1.mp4": -27.4,
  "/assets/questions/video/Round_8/2.mp4": -25.2,
  "/assets/questions/video/Round_9/1.mp4": -20.3,
  "/assets/questions/video/Round_9/2.mp4": -20.1,
  "/assets/questions/video/score.mp4": -11.9,
  "/assets/questions/video/score2.mp4": -20.2,
  "/assets/videos/rulesmovie.mp4": -18.2,
  "/assets/videos/intro/end.mp4": -16.6,
  "/assets/videos/intro/intro.mp4": -33.1,
  "/assets/videos/characters animations/finaly monstter.mp4": -35.6,
  "/assets/videos/rounds/after-round/after-round_1.mp4": -23.2,
  "/assets/videos/rounds/after-round/after-round_2.mp4": -23.3,
  "/assets/videos/rounds/after-round/after-round_3.mp4": -24.3,
  "/assets/videos/rounds/after-round/after-round_4.mp4": -25.5,
  "/assets/videos/rounds/after-round/after-round_5.mp4": -21.4,
  "/assets/videos/rounds/after-round/after-round_6.mp4": -22.4,
  "/assets/videos/rounds/after-round/after-round_7.mp4": -25.8,
  "/assets/videos/rounds/after-round/after-round_8.mp4": -23.1,
  "/assets/videos/rounds/after-round/after-round_9.mp4": -22.6,
  "/assets/videos/rounds/results/all-correct/all-correct_1.mp4": -22.2,
  "/assets/videos/rounds/results/all-correct/all-correct_2.mp4": -23.4,
  "/assets/videos/rounds/results/all-correct/all-correct_3.mp4": -26,
  "/assets/videos/rounds/results/all-correct/all-correct_4.mp4": -22.1,
  "/assets/videos/rounds/results/all-correct/all-correct_5.mp4": -25.6,
  "/assets/videos/rounds/results/all-correct/all-correct_6.mp4": -23.6,
  "/assets/videos/rounds/results/all-correct/all-correct_7.mp4": -22.1,
  "/assets/videos/rounds/results/all-wrong/all-wrong_1.mp4": -22.3,
  "/assets/videos/rounds/results/partial/partial_1.mp4": -25,
  "/assets/videos/rounds/results/partial/partial_2.mp4": -24.6,
  "/assets/videos/rounds/results/partial/partial_3.mp4": -25.8,
  "/assets/videos/rounds/results/partial/partial_4.mp4": -25.4,
  "/assets/videos/rounds/results/partial/partial_5.mp4": -22,
  "/assets/videos/rounds/results/partial/partial_6.mp4": -25.1,
  "/assets/videos/rounds/results/partial/partial_7.mp4": -25.2,
  "/assets/videos/rounds/results/partial/partial_8.mp4": -29.3,
  // effects
  "/assets/minigames/bomb/bomb boom.mp3": -14.9,
  "/assets/minigames/bomb/change player.mp3": -28.7,
  "/assets/minigames/bomb/timer.mp3": -28.4,
  "/assets/minigames/rat/1.mp3": -17.7,
  "/assets/minigames/RPS/lose_1.mp3": -25.6,
  "/assets/sounds/beep.mp3": -31.4,
  "/assets/sounds/bell.mp3": -31.7,
  "/assets/sounds/Death sounds/1.mp3": -16.9,
  "/assets/sounds/Kill sounds/1.mp3": -26.9,
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
  "/assets/minigames/RPS/lose_2.mp3": -17.2,
  "/assets/minigames/RPS/lose_3.mp3": -18.6,
  "/assets/minigames/RPS/lose_4.mp3": -17.2,
  "/assets/sounds/chain.mp3": -15.6,
  "/assets/sounds/click-sound.mp3": -21.4,
  "/assets/sounds/Death sounds/2.mp3": -27.2,
  "/assets/sounds/Death sounds/3.mp3": -23.7,
  "/assets/sounds/Death sounds/4.mp3": -20.5,
  "/assets/sounds/Death sounds/5.mp3": -18.1,
  "/assets/sounds/Death sounds/6.mp3": -14.9,
  "/assets/sounds/Death sounds/7.mp3": -13.4,
  "/assets/sounds/Kill sounds/2.mp3": -20.3,
  "/assets/sounds/Kill sounds/3.mp3": -16.4,
  "/assets/sounds/Kill sounds/4.mp3": -25.1,
  "/assets/sounds/typewriter.mp3": -30.9,
  // more voice
  "/assets/questions/audio/round1/easy_2.mp3": -22.2,
  "/assets/questions/audio/round1/easy_3.mp3": -22.4,
  "/assets/questions/audio/round1/easy_4.mp3": -22.3,
  "/assets/questions/audio/round1/easy_5.mp3": -20.9,
  "/assets/questions/audio/round1/easy_6.mp3": -22.2,
  "/assets/questions/audio/round1/easy_7.mp3": -21.5,
  "/assets/questions/audio/round1/easy_8.mp3": -21.9,
  "/assets/questions/audio/round1/easy_9.mp3": -23.5,
  "/assets/questions/audio/round1/easy_10.mp3": -22.9,
  "/assets/videos/intro/end-.mp4": -14.6,
  // more music
  "/assets/sounds/game-scene-background-sound-material.mp3": -18.9,
};

const isMusic = (p) =>
  /\/background\.mp3$|\/mainmenu\.mp3$|final_background\.mp3$|\/intro\/intro\.mp3$|background-sound-material\.mp3$/i.test(p);
const isVoice = (p) => /\.mp4$/i.test(p) || /\/questions\/audio\//i.test(p);

export function kindOf(path) {
  if (isMusic(path)) return "music";
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

/** The kind of what an element plays ("voice" | "music" | "sfx"; the tune game's songs count as music). */
export function kindOfSrc(src) {
  const path = pathOf(src);
  if (path.startsWith("/tune/")) return "music";
  return kindOf(path);
}

/** Linear gain that brings this file to its kind's target (1 when unmeasured), clamped to 0.15..6. */
export function gainFor(src) {
  const path = pathOf(src);
  const measured = MEASURED_DB[path];
  if (measured == null) return 1;
  const g = 10 ** ((TARGET_DB[kindOf(path)] - measured) / 20);
  return Math.max(0.15, Math.min(6, g));
}
