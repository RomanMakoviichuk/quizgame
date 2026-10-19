/**
 * «Перетягни канат» — team tapping battle (server-authoritative).
 *
 * Only the living players who got the quiz question wrong (or didn't answer)
 * pull, and only when there are 2, 4, 6 or 8 of them (never reshuffles or
 * drops anyone to make teams). Otherwise `buildContest` returns null and the
 * next minigame of the rotation is played instead (silently).
 *
 * Teams: those players shuffled (crypto) and cut in half — blue pulls left,
 * red pulls right. Fixed for the whole minigame.
 *
 * Taps: every phone sends `tow:pull { n }` (n = its own running counter). The
 * server counts a tap only if
 *   - the round is live (between startAt and endsAt, server clock),
 *   - the player is in a team,
 *   - n is bigger than the last n from that player (no replays),
 *   - the player made fewer than MAX_TAPS_PER_SEC taps in the last second.
 * Phones never send a total; the team score is the sum of counted taps.
 *
 * Series: rounds of PLAY_MS with the same teams; more counted taps wins the
 * round (equal taps = the round is replayed); the first team to WINS_NEEDED
 * round wins takes the series. TWO DRAWN ROUNDS IN A ROW end the series at
 * once and cost EVERY puller a life ("doubleDraw"). After MAX_ROUNDS the team
 * with more round wins takes it, equal wins = draw. Between rounds a BREAK_MS
 * pause shows the round result and counts the next round in.
 *
 * Result: the series winner wins; every member of the losing team loses one
 * life (through the normal minigame lives path). A plain series draw costs
 * nobody a life; a double draw costs everybody one.
 * No rating bonus (a team result, not a single winner).
 */
const crypto = require("crypto");

const ID = "tugOfWar";
// Narrow trigger (an even number of wrong players): while unplayed it is tried
// before every other minigame, so it runs the first time the chance comes.
const RARE = true;
const TEAM_SIZES = [2, 4, 6, 8];
const CANCEL_MESSAGE = "Битву скасовано: хтось із гравців вийшов";

const CONFIG = {
  PREP_MS: Number(process.env.TUG_PREP_MS) || 14000, // teams + rules + 3-2-1
  PLAY_MS: Number(process.env.TUG_PLAY_MS) || 10000,
  MAX_TAPS_PER_SEC: Number(process.env.TUG_MAX_TAPS_PER_SEC) || 10,
  BREAK_MS: Number(process.env.TUG_BREAK_MS) || 7000, // round result + 3-2-1 for the next one
  WINS_NEEDED: 2,
  MAX_ROUNDS: 5, // draws replay the round, but not forever
  BROADCAST_EVERY_MS: 80, // live score pushes are throttled
};
// server hard stop
const TOTAL_DURATION_MS = CONFIG.PREP_MS + CONFIG.MAX_ROUNDS * (CONFIG.PLAY_MS + CONFIG.BREAK_MS) + 8000;

const canPlay = (count) => TEAM_SIZES.includes(count);

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Two equal teams from an even list, in random order. */
function makeTeams(ids) {
  const s = shuffle(ids);
  const half = s.length / 2;
  return { blue: s.slice(0, half), red: s.slice(half) };
}

/**
 * Where the rope's centre mark sits: -1 (fully on the blue/left side) .. +1
 * (red/right). Smooth (tanh) and bounded, so it never leaves the stage; a lead
 * of ~3 taps per team member pulls it about three quarters of the way.
 */
function ropePosition(blue, red, teamSize = 1) {
  const diff = (Number(blue) || 0) - (Number(red) || 0);
  return diff === 0 ? 0 : -Math.tanh(diff / (4 * Math.max(1, teamSize)));
}

// ---------------------------------------------------------------- contest

/** Living players who got the question wrong or didn't answer. */
const failersOf = (players, correctIndex) =>
  players.filter((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex));

function buildContest({ players, correctIndex, roundIndex }) {
  const failers = failersOf(players, correctIndex);
  if (!canPlay(failers.length)) return null;
  return {
    minigameId: ID,
    mode: "teams",
    roundIndex,
    contestantIds: failers.map((p) => p.id),
  };
}

function onStart(mg) {
  const teams = makeTeams(mg.contestantIds);
  mg.tow = {
    phase: "prep", // prep | live | break | done | cancelled
    teams,
    round: 1,
    wins: { blue: 0, red: 0 },
    rounds: [], // finished rounds: { winner: "blue" | "red" | "draw", score }
    teamOf: Object.fromEntries([...teams.blue.map((id) => [id, "blue"]), ...teams.red.map((id) => [id, "red"])]),
    score: { blue: 0, red: 0 }, // the current (or just finished) round
    taps: {}, // playerId -> counted taps over the whole series
    lastN: {}, // playerId -> last tap counter seen
    recent: {}, // playerId -> timestamps of counted taps in the last second
    rejected: 0,
    startAt: 0,
    endsAt: 0,
    lastBroadcast: 0,
    winner: null, // the series: "blue" | "red" | "draw"
    doubleDraw: false, // two drawn rounds in a row: everybody loses a life
    message: null,
  };
}

function publicState(mg, now) {
  const s = mg.tow;
  return {
    phase: s.phase,
    teams: s.teams,
    score: { ...s.score },
    taps: { ...s.taps },
    position: ropePosition(s.score.blue, s.score.red, s.teams.blue.length),
    round: s.round,
    wins: { ...s.wins },
    winsNeeded: CONFIG.WINS_NEEDED,
    rounds: s.rounds.map((r) => ({ ...r, score: { ...r.score } })),
    startAt: s.startAt,
    endsAt: s.endsAt,
    serverNow: now,
    winner: s.winner,
    doubleDraw: s.doubleDraw,
    message: s.message,
  };
}

function onSync(mg, nowTs, ctx) {
  const s = mg.tow;
  // re-check right before starting: somebody may have left since the round ended
  const present = new Set(ctx.players().map((p) => p.id));
  if (!mg.contestantIds.every((id) => present.has(id)) || !canPlay(mg.contestantIds.length)) {
    s.phase = "cancelled";
    s.message = CANCEL_MESSAGE;
    ctx.emitAll("tow:state", publicState(mg, nowTs));
    ctx.setTimer(() => ctx.resolveNow(), 4000);
    return;
  }
  s.startAt = nowTs + CONFIG.PREP_MS;
  s.endsAt = s.startAt + CONFIG.PLAY_MS;
  ctx.emitAll("tow:go", { startAt: s.startAt, endsAt: s.endsAt, serverNow: nowTs, teams: s.teams });
  ctx.emitAll("tow:state", publicState(mg, nowTs));
  ctx.setTimer(() => begin(mg, ctx), s.startAt - nowTs);
}

function begin(mg, ctx) {
  const s = mg.tow;
  if (s.phase !== "prep" && s.phase !== "break") return;
  s.phase = "live";
  s.score = { blue: 0, red: 0 };
  ctx.emitAll("tow:state", publicState(mg, ctx.now()));
  ctx.setTimer(() => finish(mg, ctx), Math.max(0, s.endsAt - ctx.now()));
}

function finish(mg, ctx) {
  const s = mg.tow;
  if (s.phase !== "live") return;
  const { blue, red } = s.score;
  const roundWinner = blue === red ? "draw" : blue > red ? "blue" : "red";
  s.rounds.push({ winner: roundWinner, score: { ...s.score } });
  if (roundWinner !== "draw") s.wins[roundWinner] += 1;
  const now = ctx.now();
  const prev = s.rounds[s.rounds.length - 2];
  s.doubleDraw = roundWinner === "draw" && prev?.winner === "draw";
  const over =
    s.doubleDraw ||
    s.wins.blue >= CONFIG.WINS_NEEDED ||
    s.wins.red >= CONFIG.WINS_NEEDED ||
    s.rounds.length >= CONFIG.MAX_ROUNDS;
  if (!over) {
    s.phase = "break";
    s.round += 1;
    s.startAt = now + CONFIG.BREAK_MS;
    s.endsAt = s.startAt + CONFIG.PLAY_MS;
    ctx.emitAll("tow:state", publicState(mg, now));
    ctx.setTimer(() => begin(mg, ctx), CONFIG.BREAK_MS);
    return;
  }
  s.phase = "done";
  if (s.doubleDraw) s.winner = "draw";
  else s.winner = s.wins.blue === s.wins.red ? "draw" : s.wins.blue > s.wins.red ? "blue" : "red";
  ctx.emitAll("tow:state", publicState(mg, now));
  ctx.resolveNow();
}

function onClientEvent(mg, playerId, name, data, ctx) {
  if (name !== "tow:pull") return;
  const s = mg.tow;
  const now = ctx.now();
  if (!s || s.phase !== "live" || now < s.startAt || now >= s.endsAt) return;
  const team = s.teamOf[playerId];
  if (!team) return;
  const n = Number(data?.n);
  if (!Number.isSafeInteger(n) || n <= (s.lastN[playerId] ?? 0)) return; // replay / garbage
  s.lastN[playerId] = n;
  const recent = (s.recent[playerId] || []).filter((t) => now - t < 1000);
  if (recent.length >= CONFIG.MAX_TAPS_PER_SEC) {
    s.recent[playerId] = recent;
    s.rejected += 1;
    return; // too fast: not counted
  }
  recent.push(now);
  s.recent[playerId] = recent;
  s.score[team] += 1;
  s.taps[playerId] = (s.taps[playerId] || 0) + 1;
  if (now - s.lastBroadcast >= CONFIG.BROADCAST_EVERY_MS) {
    s.lastBroadcast = now;
    ctx.emitAll("tow:state", publicState(mg, now));
  }
}

// ---------------------------------------------------------------- results

function resolveLosers(mg) {
  const s = mg.tow;
  if (!s) return [];
  if (s.doubleDraw) return [...s.teams.blue, ...s.teams.red]; // two draws in a row: everybody
  if (s.winner !== "blue" && s.winner !== "red") return [];
  return s.winner === "blue" ? [...s.teams.red] : [...s.teams.blue];
}

function buildResults(mg) {
  const s = mg.tow;
  return {
    minigameScores: { ...s.taps },
    teams: s.teams,
    score: { ...s.score },
    wins: { ...s.wins },
    rounds: s.rounds.map((r) => ({ ...r, score: { ...r.score } })),
    winner: s.winner,
    doubleDraw: s.doubleDraw,
    cancelled: s.phase === "cancelled",
    message: s.message,
    position: ropePosition(s.score.blue, s.score.red, s.teams.blue.length),
  };
}

module.exports = {
  ID,
  RARE,
  CONFIG,
  TEAM_SIZES,
  CANCEL_MESSAGE,
  TOTAL_DURATION_MS,
  canPlay,
  makeTeams,
  ropePosition,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  resolveLosers,
  buildResults,
  publicState,
};
