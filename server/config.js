/**
 * Single source of truth for tunable game constants and environment wiring.
 * Anything a designer might want to change lives here, not scattered in server.js.
 */
const path = require("path");

module.exports = {
  PORT: process.env.PORT || 3001,

  // Legacy per-round decks (round1.json … round9.json). Still read once by the
  // content store to seed the question database on first run.
  QUESTIONS_DIR: path.join(
    __dirname,
    "..",
    "client",
    "public",
    "assets",
    "questions"
  ),

  // The question database (categories + questions). Plain JSON file, atomic
  // writes. This is what the admin panel manages and the game reads from.
  CONTENT_FILE:
    process.env.CONTENT_FILE ||
    path.join(__dirname, "content", "content.json"),

  // Admin panel password. Change it in production via the env var.
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin",
  ADMIN_TOKEN_TTL_MS: 12 * 60 * 60 * 1000, // 12h

  ANSWERS_PER_QUESTION: 4,
  QUESTION_DIFFICULTIES: ["easy", "medium", "hard"],
  // Game difficulty chosen with the category. "mixed" climbs: rounds 1-3 easy, 4-6 medium, 7-9 hard.
  GAME_DIFFICULTIES: ["easy", "medium", "hard", "mixed"],
  DEFAULT_GAME_DIFFICULTY: "mixed",

  MAX_PLAYERS: 8,
  CHARACTER_SLOTS: 8,

  TOTAL_ROUNDS: 9, // 9 quiz rounds, then the final battle
  MIN_QUESTIONS_PER_GAME: 9, // a category needs at least this many active questions
  LIVES_PER_PLAYER: 3,
  SCORE_CORRECT: 10,
  GHOST_SCORE_SHARE: 0.5, // a player who lost all lives keeps playing for half the points
  // The rating sums everything: quiz answers + minigame results.
  MINIGAME_WIN_BONUS: 10, // the minigame's single winner (resolveWinner)
  MINIGAME_SAFE_POINTS: 5, // every other contestant who kept their life
  // Who plays the minigames: with this many living players or fewer EVERYONE plays,
  // but only those who got the round's question wrong can lose a life in it; with
  // more, only the players who got it wrong play.
  SMALL_GAME_MAX_PLAYERS: 4,

  // Timings (ms)
  ANSWER_TIMER_MS: 15000, // ends earlier when everyone has answered
  INTRO_DURATION_MS: 180000, // hard cap on the cinematic intro
  ROUND1_ANSWER_DELAY_MS: 6000, // round 1: fixed delay from question start to answer phase (2.5s scene + the text)

  /** Server-authoritative phase machine. Clients mirror this in game/constants.js. */
  GAME_STATE: {
    WAITING: "waiting",
    QUESTION_ANNOUNCE: "question_announce",
    QUESTION_PLAY: "question_play",
    ANSWER_PHASE: "answer_phase",
    SCORES: "scores",
    FINAL_BATTLE: "final_battle", // after round 9 — the race to the exit (server/finalBattle.js)
    FINISHED: "finished",
  },

  /**
   * Final race (server/finalBattle.js). Track 0..EXIT; the start cell comes
   * from the rating relative to the leader: the leader starts in the middle
   * (START_MAX), 0 points on START_MIN (nearest the darkness), the rest in
   * proportion. Per question the first three correct answers (server arrival
   * order) move MOVES cells.
   */
  FINAL: {
    EXIT: 30,
    START_MIN: 6, // 0 points: the cell nearest the darkness
    START_MAX: 15, // the rating leader: the middle of the track (EXIT / 2), never further
    MOVES: [4, 3, 2], // first three correct answers; tuned so a final lasts ~7-10 questions
    MOVE_OTHER_CORRECT: 1, // every later correct answer still moves: 4-3-2-1-1-1-1
    ANSWER_MS: 10000,
    REVEAL_MS: 4500, // racers move (~1.5s), then the shadow advances and swallows (~3.4s)
    INTRO_MAX_MS: 30000, // fallback if the display never sends finalBattleIntroDone
    END_SCENE_MS: 11000, // winner / "all consumed" scene before gameFinished (then credits on the TV)
    DECK_SIZE: 40, // more than the darkness ever allows (it passes EXIT on step 13)
    SHORT_QUESTION_CHARS: 70, // shorter questions are dealt first
    DARKNESS_START: 2,
    /**
     * Darkness pace, by participant count (one schedule fits 1-8 players with
     * MOVES 4/3/2; simulated: avg 7-9 questions, 90% of games end by 9-11).
     * After `grace` questions it advances `delta` per question, phase by phase:
     * 2, 2, 4, 6, 8, 10, 13, 16, ..., 28, 31 -> past the exit on question 13.
     */
    DARKNESS: [
      {
        maxPlayers: Infinity,
        grace: 2,
        phases: [{ untilStep: 6, delta: 2 }, { untilStep: Infinity, delta: 3 }],
      },
    ],
  },
};

