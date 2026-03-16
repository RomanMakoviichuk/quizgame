/**
 * Game state constants for round-based flow.
 */
const GAME_STATE = {
  WAITING: "waiting",
  MAIN_SCENE: "main_scene",
  QUESTION_ANNOUNCE: "question_announce",
  QUESTION_PLAY: "question_play",
  ANSWER_PHASE: "answer_phase",
  SCORES: "scores",
  MINIGAME: "minigame",
  FINISHED: "finished",
};

const TOTAL_ROUNDS = 10;
const LIVES_PER_PLAYER = 3;
const SCORE_CORRECT = 10;
const ANSWER_TIMER_MS = 15000;

module.exports = {
  GAME_STATE,
  TOTAL_ROUNDS,
  LIVES_PER_PLAYER,
  SCORE_CORRECT,
  ANSWER_TIMER_MS,
};
