/**
 * "Правда / Брехня" — the sudden-death contest played after a round.
 *
 * Trigger: 2+ players got the quiz question wrong.
 * Participants: only the players who answered WRONG compete.
 * Life loss: everyone tied at the lowest minigame score.
 *
 * Client-scored: the phone plays a 30s round locally and reports its final
 * score; the server only collects scores and resolves. (`clientScored: true`)
 *
 * Statements: server/data/trueFalse.json. Each game gets STATEMENTS_PER_GAME of
 * them, not played before (content/usage.js) until all have been played.
 */
const fs = require("fs");
const path = require("path");
const usage = require("../content/usage");

const ID = "trueFalse";
const STATEMENTS_FILE = path.join(__dirname, "..", "data", "trueFalse.json");
const STATEMENTS_PER_GAME = 30; // a fast player gets through ~20 in the 30s round

/** All statements, read fresh each game (edit the file — no restart). */
function loadStatements(file = STATEMENTS_FILE) {
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    return list
      .filter((s) => s && typeof s.text === "string" && s.text.trim() && typeof s.isTrue === "boolean")
      .map((s) => ({ text: s.text.trim(), isTrue: s.isTrue }));
  } catch (e) {
    console.error(`[trueFalse] cannot read ${file}: ${e.message}`);
    return [];
  }
}

// 12s until the 3-2-1 starts + 3s countdown + 30s round + slack — the server
// fallback that force-resolves the contest if a phone never reports.
const TOTAL_DURATION_MS = 46000;

const MIN_CONTESTANTS = 2;

function buildContest({ players, correctIndex, roundIndex }) {
  const wrong = players
    .filter((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex))
    .map((p) => p.id);

  if (wrong.length < MIN_CONTESTANTS) return null;

  return {
    minigameId: ID,
    mode: "multi_wrong_compete",
    roundIndex,
    contestantIds: wrong,
  };
}

/**
 * Live progress for the TV: each phone sends "tf:progress" { score, frozen }
 * after every answer. Display only — the final score still comes from the
 * phone's "trueFalseScore" report.
 */
function onStart(mg) {
  mg.statements = usage.draw("trueFalse", loadStatements(), STATEMENTS_PER_GAME, { idOf: (s) => s.text });
}

/** Sent with "trueFalseStart" (and to a phone that comes back mid-game). */
function startPayload(mg) {
  return { statements: mg.statements || [] };
}

function onClientEvent(mg, playerId, name, data, ctx) {
  if (name !== "tf:progress") return;
  mg.live = mg.live || {};
  const score = Math.max(0, Math.min(999, Math.floor(Number(data.score) || 0)));
  mg.live[playerId] = { score, frozen: !!data.frozen };
  ctx.emitAll("trueFalse:live", { byId: mg.live });
}

/** Everyone tied at the lowest reported score loses one life. */
function resolveLosers(mg) {
  const scoreOf = (id) => mg.scores.get(id) ?? 0;
  const min = Math.min(...mg.contestantIds.map(scoreOf));
  return mg.contestantIds.filter((id) => scoreOf(id) === min);
}

function buildResults(mg) {
  const minigameScores = {};
  for (const id of mg.contestantIds) minigameScores[id] = mg.scores.get(id) ?? 0;
  return { minigameScores };
}

module.exports = {
  ID,
  TOTAL_DURATION_MS,
  clientScored: true,
  STATEMENTS_PER_GAME,
  loadStatements,
  buildContest,
  onStart,
  startPayload,
  onClientEvent,
  resolveLosers,
  buildResults,
};
