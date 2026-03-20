const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { getRounds, normalizeDifficulty } = require("./rounds");
const {
  GAME_STATE,
  TOTAL_ROUNDS,
  LIVES_PER_PLAYER,
  SCORE_CORRECT,
  ANSWER_TIMER_MS,
} = require("./gameStates");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
});

const MAX_PLAYERS = 8;
const CHARACTER_SLOTS = 8;
const INTRO_DURATION_MS = 180000;
const ROUND1_ANSWER_DELAY_MS = 6000;

function generateRoomCode() {
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

const rooms = new Map();

/** Повертає випадковий вільний слот персонажа (1..CHARACTER_SLOTS) для кімнати */
function getRandomFreeCharacterSlot(room) {
  const taken = new Set(
    Array.from(room.players.values())
      .map((p) => p.characterSlot)
      .filter((s) => s >= 1 && s <= CHARACTER_SLOTS)
  );
  const free = [];
  for (let s = 1; s <= CHARACTER_SLOTS; s++) {
    if (!taken.has(s)) free.push(s);
  }
  if (free.length === 0) return 1;
  return free[Math.floor(Math.random() * free.length)];
}

function getPlayersList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  return Array.from(room.players.entries()).map(([socketId, p]) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    lives: p.lives ?? LIVES_PER_PLAYER,
    hasAnswered: p.hasAnswered || false,
    isAdmin: p.isAdmin || false,
    characterSlot: p.characterSlot ?? 1,
  }));
}

function generatePlayerId() {
  return "player_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

function resetPlayersAnswered(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.players.forEach((p) => (p.hasAnswered = false));
}

function getRoomRounds(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  return getRounds(room.selectedDifficulty || "");
}

function startMainScene(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.currentRoundIndex = 0;
  const difficulty = normalizeDifficulty(room.selectedDifficulty);
  room.selectedDifficulty = difficulty;
  room.rounds = getRounds(difficulty);
  // Skip transitional MAIN_SCENE after rulesmovie and start round 1 immediately.
  emitQuestionAnnounce(roomCode);
}

function emitQuestionAnnounce(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const roundIndex = room.currentRoundIndex + 1;
  room.gameState = GAME_STATE.QUESTION_ANNOUNCE;
  io.to(roomCode).emit("questionAnnounce", { roundIndex });
}

function emitQuestionPlay(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const rounds = room.rounds || getRoomRounds(roomCode);
  const roundData = rounds[room.currentRoundIndex];
  if (!roundData?.question) {
    emitScores(roomCode);
    return;
  }
  room.gameState = GAME_STATE.QUESTION_PLAY;
  io.to(roomCode).emit("questionPlay", {
    roundIndex: room.currentRoundIndex + 1,
    question: roundData.question,
    audioSrc: roundData.audioSrc,
  });
  // Round 1: start answer phase at 7s from question video start.
  if (room.currentRoundIndex === 0) {
    if (room.preAnswerTimer) clearTimeout(room.preAnswerTimer);
    room.preAnswerTimer = setTimeout(() => {
      const r = rooms.get(roomCode);
      if (!r || r.gameState !== GAME_STATE.QUESTION_PLAY) return;
      r.preAnswerTimer = null;
      startAnswerPhase(roomCode);
    }, ROUND1_ANSWER_DELAY_MS);
  }
}

function startAnswerPhase(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.preAnswerTimer) {
    clearTimeout(room.preAnswerTimer);
    room.preAnswerTimer = null;
  }
  room.gameState = GAME_STATE.ANSWER_PHASE;
  resetPlayersAnswered(roomCode);
  const roundData = room.rounds[room.currentRoundIndex];
  if (!roundData?.question) {
    emitScores(roomCode);
    return;
  }
  io.to(roomCode).emit("answerPhase", {
    question: roundData.question,
    roundIndex: room.currentRoundIndex + 1,
  });
  room.questionTimer = setTimeout(() => checkAnswers(roomCode), ANSWER_TIMER_MS);
}

function checkAnswers(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.gameState !== GAME_STATE.ANSWER_PHASE) return;
  if (room.questionTimer) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
  }
  // Завжди переходимо до екрану підрахунку балів після кожного раунду
  emitScores(roomCode);
}

function emitScores(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.gameState = GAME_STATE.SCORES;
  const roundData = room.rounds[room.currentRoundIndex];
  const correctIndex = roundData?.question?.correctIndex ?? 0;
  const playersList = Array.from(room.players.entries())
    .map(([socketId, p]) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      lives: p.lives ?? LIVES_PER_PLAYER,
      hasAnswered: p.hasAnswered || false,
      isAdmin: p.isAdmin || false,
      characterSlot: p.characterSlot ?? 1,
      lastCorrect: p.hasAnswered && p.lastAnswerIndex === correctIndex,
    }))
    .sort((a, b) => b.score - a.score);
  io.to(roomCode).emit("scores", {
    players: playersList,
    roundIndex: room.currentRoundIndex + 1,
  });
  // Transition happens when display emits scoresDone (after score/score2 video ends)
}

io.on("connection", (socket) => {
  socket.on("createRoom", (data, callback) => {
    let roomCode = generateRoomCode();
    while (rooms.has(roomCode)) roomCode = generateRoomCode();
    const selectedDifficulty = normalizeDifficulty(data?.selectedDifficulty);
    rooms.set(roomCode, {
      players: new Map(),
      displaySocketId: socket.id,
      currentRoundIndex: 0,
      rounds: [],
      gameState: GAME_STATE.WAITING,
      questionTimer: null,
      preAnswerTimer: null,
      selectedDifficulty,
    });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isDisplay = true;
    callback({
      roomCode,
      players: [],
      gameState: GAME_STATE.WAITING,
      selectedDifficulty,
    });
  });

  socket.on("joinRoom", (data, callback) => {
    const rawCode = String(data?.roomCode || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
    const room = rooms.get(rawCode);
    if (!room) {
      callback({ error: "Кімнату не знайдено" });
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      callback({ error: "Кімната заповнена (макс. 7 гравців)" });
      return;
    }
    if (room.gameState !== GAME_STATE.WAITING) {
      callback({ error: "Гра вже почалася" });
      return;
    }
    const isFirstPlayer = room.players.size === 0;
    const playerId = generatePlayerId();
    const characterSlot = getRandomFreeCharacterSlot(room);
    room.players.set(socket.id, {
      id: playerId,
      name: (data?.playerName || "Гравець").trim().slice(0, 20),
      score: 0,
      lives: LIVES_PER_PLAYER,
      hasAnswered: false,
      isAdmin: isFirstPlayer,
      characterSlot,
    });
    socket.join(rawCode);
    socket.roomCode = rawCode;
    socket.playerId = playerId;
    const playersList = getPlayersList(rawCode);
    callback({
      roomCode: rawCode,
      playerId,
      players: playersList,
      gameState: room.gameState,
      isAdmin: isFirstPlayer,
      selectedDifficulty: normalizeDifficulty(room.selectedDifficulty),
    });
    io.to(rawCode).emit("playerJoined", { players: playersList });
  });

  socket.on("startIntro", (data) => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.gameState !== GAME_STATE.WAITING) return;
    const player = room.players.get(socket.id);
    if (!player || !player.isAdmin) return;
    const fromClient = normalizeDifficulty(data?.selectedDifficulty);
    room.selectedDifficulty = fromClient;
    io.to(roomCode).emit("showIntro");
    if (room.introTimer) clearTimeout(room.introTimer);
    room.introTimer = setTimeout(() => {
      const r = rooms.get(roomCode);
      if (r && r.gameState === GAME_STATE.WAITING && r.players.size >= 1) {
        if (r.introTimer) clearTimeout(r.introTimer);
        r.introTimer = null;
        startMainScene(roomCode);
      }
    }, INTRO_DURATION_MS);
  });

  socket.on("startGame", () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.gameState !== GAME_STATE.WAITING) return;
    const player = room.players.get(socket.id);
    const canStart = (player && player.isAdmin) || socket.isDisplay;
    if (!canStart || room.players.size < 1) return;
    startMainScene(roomCode);
  });

  socket.on("introEnded", () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.gameState !== GAME_STATE.WAITING) return;
    if (!socket.isDisplay || room.players.size < 1) return;
    if (room.introTimer) {
      clearTimeout(room.introTimer);
      room.introTimer = null;
    }
    startMainScene(roomCode);
  });

  socket.on("skipRules", () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.gameState !== GAME_STATE.WAITING) return;
    const player = room.players.get(socket.id);
    if (!player || !player.isAdmin) return;
    io.to(roomCode).emit("skipRules");
  });

  socket.on("rulesStarted", () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.gameState !== GAME_STATE.WAITING) return;
    if (!socket.isDisplay) return;
    io.to(roomCode).emit("rulesStarted");
  });

  socket.on("questionAnnounceDone", () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room || !socket.isDisplay) return;
    if (room.gameState === GAME_STATE.QUESTION_ANNOUNCE) {
      emitQuestionPlay(roomCode);
    }
  });

  socket.on("questionPlayDone", () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room || !socket.isDisplay) return;
    if (room.gameState === GAME_STATE.QUESTION_PLAY) {
      // Round 1 transitions by fixed timer from question start.
      if (room.currentRoundIndex === 0) return;
      startAnswerPhase(roomCode);
    }
  });

  socket.on("scoresDone", () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room || !socket.isDisplay) return;
    if (room.gameState !== GAME_STATE.SCORES) return;
    room.currentRoundIndex++;
    if (room.currentRoundIndex >= TOTAL_ROUNDS) {
      room.gameState = GAME_STATE.FINISHED;
      io.to(roomCode).emit("gameFinished", {
        players: getPlayersList(roomCode).sort((a, b) => b.score - a.score),
      });
    } else {
      emitQuestionAnnounce(roomCode);
    }
  });

  socket.on("answer", (data) => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    const player = room?.players.get(socket.id);
    if (!player || room.gameState !== GAME_STATE.ANSWER_PHASE || player.hasAnswered) return;
    const roundData = room.rounds[room.currentRoundIndex];
    if (!roundData?.question) return;
    const isCorrect = data.answerIndex === roundData.question.correctIndex;
    player.hasAnswered = true;
    player.lastAnswerIndex = data.answerIndex;
    if (isCorrect) player.score += SCORE_CORRECT;
    socket.emit("answerResult", {
      correct: isCorrect,
      correctIndex: roundData.question.correctIndex,
      score: player.score,
    });
    io.to(roomCode).emit("playersUpdate", { players: getPlayersList(roomCode) });
    const allAnswered = Array.from(room.players.values()).every((p) => p.hasAnswered);
    if (allAnswered && room.questionTimer) {
      clearTimeout(room.questionTimer);
      room.questionTimer = null;
      checkAnswers(roomCode);
    }
  });

  socket.on("leaveRoom", () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (socket.isDisplay) {
      socket.leave(roomCode);
      socket.roomCode = null;
      if (room.questionTimer) clearTimeout(room.questionTimer);
      if (room.preAnswerTimer) clearTimeout(room.preAnswerTimer);
      rooms.delete(roomCode);
      return;
    }
    const player = room.players.get(socket.id);
    const wasAdmin = player?.isAdmin;
    room.players.delete(socket.id);
    socket.leave(roomCode);
    socket.roomCode = null;
    io.to(roomCode).emit("playerLeft", { players: getPlayersList(roomCode) });
    if (wasAdmin) {
      const next = room.players.entries().next().value;
      if (next) next[1].isAdmin = true;
      io.to(roomCode).emit("adminChanged", { players: getPlayersList(roomCode) });
    }
    if (room.players.size === 0) {
      if (room.questionTimer) clearTimeout(room.questionTimer);
      if (room.preAnswerTimer) clearTimeout(room.preAnswerTimer);
      rooms.delete(roomCode);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (socket.isDisplay) {
      if (room.questionTimer) clearTimeout(room.questionTimer);
      if (room.preAnswerTimer) clearTimeout(room.preAnswerTimer);
      rooms.delete(roomCode);
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) return;
    const wasAdmin = player.isAdmin;
    room.players.delete(socket.id);
    io.to(roomCode).emit("playerLeft", { players: getPlayersList(roomCode) });
    if (wasAdmin && room.players.size > 0) {
      const first = room.players.entries().next().value;
      if (first) first[1].isAdmin = true;
      io.to(roomCode).emit("adminChanged", { players: getPlayersList(roomCode) });
    }
    if (room.players.size === 0) {
      if (room.questionTimer) clearTimeout(room.questionTimer);
      if (room.preAnswerTimer) clearTimeout(room.preAnswerTimer);
      rooms.delete(roomCode);
    }
  });
});

app.use(express.static("public"));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Сервер на http://localhost:${PORT}`);
});
