/**
 * Socket.IO wiring. Three groups of events:
 *   lobby     — createRoom / joinRoom / start intro / rules
 *   gameplay  — phase *Done handshakes + answers
 *   minigame  — sync / score / aftermath handshakes
 *
 * All game logic lives in phases.js; handlers only validate the socket and
 * forward to it.
 */
const {
  MAX_PLAYERS,
  INTRO_DURATION_MS,
  GAME_STATE,
} = require("./config");
const {
  createRoom,
  getRoom,
  deleteRoom,
  clearRoomTimers,
  roomIsFull,
  addPlayer,
  getPlayersList,
} = require("./rooms");
const { normalizeDifficulty } = require("./questions");

module.exports = function registerHandlers(io) {
  const phases = require("./phases")(io);

  io.on("connection", (socket) => {
    const roomOf = () => getRoom(socket.roomCode);
    const playerOf = (room) => room?.players.get(socket.id) || null;
    const isAdmin = (room) => !!playerOf(room)?.isAdmin;

    // ------------------------------------------------------------------ lobby

    socket.on("createRoom", (data, callback) => {
      const selectedDifficulty = normalizeDifficulty(data?.selectedDifficulty);
      const room = createRoom(socket.id, selectedDifficulty);
      socket.join(room.code);
      socket.roomCode = room.code;
      socket.isDisplay = true;
      callback?.({
        roomCode: room.code,
        players: [],
        gameState: room.gameState,
        selectedDifficulty,
      });
    });

    socket.on("joinRoom", (data, callback) => {
      const code = String(data?.roomCode || "")
        .replace(/\D/g, "")
        .padStart(4, "0")
        .slice(0, 4);
      const room = getRoom(code);

      if (!room) return callback?.({ error: "Кімнату не знайдено" });
      if (roomIsFull(room))
        return callback?.({
          error: `Кімната заповнена (макс. ${MAX_PLAYERS} гравців)`,
        });
      if (room.gameState !== GAME_STATE.WAITING)
        return callback?.({ error: "Гра вже почалася" });

      const player = addPlayer(room, socket.id, data?.playerName);
      socket.join(code);
      socket.roomCode = code;
      socket.playerId = player.id;

      const players = getPlayersList(room);
      callback?.({
        roomCode: code,
        playerId: player.id,
        players,
        gameState: room.gameState,
        isAdmin: player.isAdmin,
        selectedDifficulty: normalizeDifficulty(room.selectedDifficulty),
      });
      io.to(code).emit("playerJoined", { players });
    });

    socket.on("startIntro", (data) => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING || !isAdmin(room)) return;

      room.selectedDifficulty = normalizeDifficulty(data?.selectedDifficulty);
      io.to(room.code).emit("showIntro");

      if (room.introTimer) clearTimeout(room.introTimer);
      room.introTimer = setTimeout(() => {
        if (room.gameState === GAME_STATE.WAITING && room.players.size >= 1) {
          room.introTimer = null;
          phases.startGame(room);
        }
      }, INTRO_DURATION_MS);
    });

    socket.on("startGame", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING) return;
      if (!(isAdmin(room) || socket.isDisplay) || room.players.size < 1) return;
      if (room.introTimer) {
        clearTimeout(room.introTimer);
        room.introTimer = null;
      }
      phases.startGame(room);
    });

    socket.on("introEnded", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING) return;
      if (!socket.isDisplay || room.players.size < 1) return;
      if (room.introTimer) {
        clearTimeout(room.introTimer);
        room.introTimer = null;
      }
      phases.startGame(room);
    });

    socket.on("skipRules", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING || !isAdmin(room)) return;
      io.to(room.code).emit("skipRules");
    });

    socket.on("rulesStarted", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING || !socket.isDisplay)
        return;
      io.to(room.code).emit("rulesStarted");
    });

    // --------------------------------------------------------------- gameplay

    socket.on("questionAnnounceDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay) return;
      if (room.gameState === GAME_STATE.QUESTION_ANNOUNCE)
        phases.emitQuestionPlay(room);
    });

    socket.on("questionPlayDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay) return;
      if (room.gameState !== GAME_STATE.QUESTION_PLAY) return;
      // Round 1 transitions on its own fixed timer.
      if (room.currentRoundIndex === 0) return;
      phases.startAnswerPhase(room);
    });

    socket.on("answer", (data) => {
      const room = roomOf();
      if (!room) return;
      phases.submitAnswer(room, socket.id, data?.answerIndex);
    });

    socket.on("scoresDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay) return;
      phases.handleScoresDone(room);
    });

    socket.on("finalBattleDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay) return;
      phases.handleFinalBattleDone(room);
    });

    // --------------------------------------------------------------- minigame

    socket.on("trueFalseSync", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay || room.gameState !== GAME_STATE.SCORES)
        return;
      phases.syncMinigame(room);
    });

    socket.on("trueFalseScore", (data) => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.SCORES) return;
      phases.submitMinigameScore(room, socket.playerId, data?.score);
    });

    // Server-authoritative minigames (Math Rush answers, RPS choices, …).
    socket.on("minigameEvent", (msg) => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.SCORES) return;
      phases.handleMinigameEvent(room, socket.playerId, msg?.name, msg?.data);
    });

    socket.on("trueFalseResultsSceneDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay || room.gameState !== GAME_STATE.SCORES)
        return;
      phases.applyMinigameLives(room);
    });

    // ---------------------------------------------------------- leave/disconnect

    function handleDeparture({ viaLeave }) {
      const room = roomOf();
      if (!room) return;

      if (socket.isDisplay) {
        clearRoomTimers(room);
        if (viaLeave) {
          socket.leave(room.code);
          socket.roomCode = null;
        }
        deleteRoom(room.code);
        return;
      }

      const player = playerOf(room);
      if (!player) return;
      const wasAdmin = player.isAdmin;
      room.players.delete(socket.id);
      if (viaLeave) {
        socket.leave(room.code);
        socket.roomCode = null;
      }
      io.to(room.code).emit("playerLeft", { players: getPlayersList(room) });

      if (wasAdmin && room.players.size > 0) {
        const next = room.players.values().next().value;
        if (next) next.isAdmin = true;
        io.to(room.code).emit("adminChanged", { players: getPlayersList(room) });
      }
      if (room.players.size === 0) deleteRoom(room.code);
    }

    socket.on("leaveRoom", () => handleDeparture({ viaLeave: true }));
    socket.on("disconnect", () => handleDeparture({ viaLeave: false }));
  });
};
