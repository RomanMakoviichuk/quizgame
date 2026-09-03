/**
 * Single source of truth for tunable game constants and environment wiring.
 * Anything a designer might want to change lives here, not scattered in server.js.
 */
const path = require("path");

module.exports = {
  PORT: process.env.PORT || 3001,

  // Questions ship inside the client app (served by CRA / the client build).
  QUESTIONS_DIR: path.join(
    __dirname,
    "..",
    "client",
    "public",
    "assets",
    "questions"
  ),

  MAX_PLAYERS: 8,
  CHARACTER_SLOTS: 8,

  TOTAL_ROUNDS: 9, // 9 quiz rounds, then the final battle
  LIVES_PER_PLAYER: 3,
  SCORE_CORRECT: 10,

  // Timings (ms)
  ANSWER_TIMER_MS: 15000,
  INTRO_DURATION_MS: 180000, // hard cap on the cinematic intro
  ROUND1_ANSWER_DELAY_MS: 6000, // round 1: fixed delay from question start to answer phase

  VALID_DIFFICULTIES: ["easy", "medium", "hard"],
  DEFAULT_DIFFICULTY: "easy",

  /** Server-authoritative phase machine. Clients mirror this in game/constants.js. */
  GAME_STATE: {
    WAITING: "waiting",
    QUESTION_ANNOUNCE: "question_announce",
    QUESTION_PLAY: "question_play",
    ANSWER_PHASE: "answer_phase",
    SCORES: "scores",
    FINAL_BATTLE: "final_battle", // after round 9 — placeholder until video + rules are ready
    FINISHED: "finished",
  },

  FINAL_BATTLE_PLACEHOLDER_MS: 6000, // display shows the caption this long, then finishes
};
