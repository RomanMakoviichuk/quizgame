/**
 * In-memory room store. One process, one Map, no persistence — a restart drops
 * every game. Fine for a single live event; see ARCHITECTURE.md for the trade-off.
 */
const crypto = require("crypto");
const {
  MAX_PLAYERS,
  CHARACTER_SLOTS,
  LIVES_PER_PLAYER,
  GAME_STATE,
} = require("./config");

/** roomCode -> room */
const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = crypto.randomInt(0, 10000).toString().padStart(4, "0");
  } while (rooms.has(code));
  return code;
}

function createRoom(displaySocketId, selectedDifficulty) {
  const code = generateRoomCode();
  const room = {
    code,
    players: new Map(), // socketId -> player
    displaySocketId,
    selectedDifficulty,

    currentRoundIndex: 0,
    rounds: [], // filled by phases.startGame()
    gameState: GAME_STATE.WAITING,

    // timers (always cleared through clearRoomTimers)
    questionTimer: null,
    preAnswerTimer: null,
    introTimer: null,
    finalBattleTimer: null,

    // per-round flags
    roundAdvanced: false,
    scoresVideoDone: false,

    // active minigame contest for the round just played (see minigames/)
    minigame: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(roomCode) {
  return rooms.get(roomCode) || null;
}

function clearRoomTimers(room) {
  if (!room) return;
  for (const key of [
    "questionTimer",
    "preAnswerTimer",
    "introTimer",
    "finalBattleTimer",
  ]) {
    if (room[key]) {
      clearTimeout(room[key]);
      room[key] = null;
    }
  }
  if (room.minigame?.timeoutHandle) {
    clearTimeout(room.minigame.timeoutHandle);
    room.minigame.timeoutHandle = null;
  }
  if (room.minigame?.playTimer) {
    clearTimeout(room.minigame.playTimer);
    room.minigame.playTimer = null;
  }
}

function deleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (room) clearRoomTimers(room);
  rooms.delete(roomCode);
}

/** Random free character slot (1..CHARACTER_SLOTS); falls back to 1 when full. */
function getRandomFreeCharacterSlot(room) {
  const taken = new Set(
    [...room.players.values()]
      .map((p) => p.characterSlot)
      .filter((s) => s >= 1 && s <= CHARACTER_SLOTS)
  );
  const free = [];
  for (let s = 1; s <= CHARACTER_SLOTS; s++) if (!taken.has(s)) free.push(s);
  if (free.length === 0) return 1;
  return free[crypto.randomInt(0, free.length)];
}

function roomIsFull(room) {
  return room.players.size >= MAX_PLAYERS;
}

function addPlayer(room, socketId, rawName) {
  const isFirstPlayer = room.players.size === 0;
  const player = {
    id: "player_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"),
    name: (rawName || "Гравець").trim().slice(0, 20) || "Гравець",
    score: 0,
    lives: LIVES_PER_PLAYER,
    hasAnswered: false,
    lastAnswerIndex: null,
    isAdmin: isFirstPlayer,
    characterSlot: getRandomFreeCharacterSlot(room),
  };
  room.players.set(socketId, player);
  return player;
}

/** Wire shape of a player — everything the clients render. */
function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    score: p.score,
    lives: p.lives ?? LIVES_PER_PLAYER,
    hasAnswered: p.hasAnswered || false,
    isAdmin: p.isAdmin || false,
    characterSlot: p.characterSlot ?? 1,
  };
}

function getPlayersList(room) {
  if (!room) return [];
  return [...room.players.values()].map(serializePlayer);
}

function resetPlayersAnswered(room) {
  room.players.forEach((p) => {
    p.hasAnswered = false;
    p.lastAnswerIndex = null;
  });
}

module.exports = {
  rooms,
  generateRoomCode,
  createRoom,
  getRoom,
  deleteRoom,
  clearRoomTimers,
  getRandomFreeCharacterSlot,
  roomIsFull,
  addPlayer,
  serializePlayer,
  getPlayersList,
  resetPlayersAnswered,
};
