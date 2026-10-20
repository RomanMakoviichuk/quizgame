/**
 * Round videos — drop-in folders under client/public/assets/rounds/, read on
 * every round (no rebuild, no restart):
 *
 *   announce/round-N/       «РАУНД N» clips, in turn across games
 *   question/               background under the question, random
 *   after-round/            after every round, before the results are shown
 *   results/all-correct/    everybody answered right
 *   results/partial/        some right, some wrong
 *   results/all-wrong/      nobody right (wrong or no answer)
 *   results/fallback/       used only when a results folder is empty
 *
 * Any .mp4/.webm/.mov/.m4v file in a folder is a candidate. Clips are dealt
 * from a shuffled "bag" per room and folder: every clip plays once before any
 * repeats, and a new bag never starts with the clip that just played. Files
 * added mid-game join the next bag. An empty folder simply means "no clip"
 * (results fall back to the old score videos).
 * The folders are served by server.js straight from client/public, so new
 * clips also work with the production build.
 *
 * Round announcements ("РАУНД N" clips):
 *
 *   client/public/assets/rounds/announce/round-1/1.mp4, 2.mp4, …
 *   client/public/assets/rounds/announce/round-2/…   (one folder per round)
 *
 * Each game plays the next clip of that round's folder in turn (1, 2, 3, 1, …),
 * remembered across games and server restarts in data/round-announce.json.
 * An empty or missing folder means no clip: the display shows the
 * "РАУНД N" caption instead.
 *
 * Question backgrounds (the video under the question and the answer timer):
 *
 *   client/public/assets/rounds/question/*.mp4
 *
 * A random one per round, dealt from the room's bag like the result clips
 * (no repeats in a game until all have played). Empty folder -> null: the
 * display falls back to its main background video.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROUNDS_DIR = path.join(__dirname, "..", "client", "public", "assets", "rounds");
const ROUNDS_URL = "/assets/rounds";
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

const ANNOUNCE_DIR = path.join(ROUNDS_DIR, "announce");
const ANNOUNCE_URL = `${ROUNDS_URL}/announce`;
const ANNOUNCE_STATE_FILE = path.join(__dirname, "data", "round-announce.json");
const QUESTION_FOLDER = "question"; // inside ROUNDS_DIR

const POOLS = {
  afterRound: "after-round",
  allCorrect: "results/all-correct",
  partial: "results/partial",
  allWrong: "results/all-wrong",
};

// Old single clips, used only when a results folder is empty.
const LEGACY_RESULT = {
  allCorrect: `${ROUNDS_URL}/results/fallback/score-all-correct.mp4`,
  partial: `${ROUNDS_URL}/results/fallback/score.mp4`,
  allWrong: `${ROUNDS_URL}/results/fallback/score.mp4`,
};

function listPool(pool, dir = ROUNDS_DIR) {
  const rel = POOLS[pool];
  if (!rel) return [];
  try {
    return fs
      .readdirSync(path.join(dir, rel))
      .filter((f) => VIDEO_EXT.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => `${ROUNDS_URL}/${rel.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(f)}`);
  } catch {
    return [];
  }
}

/** Random clip from a list, never the one in `last` when there is a choice. */
function pickFrom(list, last) {
  if (!list.length) return null;
  const choices = list.length > 1 ? list.filter((u) => u !== last) : list;
  return choices[crypto.randomInt(0, choices.length)];
}

/** "allCorrect" | "partial" | "allWrong" from the serialized players of a round. */
function resultKind(players) {
  if (!players.length) return "allWrong";
  const right = players.filter((p) => p.lastCorrect).length;
  if (right === players.length) return "allCorrect";
  if (right === 0) return "allWrong";
  return "partial";
}

/**
 * Next clip from the room's bag for this pool (refilled, shuffled, when empty;
 * clips deleted from the folder are skipped).
 */
function dealFrom(state, list) {
  if (!list.length) return null;
  const available = new Set(list);
  state.bag = (state.bag || []).filter((u) => available.has(u));
  if (!state.bag.length) {
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.length > 1 && shuffled[0] === state.last) shuffled.push(shuffled.shift());
    state.bag = shuffled;
  }
  state.last = state.bag.shift();
  return state.last;
}

/** The clips for one round's results sequence (no repeats until a folder is used up). */
function roundVideos(room, players, dir = ROUNDS_DIR) {
  const kind = resultKind(players);
  room.videoBags = room.videoBags || {};
  const take = (pool) => {
    room.videoBags[pool] = room.videoBags[pool] || {};
    return dealFrom(room.videoBags[pool], listPool(pool, dir));
  };
  return {
    kind,
    afterRound: take("afterRound"),
    afterResult: take(kind) || LEGACY_RESULT[kind],
  };
}

/** The announcement clips of one round, in natural order (1.mp4, 2.mp4, … 10.mp4). */
function listAnnounce(roundIndex, dir = ANNOUNCE_DIR) {
  const folder = `round-${roundIndex}`;
  try {
    return fs
      .readdirSync(path.join(dir, folder))
      .filter((f) => VIDEO_EXT.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    return {};
  }
}

/**
 * The announcement clip URL for this round of this game (null = none). The
 * next file after the one played last time; picked once per room and round,
 * so a resent announce never skips a clip.
 */
function announceVideo(room, roundIndex, { dir = ANNOUNCE_DIR, stateFile = ANNOUNCE_STATE_FILE } = {}) {
  room.announceVideos = room.announceVideos || {};
  if (roundIndex in room.announceVideos) return room.announceVideos[roundIndex];
  const files = listAnnounce(roundIndex, dir);
  let url = null;
  if (files.length) {
    const state = readJson(stateFile);
    const last = files.indexOf(state[roundIndex]);
    const file = files[(last + 1) % files.length]; // a deleted/unknown last one -> start from the first
    state[roundIndex] = file;
    try {
      fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}
`);
    } catch {
      /* read-only disk: the rotation just restarts next time */
    }
    url = `${ANNOUNCE_URL}/round-${roundIndex}/${encodeURIComponent(file)}`;
  }
  room.announceVideos[roundIndex] = url;
  return url;
}

/** All question background clips (URLs, natural order). */
function listQuestionVideos(dir = ROUNDS_DIR) {
  try {
    return fs
      .readdirSync(path.join(dir, QUESTION_FOLDER))
      .filter((f) => VIDEO_EXT.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => `${ROUNDS_URL}/${QUESTION_FOLDER}/${encodeURIComponent(f)}`);
  } catch {
    return [];
  }
}

/** The question background for this round of this game (random, no repeats until all played; null = none). */
function questionVideo(room, roundIndex, dir = ROUNDS_DIR) {
  room.questionVideos = room.questionVideos || {};
  if (roundIndex in room.questionVideos) return room.questionVideos[roundIndex];
  room.videoBags = room.videoBags || {};
  room.videoBags.question = room.videoBags.question || {};
  const url = dealFrom(room.videoBags.question, listQuestionVideos(dir));
  room.questionVideos[roundIndex] = url;
  return url;
}

module.exports = {
  ROUNDS_DIR,
  ROUNDS_URL,
  ANNOUNCE_DIR,
  ANNOUNCE_URL,
  POOLS,
  listPool,
  pickFrom,
  dealFrom,
  resultKind,
  roundVideos,
  listAnnounce,
  announceVideo,
  listQuestionVideos,
  questionVideo,
};
