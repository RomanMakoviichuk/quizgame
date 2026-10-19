/**
 * «Серед нас: КРИСА» (id: rat) — a secret vote, a social dilemma.
 *
 * Trigger: at least 2 living players got the quiz question wrong.
 * Participants (T): exactly those players. The list is fixed when the contest
 * is built and is the only list used for counting votes and for the outcome.
 *
 * Every participant secretly picks "steal" («ПІДМУТИТИ ЗАРЯДКУ») or "keep"
 * («НЕ ЧІПАТИ») during VOTE_MS (30 s) on the server clock. A vote is final: a
 * second vote, a vote before the window or after it are ignored. Nobody learns
 * anyone else's choice (nor the counts) before the window closes — the only
 * public signal is how many have decided.
 *
 * No vote by the end (or the player left without voting) = "keep" by inaction:
 * it counts as "keep" in every rule below and is listed separately as abstained.
 * A player who left keeps their vote (if any) and stays in T.
 *
 * Outcome (S = steal votes, N = T - S):
 *   S = 0          -> "trust":    everybody wins, nobody loses a life
 *   S = T          -> "allRats":  everybody loses a life
 *   S = 1          -> "rat":      the rat wins (+ the usual minigame bonus),
 *                                 everybody else loses a life
 *   1 < S < T      -> "manyRats": the rats got caught — every rat loses a life,
 *                                 the ones who kept their hands off are safe
 * The outcome is computed once, when the vote closes, and never changes.
 * Lives are applied by phases.js (once per minigame, max one life per player).
 */
const ID = "rat";

const CHOICES = ["steal", "keep"];
const MIN_PLAYERS = 2;

const CONFIG = {
  PREP_MS: Number(process.env.RAT_PREP_MS) || 20000, // title + rules + 3-2-1
  VOTE_MS: Number(process.env.RAT_VOTE_MS) || 30000,
  CLOSE_GRACE_MS: 300, // the vote is closed by the time check; this is just when results go out
};
const TOTAL_DURATION_MS = CONFIG.PREP_MS + CONFIG.VOTE_MS + 8000; // server hard stop

const isWrong = (correctIndex) => (p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex);

// ---------------------------------------------------------------- contest

function buildContest({ players, correctIndex, roundIndex }) {
  const failers = players.filter(isWrong(correctIndex));
  if (failers.length < MIN_PLAYERS) return null;
  return {
    minigameId: ID,
    mode: "secret_vote",
    roundIndex,
    contestantIds: failers.map((p) => p.id),
  };
}

function onStart(mg) {
  mg.rat = {
    votes: {}, // playerId -> "steal" | "keep" (secret until the outcome)
    voteStartAt: 0,
    voteEndAt: 0,
    outcome: null, // frozen once computed
  };
}

const goPayload = (mg, now) => ({
  voteStartAt: mg.rat.voteStartAt,
  voteEndAt: mg.rat.voteEndAt,
  serverNow: now,
  total: mg.contestantIds.length,
});
const progressPayload = (mg) => ({ voted: Object.keys(mg.rat.votes).length, total: mg.contestantIds.length });

function onSync(mg, nowTs, ctx) {
  const s = mg.rat;
  s.voteStartAt = nowTs + CONFIG.PREP_MS;
  s.voteEndAt = s.voteStartAt + CONFIG.VOTE_MS;
  ctx.emitAll("rat:go", goPayload(mg, nowTs));
  ctx.emitAll("rat:progress", progressPayload(mg));
  ctx.scheduleResolve(s.voteEndAt - ctx.now() + CONFIG.CLOSE_GRACE_MS);
}

/** Is the vote window open right now (server clock)? */
const votingOpen = (mg, now) => !mg.rat.outcome && mg.rat.voteStartAt > 0 && now >= mg.rat.voteStartAt && now < mg.rat.voteEndAt;

function onClientEvent(mg, playerId, name, data, ctx) {
  const s = mg.rat;
  if (!s) return;
  const now = ctx.now();

  // a phone (re)opened the page: send it the clock and its own locked vote
  if (name === "rat:hello") {
    if (s.voteStartAt) ctx.emitPlayer(playerId, "rat:go", goPayload(mg, now));
    ctx.emitPlayer(playerId, "rat:progress", progressPayload(mg));
    if (s.votes[playerId]) ctx.emitPlayer(playerId, "rat:ack", { choice: s.votes[playerId] });
    return;
  }

  if (name !== "rat:vote") return;
  if (s.votes[playerId]) {
    // already locked: re-confirm the original choice, never change it
    ctx.emitPlayer(playerId, "rat:ack", { choice: s.votes[playerId] });
    return;
  }
  if (!votingOpen(mg, now)) return; // too early / too late / already decided
  const choice = data?.choice;
  if (!CHOICES.includes(choice)) return;

  s.votes[playerId] = choice;
  ctx.emitPlayer(playerId, "rat:ack", { choice });
  ctx.emitAll("rat:progress", progressPayload(mg)); // counts how many decided, never what
}

// ---------------------------------------------------------------- outcome

/** Pure: the outcome for a fixed participant list and their votes. */
function decide(contestantIds, votes) {
  const T = contestantIds.length;
  const stealIds = contestantIds.filter((id) => votes[id] === "steal");
  const keepIds = contestantIds.filter((id) => votes[id] !== "steal"); // includes abstained
  const abstainIds = contestantIds.filter((id) => !votes[id]);
  const S = stealIds.length;

  let scenario;
  let winnerIds;
  let loserIds;
  if (S === 0) {
    scenario = "trust";
    winnerIds = [...contestantIds];
    loserIds = [];
  } else if (S === T) {
    scenario = "allRats";
    winnerIds = [];
    loserIds = [...contestantIds];
  } else if (S === 1) {
    scenario = "rat";
    winnerIds = [...stealIds];
    loserIds = [...keepIds];
  } else {
    scenario = "manyRats";
    winnerIds = [...keepIds];
    loserIds = [...stealIds];
  }
  return { scenario, total: T, steal: S, keep: T - S, stealIds, keepIds, abstainIds, winnerIds, loserIds };
}

/** Close the vote and freeze the outcome (idempotent). */
function outcomeOf(mg) {
  if (!mg.rat.outcome) mg.rat.outcome = decide(mg.contestantIds, mg.rat.votes);
  return mg.rat.outcome;
}

function resolveLosers(mg) {
  return [...outcomeOf(mg).loserIds];
}

/** The lone rat gets the usual minigame bonus; a team win has no single winner. */
function resolveWinner(mg) {
  const o = outcomeOf(mg);
  return o.scenario === "rat" ? o.stealIds[0] : null;
}

function buildResults(mg) {
  const o = outcomeOf(mg);
  return {
    minigameScores: {},
    rat: {
      scenario: o.scenario,
      total: o.total,
      steal: o.steal,
      keep: o.keep,
      stealIds: [...o.stealIds],
      keepIds: [...o.keepIds],
      abstainIds: [...o.abstainIds],
      winnerIds: [...o.winnerIds],
    },
  };
}

module.exports = {
  ID,
  CONFIG,
  CHOICES,
  MIN_PLAYERS,
  TOTAL_DURATION_MS,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  decide,
  resolveLosers,
  resolveWinner,
  buildResults,
};
