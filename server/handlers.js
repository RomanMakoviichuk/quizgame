/**
 * Socket.IO wiring. Three groups of events:
 *   lobby     — createRoom / joinRoom / start intro / rules
 *   gameplay  — phase *Done handshakes + answers
 *   minigame  — sync / score / aftermath handshakes
 *   final     — intro handshake + race answers
 *
 * All game logic lives in phases.js; handlers only validate the socket and
 * forward to it.
 */
const {
  MAX_PLAYERS,
  INTRO_DURATION_MS,
  GAME_STATE,
  RECONNECT_GRACE_MS,
  TEST_BOTS,
} = require("./config");
const {
  createRoom,
  getRoom,
  deleteRoom,
  clearRoomTimers,
  roomIsFull,
  addPlayer,
  rekeyPlayer,
  takenSlots,
  getPlayersList,
} = require("./rooms");
const { categoryReadiness, normalizeGameDifficulty, NOT_ENOUGH_MESSAGE } = require("./questions");
const store = require("./content/store");
const clock = require("./clock");
const bots = TEST_BOTS ? require("./bots") : null;

module.exports = function registerHandlers(io) {
  const phases = require("./phases")(io);

  /** Resolve the room's category, falling back to the first ready active one. */
  function resolveCategoryId(requestedId) {
    const active = store.getPublicCategories();
    if (requestedId && active.some((c) => c.id === requestedId)) return requestedId;
    const ready = active.find(
      (c) => c.questionCount >= 0 && categoryReadiness(c.id).ok
    );
    return (ready || active[0] || {}).id || null;
  }

  io.on("connection", (socket) => {
    const roomOf = () => getRoom(socket.roomCode);
    const playerOf = (room) => room?.players.get(socket.id) || null;
    const isAdmin = (room) => !!playerOf(room)?.isAdmin;

    // Game events that arrive while the room is paused (a display video that
    // ended right at the pause, a late answer, a minigame action) are queued and
    // replayed on resume, in order — nothing is lost and nothing runs frozen.
    const onGame = (event, fn) =>
      socket.on(event, (...args) => {
        const room = roomOf();
        if (room && clock.isPaused(room)) {
          room.deferredWhilePaused.push(() => fn(...args));
          return;
        }
        fn(...args);
      });

    // ------------------------------------------------------------------ lobby

    socket.on("createRoom", (data, callback) => {
      const categoryId = resolveCategoryId(data?.categoryId);
      const difficulty = normalizeGameDifficulty(data?.difficulty);
      const room = createRoom(socket.id, categoryId, difficulty);
      socket.join(room.code);
      socket.roomCode = room.code;
      socket.isDisplay = true;
      const category = store.getCategory(categoryId);
      callback?.({
        roomCode: room.code,
        players: [],
        gameState: room.gameState,
        categoryId,
        categoryName: category ? category.name : null,
        difficulty,
      });
    });

    socket.on("selectCategory", (data) => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING) return;
      if (!(isAdmin(room) || socket.isDisplay)) return;
      const categoryId = resolveCategoryId(data?.categoryId);
      room.categoryId = categoryId;
      const category = store.getCategory(categoryId);
      io.to(room.code).emit("categorySelected", {
        categoryId,
        categoryName: category ? category.name : null,
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

      const player = addPlayer(room, socket.id, data?.playerName, data?.characterSlot);
      if (bots && data?.botKey === bots.KEY) {
        player.isBot = true;
        player.isAdmin = false;
      }
      socket.join(code);
      socket.roomCode = code;
      socket.playerId = player.id;

      const players = getPlayersList(room);
      const category = store.getCategory(room.categoryId);
      callback?.({
        roomCode: code,
        playerId: player.id,
        token: player.token, // the phone keeps it to come back after a reload
        characterSlot: player.characterSlot,
        players,
        gameState: room.gameState,
        isAdmin: player.isAdmin,
        categoryId: room.categoryId,
        categoryName: category ? category.name : null,
      });
      io.to(code).emit("playerJoined", { players });
    });

    // TEST MODE: the admin adds / removes bots while the room waits for players
    socket.on("addBot", (data, callback) => {
      const room = roomOf();
      if (!bots) return callback?.({ error: "Боти вимкнені" });
      if (!room || room.gameState !== GAME_STATE.WAITING || room.introStarted || !isAdmin(room))
        return callback?.({ error: "Бота можна додати лише в лобі" });
      if (roomIsFull(room)) return callback?.({ error: `Кімната заповнена (макс. ${MAX_PLAYERS} гравців)` });
      bots
        .addBot(room.code)
        .then((id) => callback?.({ ok: true, playerId: id }))
        .catch((e) => callback?.({ error: e.message }));
    });
    socket.on("removeBot", (data) => {
      const room = roomOf();
      if (!bots || !room || room.gameState !== GAME_STATE.WAITING || !isAdmin(room)) return;
      const target = [...room.players.values()].find((p) => p.id === data?.playerId && p.isBot);
      if (target) bots.removeBot(target.id);
    });

    socket.on("startIntro", (data) => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING || !isAdmin(room)) return;

      if (data?.categoryId) room.categoryId = resolveCategoryId(data.categoryId);

      const readiness = categoryReadiness(room.categoryId);
      if (!readiness.ok) {
        io.to(room.code).emit("gameError", {
          message: NOT_ENOUGH_MESSAGE,
          available: readiness.available,
          needed: readiness.needed,
        });
        return;
      }

      room.introStarted = true;
      // Dev/demo only (MINIGAME_DEMO=…): no intro / rules video, straight into round 1.
      if (process.env.MINIGAME_DEMO) {
        phases.startGame(room);
        return;
      }
      io.to(room.code).emit("showIntro");

      if (room.introTimer) clock.cancel(room.introTimer);
      room.introTimer = clock.schedule(room, () => {
        if (room.gameState === GAME_STATE.WAITING && room.players.size >= 1) {
          room.introTimer = null;
          phases.startGame(room);
        }
      }, INTRO_DURATION_MS);
    });

    onGame("startGame", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING) return;
      if (!(isAdmin(room) || socket.isDisplay) || room.players.size < 1) return;
      if (room.introTimer) {
        clock.cancel(room.introTimer);
        room.introTimer = null;
      }
      phases.startGame(room);
    });

    onGame("introEnded", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING) return;
      if (!socket.isDisplay || room.players.size < 1) return;
      if (room.introTimer) {
        clock.cancel(room.introTimer);
        room.introTimer = null;
      }
      phases.startGame(room);
    });

    // Admin's phone: skip the cinematic intro (the display jumps to the rules video)
    onGame("skipIntro", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING || !room.introStarted || !isAdmin(room)) return;
      io.to(room.code).emit("skipIntro");
    });

    onGame("skipRules", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING || !isAdmin(room)) return;
      io.to(room.code).emit("skipRules");
    });

    onGame("rulesStarted", () => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.WAITING || !socket.isDisplay)
        return;
      io.to(room.code).emit("rulesStarted");
    });

    // --------------------------------------------------------------- gameplay

    onGame("questionAnnounceDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay) return;
      if (room.gameState === GAME_STATE.QUESTION_ANNOUNCE)
        phases.emitQuestionPlay(room);
    });

    onGame("questionPlayDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay) return;
      if (room.gameState !== GAME_STATE.QUESTION_PLAY) return;
      // Round 1 transitions on its own fixed timer.
      if (room.currentRoundIndex === 0) return;
      phases.startAnswerPhase(room);
    });

    onGame("answer", (data) => {
      const room = roomOf();
      if (!room) return;
      phases.submitAnswer(room, socket.id, data?.answerIndex);
    });

    onGame("scoresDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay) return;
      phases.handleScoresDone(room);
    });

    // ------------------------------------------------------------ final race

    onGame("finalBattleIntroDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay) return;
      phases.handleFinalIntroDone(room);
    });

    // a phone (re)joining the final asks for the race and the open question
    socket.on("finalSync", (data, callback) => {
      const room = roomOf();
      const player = playerOf(room);
      if (!room || (!player && !socket.isDisplay)) return callback?.(null);
      callback?.(phases.finalSnapshot(room, player?.id ?? null));
    });

    onGame("finalAnswer", (data) => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.FINAL_BATTLE) return;
      phases.submitFinalAnswer(room, socket.playerId, data?.answerIndex);
    });

    // Dev/demo only (FINAL_DEMO=1, or test mode with bots): jump from the lobby
    // straight into the final with made-up ratings and a few ghosts.
    if (process.env.FINAL_DEMO === "1" || TEST_BOTS) {
      onGame("debugStartFinal", () => {
        const room = roomOf();
        if (!room || room.gameState !== GAME_STATE.WAITING) return;
        if (!(isAdmin(room) || socket.isDisplay) || room.players.size < 1) return;
        const list = [...room.players.values()];
        list.forEach((p, i) => {
          p.score = [72, 41, 90, 20, 61, 0, 51, 31][i % 8];
          if (i % 3 === 2) {
            p.lives = 0;
            p.isGhost = true;
            p.diedAtRound = 5 + (i % 4);
          } else {
            p.lives = 1 + (i % 3);
          }
        });
        room.rounds = [];
        phases.startFinalBattle(room);
      });
    }

    // --------------------------------------------------------------- minigame

    onGame("trueFalseSync", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay || room.gameState !== GAME_STATE.SCORES)
        return;
      phases.syncMinigame(room);
    });

    onGame("trueFalseScore", (data) => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.SCORES) return;
      phases.submitMinigameScore(room, socket.playerId, data?.score);
    });

    // Server-authoritative minigames (Math Rush answers, RPS choices, …).
    onGame("minigameEvent", (msg) => {
      const room = roomOf();
      if (!room || room.gameState !== GAME_STATE.SCORES) return;
      phases.handleMinigameEvent(room, socket.playerId, msg?.name, msg?.data);
    });

    // the TV reports things only it knows (e.g. «Вгадай мелодію»: songs loaded / audio failed)
    onGame("minigameDisplayEvent", (msg) => {
      const room = roomOf();
      if (!room || !socket.isDisplay || room.gameState !== GAME_STATE.SCORES) return;
      phases.handleMinigameDisplayEvent(room, msg?.name, msg?.data);
    });

    onGame("trueFalseResultsSceneDone", () => {
      const room = roomOf();
      if (!room || !socket.isDisplay || room.gameState !== GAME_STATE.SCORES)
        return;
      phases.applyMinigameLives(room);
    });

    // ------------------------------------------------------------------ pause
    // Only the room admin (first player) pauses/resumes, any time after the
    // intro has started and until the game is finished.

    const canPause = (room) =>
      room.gameState !== GAME_STATE.FINISHED &&
      (room.gameState !== GAME_STATE.WAITING || room.introStarted);

    socket.on("pauseGame", () => {
      const room = roomOf();
      if (!room || !isAdmin(room) || !canPause(room)) return;
      if (!clock.pause(room)) return;
      io.to(room.code).emit("gamePaused", { by: playerOf(room)?.name || null });
    });

    // the admin (phone) or the TV ends the game from the pause screen: everybody back to the start
    socket.on("abortGame", () => {
      const room = roomOf();
      if (!room || !(isAdmin(room) || socket.isDisplay) || !clock.isPaused(room)) return;
      io.to(room.code).emit("gameAborted", { by: playerOf(room)?.name || null });
      bots?.removeAll(room.code);
      deleteRoom(room.code); // clears every timer
      io.in(room.code).socketsLeave(room.code);
    });

    socket.on("resumeGame", () => {
      const room = roomOf();
      if (!room || !isAdmin(room) || !clock.isPaused(room)) return;
      const pausedMs = clock.resume(room);
      io.to(room.code).emit("gameResumed", { pausedMs });
      for (const fn of room.deferredWhilePaused.splice(0)) fn();
    });

    // Phone, before joining: which characters are already taken in that room.
    socket.on("roomSlots", (data, callback) => {
      const code = String(data?.roomCode || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
      const room = getRoom(code);
      if (!room) return callback?.({ error: "Кімнату не знайдено" });
      if (roomIsFull(room)) return callback?.({ error: `Кімната заповнена (макс. ${MAX_PLAYERS} гравців)` });
      if (room.gameState !== GAME_STATE.WAITING) return callback?.({ error: "Гра вже почалася" });
      callback?.({ roomCode: code, taken: takenSlots(room) });
    });

    // A phone that comes back (page reload, dropped Wi-Fi): same player, new socket.
    socket.on("resumeSession", (data, callback) => {
      const code = String(data?.roomCode || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
      const room = getRoom(code);
      if (!room) return callback?.({ error: "Гру завершено" });
      const entry = [...room.players.entries()].find(([, p]) => p.id === data?.playerId && p.token === data?.token);
      if (!entry) return callback?.({ error: "Сесію не знайдено" });
      const [oldSid, player] = entry;
      if (player.dropTimer) {
        clearTimeout(player.dropTimer);
        player.dropTimer = null;
      }
      player.disconnected = false;
      if (oldSid !== socket.id) {
        rekeyPlayer(room, oldSid, socket.id); // first, so the stale socket below finds nobody to drop
        io.sockets.sockets.get(oldSid)?.disconnect(true); // a stale tab of the same player
      }
      socket.join(code);
      socket.roomCode = code;
      socket.playerId = player.id;
      const category = store.getCategory(room.categoryId);
      const players = getPlayersList(room);
      callback?.({
        roomCode: code,
        playerId: player.id,
        token: player.token,
        players,
        isAdmin: player.isAdmin,
        categoryName: category ? category.name : null,
        ...phases.resumeSnapshot(room, player),
      });
      io.to(code).emit("playersUpdate", { players });
      const snapMg = room.minigame;
      if (snapMg && snapMg.startEmitted && !snapMg.resolved) snapMg.def.onReconnect?.(snapMg, player.id, phases.minigameCtxFor(room));
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

      // A dropped connection (not "Вийти"): keep the seat for RECONNECT_GRACE_MS
      // so the phone can come back with resumeSession; only then the player leaves.
      if (!viaLeave) {
        player.disconnected = true;
        const sid = socket.id;
        if (player.dropTimer) clearTimeout(player.dropTimer);
        player.dropTimer = setTimeout(() => {
          player.dropTimer = null;
          if (room.players.get(sid) === player && player.disconnected) removePlayer(room, sid, player, false);
        }, RECONNECT_GRACE_MS);
        player.dropTimer.unref?.();
        // the admin dropped out: hand the admin role (start / pause) to the next player
        // who is still connected, so nobody waits for a phone that may not come back
        if (player.isAdmin) {
          const next = [...room.players.values()].find((p) => p !== player && !p.disconnected && !p.isBot);
          if (next) {
            player.isAdmin = false;
            next.isAdmin = true;
            io.to(room.code).emit("adminChanged", { players: getPlayersList(room) });
          }
        }
        io.to(room.code).emit("playersUpdate", { players: getPlayersList(room) });
        return;
      }
      removePlayer(room, socket.id, player, true);
    }

    /** The player is gone for good: out of the room, out of the race / minigame, admin handed on. */
    function removePlayer(room, sid, player, viaLeave) {
      if (player.dropTimer) {
        clearTimeout(player.dropTimer);
        player.dropTimer = null;
      }
      const wasAdmin = player.isAdmin;
      room.players.delete(sid);
      phases.handleFinalDeparture(room, player.id);
      phases.handleMinigameDeparture(room, player.id);
      if (viaLeave) {
        socket.leave(room.code);
        socket.roomCode = null;
      }
      io.to(room.code).emit("playerLeft", { players: getPlayersList(room) });

      if (wasAdmin && room.players.size > 0) {
        const next = [...room.players.values()].find((p) => !p.isBot);
        if (next) next.isAdmin = true;
        io.to(room.code).emit("adminChanged", { players: getPlayersList(room) });
      }
      // only bots left: they leave too (the room then closes)
      if (bots && room.players.size > 0 && [...room.players.values()].every((p) => p.isBot)) bots.removeAll(room.code);
      if (room.players.size === 0) deleteRoom(room.code);
    }

    socket.on("leaveRoom", () => handleDeparture({ viaLeave: true }));
    socket.on("disconnect", () => handleDeparture({ viaLeave: false }));
  });
};
