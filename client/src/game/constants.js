/**
 * Client mirror of the server phase machine (server/config.js GAME_STATE).
 * Keep the string values identical on both sides.
 */
export const GAME_PHASE = {
  WAITING: "waiting",
  QUESTION_ANNOUNCE: "question_announce",
  QUESTION_PLAY: "question_play",
  ANSWER_PHASE: "answer_phase",
  SCORES: "scores",
  FINAL_BATTLE: "final_battle",
  FINISHED: "finished",
};

/** Number of quiz rounds before the final battle (server: config.js TOTAL_ROUNDS). */
export const TOTAL_ROUNDS = 9;
