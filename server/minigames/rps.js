/**
 * "Камінь-Ножиці-Папір-Паяльник-Янукович" — multiplayer elimination minigame.
 *
 * Trigger: 2+ players got the quiz question wrong (0 or 1 -> not this minigame).
 * Participants: only the players who answered the quiz question WRONG.
 * Life loss: exactly one player — the last one eliminated (the decisive round).
 *
 * Five options, each beats two and loses to two (see BEATS / VERBS):
 *   Ножиці ріжуть папір        Ножиці розрізають паяльник
 *   Папір накриває камінь      Папір накриває Януковича
 *   Камінь роздавлює паяльник  Камінь ламає ножиці
 *   Паяльник пече Януковича    Паяльник пропалює папір
 *   Янукович краде ножиці      Янукович викидає камінь
 *
 * Round outcome (`resolveRoundOutcome`, unit-tested) — see below.
 * Server-authoritative: the server runs every round, hides choices until the
 * reveal, auto-picks for anyone who times out, and decides the loser.
 */
const crypto = require("crypto");

const ID = "rps";

const CHOICE_MS = Number(process.env.RPS_CHOICE_MS) || 10000; // pick window per round
const REVEAL_MS = Number(process.env.RPS_REVEAL_MS) || 9000; // flip + battle animation + time to read
// 20 s to read the on-screen rules (5 fighters, 10 rules) + a 3-2-1 countdown at the end
const PREP_MS = Number(process.env.RPS_PREP_MS) || 23000;
const MAX_ROUNDS = 15; // safety valve against an endless tie loop
const TOTAL_DURATION_MS = PREP_MS + MAX_ROUNDS * (CHOICE_MS + REVEAL_MS) + 8000;

const CHOICES = ["rock", "scissors", "paper", "solder", "yanukovych"];
/** choice -> the two choices it beats */
const BEATS = {
  rock: ["solder", "scissors"],
  scissors: ["paper", "solder"],
  paper: ["rock", "yanukovych"],
  solder: ["yanukovych", "paper"],
  yanukovych: ["scissors", "rock"],
};
/** "winner>loser" -> verb, for the reveal captions */
const VERBS = {
  "scissors>paper": "ріжуть",
  "paper>rock": "накриває",
  "rock>solder": "роздавлює",
  "solder>yanukovych": "пече",
  "yanukovych>scissors": "краде",
  "scissors>solder": "розрізають",
  "solder>paper": "пропалює",
  "paper>yanukovych": "накриває",
  "yanukovych>rock": "викидає",
  "rock>scissors": "ламає",
};
const beats = (a, b) => BEATS[a].includes(b);
const randChoice = () => CHOICES[crypto.randomInt(0, CHOICES.length)];

/**
 * Pure. Given { playerId: choice } for the players still in, decide the round.
 * Returns { winningChoice, continued[], eliminated[], replay, scores, outChoices }.
 *
 *   everyone the same               -> replay
 *   one choice beats every other    -> only that choice continues
 *     shown choice (always the case with 2 different choices)
 *   otherwise (a cycle)             -> points: +1 for every rival player your
 *                                      choice beats, -1 for every one that beats
 *                                      it; the lowest score is out. Everybody
 *                                      level -> replay.
 * `scores` is { choice: points } for the choices shown (null when not used).
 */
function resolveRoundOutcome(choicesByPlayer) {
  const ids = Object.keys(choicesByPlayer);
  const distinct = [...new Set(ids.map((id) => choicesByPlayer[id]))];
  const replay = { winningChoice: null, continued: [...ids], eliminated: [], replay: true, scores: null, outChoices: [] };
  const split = (outChoices, winningChoice, scores) => ({
    winningChoice,
    continued: ids.filter((id) => !outChoices.includes(choicesByPlayer[id])),
    eliminated: ids.filter((id) => outChoices.includes(choicesByPlayer[id])),
    replay: false,
    scores,
    outChoices,
  });

  if (distinct.length < 2) return replay;

  const top = distinct.find((c) => distinct.every((o) => o === c || beats(c, o)));
  if (top) return split(distinct.filter((c) => c !== top), top, null);

  const count = Object.fromEntries(distinct.map((c) => [c, ids.filter((id) => choicesByPlayer[id] === c).length]));
  const scores = Object.fromEntries(
    distinct.map((c) => [
      c,
      distinct.reduce((sum, o) => sum + (beats(c, o) ? count[o] : beats(o, c) ? -count[o] : 0), 0),
    ])
  );
  const lowest = Math.min(...Object.values(scores));
  const outChoices = distinct.filter((c) => scores[c] === lowest);
  if (outChoices.length === distinct.length) return { ...replay, scores };
  return split(outChoices, null, scores);
}

/**
 * Among the players eliminated in the decisive round, exactly one loses a life:
 *   1. a player who did NOT submit (auto-picked) forfeits first
 *   2. else the player who locked their choice latest (slowest)
 *   3. else higher playerId (pure determinism)
 */
function pickLifeLoser(eliminated, choiceAtById, choseById) {
  if (!eliminated.length) return null;
  if (eliminated.length === 1) return eliminated[0];
  const forfeit = eliminated.filter((id) => !choseById[id]);
  const pool = forfeit.length ? forfeit : eliminated;
  return [...pool].sort((a, b) => {
    const ta = choiceAtById[a] || 0;
    const tb = choiceAtById[b] || 0;
    if (ta !== tb) return tb - ta; // later -> loses
    return a < b ? 1 : -1; // higher id -> loses
  })[0];
}

// ---------------------------------------------------------------- contest

function buildContest({ players, correctIndex, roundIndex }) {
  const wrong = players
    .filter((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex))
    .map((p) => p.id);
  if (wrong.length < 2) return null; // 0 or 1 wrong -> not RPS

  return {
    minigameId: ID,
    mode: "elimination",
    roundIndex,
    contestantIds: wrong, // only the players who failed the quiz
  };
}

function onStart(mg) {
  mg.rps = {
    alive: [...mg.contestantIds],
    round: 0,
    phase: "prep",
    choices: {}, // this round: playerId -> choice
    choiceAt: {}, // this round: playerId -> ts (0 = auto-picked)
    history: [],
    winner: null,
    lifeLoser: null,
    finalEliminated: [],
  };
}

function onSync(mg, nowTs, ctx) {
  const s = mg.rps;
  s.startAt = nowTs + PREP_MS;
  ctx.emitAll("rps:go", { startAt: s.startAt, serverNow: nowTs });
  ctx.setTimer(() => startRound(mg, ctx), s.startAt - ctx.now());
}

function startRound(mg, ctx) {
  const s = mg.rps;
  s.round += 1;
  s.phase = "choosing";
  s.choices = {};
  s.choiceAt = {};
  const deadlineAt = ctx.now() + CHOICE_MS;
  ctx.emitAll("rps:round", {
    round: s.round,
    alive: s.alive,
    deadlineAt,
    choiceMs: CHOICE_MS,
  });
  ctx.setTimer(() => finishChoosing(mg, ctx), CHOICE_MS + 50);
}

function onClientEvent(mg, playerId, name, data, ctx) {
  if (name !== "rps:choose") return;
  const s = mg.rps;
  if (s.phase !== "choosing") return;
  if (!s.alive.includes(playerId)) return; // eliminated players can't submit
  if (s.choices[playerId]) return; // one choice per round

  const choice = String(data.choice || "");
  if (!CHOICES.includes(choice)) return;

  s.choices[playerId] = choice;
  s.choiceAt[playerId] = ctx.now();
  ctx.emitPlayer(playerId, "rps:locked", { round: s.round, choice });
  ctx.emitAll("rps:progress", {
    round: s.round,
    submitted: s.alive.filter((id) => s.choices[id]).length,
    total: s.alive.length,
    lockedIds: s.alive.filter((id) => s.choices[id]),
  });

  if (s.alive.every((id) => s.choices[id])) finishChoosing(mg, ctx);
}

function finishChoosing(mg, ctx) {
  const s = mg.rps;
  if (s.phase !== "choosing") return;
  s.phase = "reveal";

  // auto-pick a random choice for anyone who didn't submit
  for (const id of s.alive) {
    if (!s.choices[id]) {
      s.choices[id] = randChoice();
      s.choiceAt[id] = 0; // 0 marks an auto-pick
    }
  }

  const roundChoices = Object.fromEntries(s.alive.map((id) => [id, s.choices[id]]));
  const outcome = resolveRoundOutcome(roundChoices);

  s.history.push({
    round: s.round,
    choices: { ...roundChoices },
    winningChoice: outcome.winningChoice,
    continued: [...outcome.continued],
    eliminated: [...outcome.eliminated],
  });

  ctx.emitAll("rps:reveal", {
    round: s.round,
    choices: roundChoices,
    winningChoice: outcome.winningChoice,
    continued: outcome.continued,
    eliminated: outcome.eliminated,
    replay: outcome.replay,
    scores: outcome.scores,
    outChoices: outcome.outChoices,
  });

  const nextAlive = outcome.replay ? s.alive : outcome.continued;
  const decisive = nextAlive.length === 1 && outcome.eliminated.length > 0;
  const choiceAtSnapshot = { ...s.choiceAt };

  ctx.setTimer(() => {
    if (decisive) {
      s.finalEliminated = [...outcome.eliminated];
      s.winner = nextAlive[0];
      s.alive = nextAlive;
      const chose = Object.fromEntries(
        s.finalEliminated.map((id) => [id, (choiceAtSnapshot[id] || 0) > 0])
      );
      s.lifeLoser = pickLifeLoser(s.finalEliminated, choiceAtSnapshot, chose);
      s.phase = "done";
      ctx.resolveNow();
      return;
    }

    s.alive = nextAlive;

    if (s.round >= MAX_ROUNDS) {
      // safety valve: an endless tie loop — the survivor who locked latest loses
      s.finalEliminated = [...s.alive];
      s.lifeLoser = pickLifeLoser(
        s.alive,
        choiceAtSnapshot,
        Object.fromEntries(s.alive.map((id) => [id, (choiceAtSnapshot[id] || 0) > 0]))
      );
      s.winner = s.alive.find((id) => id !== s.lifeLoser) || null;
      s.phase = "done";
      ctx.resolveNow();
      return;
    }

    startRound(mg, ctx);
  }, REVEAL_MS);
}

function resolveLosers(mg) {
  return mg.rps.lifeLoser ? [mg.rps.lifeLoser] : [];
}

/** The last player standing — always exactly one once the contest is decided. */
function resolveWinner(mg) {
  return mg.rps?.winner || null;
}

function buildResults(mg) {
  const s = mg.rps;
  return {
    minigameScores: {},
    winnerId: s.winner || null,
    lifeLoserId: s.lifeLoser || null,
    finalEliminated: s.finalEliminated || [],
    rounds: s.history,
    contestantIds: mg.contestantIds,
  };
}

module.exports = {
  ID,
  TOTAL_DURATION_MS,
  CHOICE_MS,
  REVEAL_MS,
  PREP_MS,
  MAX_ROUNDS,
  CHOICES,
  BEATS,
  VERBS,
  resolveRoundOutcome,
  pickLifeLoser,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  resolveLosers,
  resolveWinner,
  buildResults,
};
