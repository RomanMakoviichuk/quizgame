/**
 * Phase machine wiring: rating, lives -> ghost, minigame bonus, and the final
 * race end to end (fake io + mocked timers). Own process, so CONTENT_FILE can
 * point at a temp file.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const TMP = path.join(os.tmpdir(), `quizgame-phases-${crypto.randomBytes(6).toString("hex")}.json`);
process.env.CONTENT_FILE = TMP;

const test = require("node:test");
const assert = require("node:assert/strict");

const store = require("./content/store");
const createPhases = require("./phases");
const rooms = require("./rooms");
const { GAME_STATE, TOTAL_ROUNDS, FINAL, LIVES_PER_PLAYER } = require("./config");

test.after(() => {
  try {
    fs.unlinkSync(TMP);
  } catch {}
});

store._reset({
  version: 1,
  categories: [
    { id: "cat", name: "Тест", slug: "test", description: null, icon: "?", isActive: true, createdAt: "x", updatedAt: "x" },
  ],
  questions: Array.from({ length: 30 }, (_, i) => ({
    id: `q${i}`,
    categoryId: "cat",
    type: "single",
    text: `Питання ${i}?`,
    difficulty: null,
    isActive: true,
    order: i,
    answers: [
      { id: `a${i}0`, text: `A${i}`, isCorrect: true },
      { id: `a${i}1`, text: `B${i}`, isCorrect: false },
      { id: `a${i}2`, text: `C${i}`, isCorrect: false },
      { id: `a${i}3`, text: `D${i}`, isCorrect: false },
    ],
    explanation: null,
    mediaUrl: null,
    tags: [],
    createdAt: "x",
    updatedAt: "x",
  })),
});

function fakeIo() {
  const log = [];
  return {
    log,
    to: (target) => ({ emit: (event, data) => log.push({ target, event, data }) }),
  };
}

const events = (io, name) => io.log.filter((e) => e.event === name);

/** A room mid-game with `n` players and 9 scripted rounds (correctIndex 0). */
function setup(n = 3) {
  const io = fakeIo();
  const phases = createPhases(io);
  const room = rooms.createRoom("display-sock", "cat");
  const players = [];
  for (let i = 0; i < n; i++) players.push(rooms.addPlayer(room, `sock${i}`, `P${i}`));
  room.rounds = Array.from({ length: TOTAL_ROUNDS }, (_, i) => ({
    roundIndex: i + 1,
    question: { id: `q${i}`, text: `Q${i}`, options: ["a", "b", "c", "d"], correctIndex: 0 },
  }));
  room.currentRoundIndex = 0;
  room.gameState = GAME_STATE.ANSWER_PHASE;
  const cleanup = () => rooms.deleteRoom(room.code);
  return { io, phases, room, players, cleanup };
}

/** A minigame result as if it had been played: given losers / winner. */
function fakeResolvedMinigame(room, { losers = [], winner = null }) {
  room.minigame = {
    minigameId: "fake",
    roundIndex: room.currentRoundIndex + 1,
    contestantIds: [...room.players.values()].map((p) => p.id),
    def: {},
    resolved: true,
    livesApplied: false,
    pendingLoserIds: losers,
    pendingWinnerId: winner,
  };
  room.gameState = GAME_STATE.SCORES;
  room.scoresVideoDone = false; // keep the round from advancing in these tests
}

// ------------------------------------------------------------------ rating

test("a living player's correct answer adds 10, a wrong one adds 0", (t) => {
  const { io, phases, room, players, cleanup } = setup(2);
  t.after(cleanup);
  phases.submitAnswer(room, "sock0", 0);
  phases.submitAnswer(room, "sock1", 2);
  assert.equal(players[0].score, 10);
  assert.equal(players[1].score, 0);
  const res = events(io, "answerResult");
  assert.equal(res[0].data.scoreAwarded, 10);
  assert.equal(res[1].data.scoreAwarded, 0);
});

test("a ghost keeps answering, but its rating stays frozen", (t) => {
  const { io, phases, room, players, cleanup } = setup(2);
  t.after(cleanup);
  players[0].score = 30;
  players[0].isGhost = true;
  players[0].lives = 0;
  phases.submitAnswer(room, "sock0", 0);
  assert.equal(players[0].hasAnswered, true); // the answer is accepted…
  assert.equal(players[0].score, 30); // …but scores nothing
  const res = events(io, "answerResult")[0].data;
  assert.equal(res.correct, true);
  assert.equal(res.scoreAwarded, 0);
  assert.equal(res.isGhost, true);
  assert.equal(phases.awardScore(players[0], 1), 0);
  assert.equal(players[0].score, 30);
});

// ------------------------------------------------------------------- lives

test("losing the last life turns a player into a ghost, exactly once", (t) => {
  const { phases, room, players, cleanup } = setup(3);
  t.after(cleanup);
  players[0].lives = 1;
  fakeResolvedMinigame(room, { losers: [players[0].id] });
  phases.applyMinigameLives(room);
  assert.equal(players[0].lives, 0);
  assert.equal(players[0].isGhost, true);
  assert.equal(players[0].diedAtRound, 1);

  // a ghost can't lose more lives even if a minigame named it
  fakeResolvedMinigame(room, { losers: [players[0].id] });
  phases.applyMinigameLives(room);
  assert.equal(players[0].lives, 0);
  assert.equal(players[0].diedAtRound, 1);
});

test("a life lost above zero keeps the player alive", (t) => {
  const { phases, room, players, cleanup } = setup(3);
  t.after(cleanup);
  fakeResolvedMinigame(room, { losers: [players[1].id] });
  phases.applyMinigameLives(room);
  assert.equal(players[1].lives, LIVES_PER_PLAYER - 1);
  assert.equal(players[1].isGhost, false);
});

test("minigame points: winner +10, other survivors +5, losers 0 — once; a ghost gets nothing", (t) => {
  const { phases, room, players, cleanup } = setup(3);
  t.after(cleanup);
  fakeResolvedMinigame(room, { winner: players[2].id, losers: [players[0].id] });
  phases.applyMinigameLives(room);
  phases.applyMinigameLives(room); // duplicate aftermath handshake
  assert.equal(players[2].score, 10);
  assert.equal(players[1].score, 5);
  assert.equal(players[0].score, 0);
  players.forEach((p) => (p.score = 0));

  players[1].isGhost = true;
  fakeResolvedMinigame(room, { winner: players[1].id });
  phases.applyMinigameLives(room);
  assert.equal(players[1].score, 0);
  assert.equal(players[2].score, 5); // survived, not the winner this time
});

test("ghosts sit minigames out; one survivor -> no minigame", (t) => {
  const { phases, room, players, cleanup } = setup(3);
  t.after(cleanup);
  players[0].isGhost = true;
  // everybody wrong -> True/False (round 1) among the living only
  for (const p of players) {
    p.hasAnswered = true;
    p.lastAnswerIndex = 3;
  }
  phases.emitScores(room);
  assert.ok(room.minigame);
  assert.deepEqual(room.minigame.contestantIds.sort(), [players[1].id, players[2].id].sort());

  players[1].isGhost = true;
  phases.emitScores(room);
  assert.equal(room.minigame, null);
});

// ------------------------------------------------------------------- final

test("the final starts once after round 9, with ghosts in the race", (t) => {
  const { io, phases, room, players, cleanup } = setup(3);
  t.after(cleanup);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  players[1].isGhost = true;
  room.currentRoundIndex = TOTAL_ROUNDS - 1;
  room.gameState = GAME_STATE.SCORES;
  room.roundAdvanced = false;
  phases.advanceRound(room);
  phases.advanceRound(room); // duplicate
  phases.startFinalBattle(room); // and a direct second call
  assert.equal(room.gameState, GAME_STATE.FINAL_BATTLE);
  const starts = events(io, "finalBattle");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].data.participants.length, 3);
  assert.equal(starts[0].data.participants.find((p) => p.id === players[1].id).wasGhost, true);
  // the final deck skips the 9 questions already played
  const played = new Set(room.rounds.map((r) => r.question.id));
  assert.ok(room.finalDeck.slice(0, 21).every((q) => !played.has(q.id)));
});

test("final race end to end: questions, 3/2/1, winner once, gameFinished", (t) => {
  const { io, phases, room, players, cleanup } = setup(3);
  t.after(cleanup);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  players[0].score = 90; // the leader: starts in the middle (15)
  players[2].isGhost = true; // 0 points: starts on 6, still races
  room.currentRoundIndex = TOTAL_ROUNDS;
  phases.startFinalBattle(room);
  phases.handleFinalIntroDone(room);
  phases.handleFinalIntroDone(room); // duplicate: no second question
  assert.equal(events(io, "finalQuestion").length, 1);

  const [a, b, ghost] = players.map((p) => p.id);
  let guard = 0;
  while (room.gameState === GAME_STATE.FINAL_BATTLE && room.finalBattle.stage === "question" && guard++ < 50) {
    const q = room.finalDeck[room.finalBattle.step - 1];
    // ghost answers first, then a, then b answers wrong
    phases.submitFinalAnswer(room, ghost, q.correctIndex);
    phases.submitFinalAnswer(room, ghost, q.correctIndex); // dup — ignored
    phases.submitFinalAnswer(room, a, q.correctIndex);
    phases.submitFinalAnswer(room, b, (q.correctIndex + 1) % 4);
    // all answered -> resolved immediately; next question after REVEAL_MS
    t.mock.timers.tick(FINAL.REVEAL_MS);
  }
  const results = events(io, "finalStepResult");
  const first = results[0].data;
  assert.deepEqual(
    first.movers.map((m) => [m.id, m.to - m.from]),
    [[ghost, 4], [a, 3]]
  );
  const winners = results.filter((r) => r.data.winnerId);
  assert.equal(winners.length, 1);
  // a starts 15 (+3/step) and reaches 30 on step 5; the ghost from 6 (+4/step) only on step 6
  assert.equal(winners[0].data.winnerId, a);
  // rating untouched by the race
  assert.equal(players[2].score, 0);
  assert.equal(players[0].score, 90);

  t.mock.timers.tick(FINAL.END_SCENE_MS);
  const fin = events(io, "gameFinished");
  assert.equal(fin.length, 1);
  assert.equal(fin[0].data.winnerId, a);
  assert.equal(fin[0].data.standings[0].id, a);
  assert.equal(room.gameState, GAME_STATE.FINISHED);
  phases.finishGame(room);
  assert.equal(events(io, "gameFinished").length, 1);
});

test("final: unanswered questions time out and the darkness ends the game", (t) => {
  const { io, phases, room, cleanup } = setup(2);
  t.after(cleanup);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  room.currentRoundIndex = TOTAL_ROUNDS;
  phases.startFinalBattle(room);
  t.mock.timers.tick(FINAL.INTRO_MAX_MS); // display never sent IntroDone
  for (let i = 0; i < 40 && room.gameState === GAME_STATE.FINAL_BATTLE; i++) {
    t.mock.timers.tick(FINAL.ANSWER_MS);
    t.mock.timers.tick(Math.max(FINAL.REVEAL_MS, FINAL.END_SCENE_MS));
  }
  const fin = events(io, "gameFinished");
  assert.equal(fin.length, 1);
  assert.equal(fin[0].data.ending, "all_consumed");
  assert.equal(fin[0].data.winnerId, null);
});

test("pause: the answer window and the final race stand still until resume", (t) => {
  const clock = require("./clock");
  const { ANSWER_TIMER_MS } = require("./config");
  const { io, phases, room, cleanup } = setup(2);
  t.after(cleanup);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });

  // main quiz: 15s answer window
  room.gameState = GAME_STATE.QUESTION_PLAY;
  phases.startAnswerPhase(room);
  t.mock.timers.tick(5000);
  clock.pause(room);
  t.mock.timers.tick(120_000);
  assert.equal(room.gameState, GAME_STATE.ANSWER_PHASE); // frozen, not timed out
  clock.resume(room);
  t.mock.timers.tick(ANSWER_TIMER_MS - 5000);
  assert.equal(room.gameState, GAME_STATE.SCORES);

  // final race: the question deadline sent to phones is in game time
  room.currentRoundIndex = TOTAL_ROUNDS;
  room.gameState = GAME_STATE.SCORES;
  phases.startFinalBattle(room);
  phases.handleFinalIntroDone(room);
  const q = events(io, "finalQuestion")[0].data;
  assert.equal(q.endsAt - q.serverNow, FINAL.ANSWER_MS);
  clock.pause(room);
  t.mock.timers.tick(FINAL.ANSWER_MS * 3);
  assert.equal(events(io, "finalStepResult").length, 0);
  clock.resume(room);
  t.mock.timers.tick(FINAL.ANSWER_MS);
  assert.equal(events(io, "finalStepResult").length, 1);
});

test("everyone dead before the final -> the game ends in a draw, no race", (t) => {
  const { io, phases, room, players, cleanup } = setup(3);
  t.after(cleanup);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  players.forEach((p) => {
    p.lives = 0;
    p.isGhost = true;
  });
  players[1].score = 40;
  room.currentRoundIndex = 4; // mid-game, not even round 9
  room.gameState = GAME_STATE.SCORES;
  room.roundAdvanced = false;
  phases.advanceRound(room);

  assert.equal(room.gameState, GAME_STATE.FINISHED);
  assert.equal(events(io, "finalBattle").length, 0);
  assert.equal(events(io, "questionAnnounce").length, 0);
  const fin = events(io, "gameFinished");
  assert.equal(fin.length, 1);
  assert.equal(fin[0].data.ending, "draw");
  assert.equal(fin[0].data.winnerId, null);
  assert.equal(fin[0].data.standings.length, 3);
  assert.equal(fin[0].data.standings[0].id, players[1].id); // ranked by frozen rating
});

test("one survivor left -> the game goes on (no draw)", (t) => {
  const { io, phases, room, players, cleanup } = setup(3);
  t.after(cleanup);
  players[0].isGhost = true;
  players[1].isGhost = true;
  room.currentRoundIndex = 4;
  room.roundAdvanced = false;
  phases.advanceRound(room);
  assert.equal(events(io, "gameFinished").length, 0);
  assert.equal(events(io, "questionAnnounce").length, 1);
});

test("final: a departing player is no longer waited for", (t) => {
  const { io, phases, room, players, cleanup } = setup(2);
  t.after(cleanup);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  room.currentRoundIndex = TOTAL_ROUNDS;
  phases.startFinalBattle(room);
  phases.handleFinalIntroDone(room);
  const q = room.finalDeck[0];
  phases.submitFinalAnswer(room, players[0].id, q.correctIndex);
  assert.equal(events(io, "finalStepResult").length, 0);
  room.players.delete("sock1");
  phases.handleFinalDeparture(room, players[1].id);
  assert.equal(events(io, "finalStepResult").length, 1);
});

test("everyone answered early: the round still runs the whole timer", (t) => {
  const { ANSWER_TIMER_MS } = require("./config");
  const { io, phases, room, players, cleanup } = setup(2);
  t.after(cleanup);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  room.gameState = GAME_STATE.QUESTION_PLAY;
  phases.startAnswerPhase(room);
  phases.submitAnswer(room, "sock0", 0);
  phases.submitAnswer(room, "sock1", 1);
  t.mock.timers.tick(ANSWER_TIMER_MS - 1);
  assert.equal(room.gameState, GAME_STATE.ANSWER_PHASE);
  assert.equal(events(io, "scores").length, 0);
  t.mock.timers.tick(1);
  assert.equal(room.gameState, GAME_STATE.SCORES);
  assert.equal(players[0].score, 10);
});
