/**
 * Final race rules — pure functions, no io, no timers (phases.js drives them).
 *
 *   createRace(players)            everyone races; start cell from the rating vs the leader
 *   beginStep(race, correctIndex)  open a question
 *   submitAnswer(race, id, index)  first answer per player only; server arrival seq
 *   resolveStep(race)              move 4/3/2 -> exit check -> darkness -> end check
 *
 * Participant status: "racing" -> "escaped" (exactly one: race.winnerId)
 *                               -> "consumed" (darkness reached their cell)
 * `wasGhost` is display-only: ghosts race on equal terms.
 */
const { FINAL } = require("./config");

// ALL_CONSUMED (the shadow took everyone in the final) and DRAW (everyone died
// before the final) both end the game without a winner — a draw.
const ENDING = { ESCAPED: "escaped", ALL_CONSUMED: "all_consumed", DRAW: "draw" };

/**
 * Rating -> start cell, relative to the best rating in the final:
 * the leader starts in the middle (START_MAX), 0 points on START_MIN, everyone
 * else in proportion (half the leader's points -> halfway). Always START_MIN..START_MAX.
 */
function startPosition(score, bestScore) {
  const s = Math.max(0, Number(score) || 0);
  const best = Math.max(0, Number(bestScore) || 0);
  if (best <= 0) return FINAL.START_MIN;
  const share = Math.min(1, s / best);
  return FINAL.START_MIN + Math.round(share * (FINAL.START_MAX - FINAL.START_MIN));
}

function darknessScheduleFor(playerCount) {
  return (
    FINAL.DARKNESS.find((s) => playerCount <= s.maxPlayers) ||
    FINAL.DARKNESS[FINAL.DARKNESS.length - 1]
  );
}

/** Darkness cell after `step` questions have been resolved. */
function darknessAt(step, playerCount) {
  const sched = darknessScheduleFor(playerCount);
  let pos = FINAL.DARKNESS_START;
  for (let i = sched.grace + 1; i <= step; i++) {
    const phase = sched.phases.find((p) => i <= p.untilStep);
    pos += phase ? phase.delta : 0;
  }
  return pos;
}

function createRace(players) {
  const best = Math.max(0, ...players.map((p) => Number(p.score) || 0));
  const participants = players.map((p) => ({
    id: p.id,
    name: p.name,
    characterSlot: p.characterSlot ?? 1,
    wasGhost: !!p.isGhost,
    score: p.score || 0,
    start: startPosition(p.score, best),
    pos: startPosition(p.score, best),
    status: "racing",
    consumedAtStep: null,
    disconnected: false,
  }));
  return {
    participants,
    playerCount: participants.length,
    step: 0,
    darkness: FINAL.DARKNESS_START,
    exit: FINAL.EXIT,
    winnerId: null,
    ending: null,
    open: false, // accepting answers
    correctIndex: null,
    answers: new Map(), // playerId -> { answerIndex, seq }
    seq: 0,
  };
}

const byId = (race, id) => race.participants.find((p) => p.id === id) || null;

/** Racing and still connected — the players a question waits for. */
function activeRacers(race) {
  return race.participants.filter((p) => p.status === "racing" && !p.disconnected);
}

function beginStep(race, correctIndex) {
  if (race.ending) return false;
  race.step += 1;
  race.open = true;
  race.correctIndex = correctIndex;
  race.answers = new Map();
  race.seq = 0;
  return true;
}

/** Only a racing player's first answer counts. Returns { accepted }. */
function submitAnswer(race, playerId, answerIndex) {
  if (!race.open) return { accepted: false };
  const p = byId(race, playerId);
  if (!p || p.status !== "racing" || p.disconnected) return { accepted: false };
  if (race.answers.has(playerId)) return { accepted: false };
  const idx = Number(answerIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return { accepted: false };
  race.seq += 1;
  race.answers.set(playerId, { answerIndex: idx, seq: race.seq });
  return { accepted: true };
}

function allAnswered(race) {
  const active = activeRacers(race);
  return active.length > 0 && active.every((p) => race.answers.has(p.id));
}

function markDisconnected(race, playerId) {
  const p = byId(race, playerId);
  if (p) p.disconnected = true;
}

/**
 * Close the question and apply it. Order inside a step:
 *   1. correct answers move by server arrival: FINAL.MOVES for the first three
 *      (+4/+3/+2), then MOVE_OTHER_CORRECT (+1) for every later one; capped at EXIT
 *   2. whoever reached EXIT with the earliest seq wins -> race over
 *   3. otherwise the darkness advances; racers on or behind it are consumed
 *   4. nobody left racing (and connected) -> "all consumed" ending
 */
function resolveStep(race) {
  if (!race.open) return null;
  race.open = false;

  const correct = [...race.answers.entries()]
    .filter(([id, a]) => a.answerIndex === race.correctIndex && byId(race, id)?.status === "racing")
    .sort((a, b) => a[1].seq - b[1].seq)
    .map(([id]) => id);

  const movers = correct.map((id, rank) => {
    const p = byId(race, id);
    const from = p.pos;
    p.pos = Math.min(race.exit, p.pos + (FINAL.MOVES[rank] ?? FINAL.MOVE_OTHER_CORRECT));
    return { id, rank: rank + 1, from, to: p.pos };
  });

  const result = {
    step: race.step,
    correctIndex: race.correctIndex,
    correctIds: correct,
    answeredIds: [...race.answers.keys()],
    movers,
    darkness: { from: race.darkness, to: race.darkness },
    consumed: [],
    winnerId: null,
    ending: null,
  };

  const finisher = movers.find((m) => m.to >= race.exit); // movers are in seq order
  if (finisher) {
    byId(race, finisher.id).status = "escaped";
    race.winnerId = finisher.id;
    race.ending = ENDING.ESCAPED;
    result.winnerId = finisher.id;
    result.ending = race.ending;
    return result;
  }

  race.darkness = darknessAt(race.step, race.playerCount);
  result.darkness.to = race.darkness;
  for (const p of race.participants) {
    if (p.status === "racing" && p.pos <= race.darkness) {
      p.status = "consumed";
      p.consumedAtStep = race.step;
      result.consumed.push(p.id);
    }
  }

  if (activeRacers(race).length === 0) {
    race.ending = ENDING.ALL_CONSUMED;
    result.ending = race.ending;
  }
  return result;
}

/** Winner, then racers by cell, then consumed (latest first); rating breaks ties. */
function standings(race) {
  const rankOf = (p) => (p.status === "escaped" ? 0 : p.status === "racing" ? 1 : 2);
  return [...race.participants]
    .sort(
      (a, b) =>
        rankOf(a) - rankOf(b) ||
        (b.consumedAtStep ?? 0) - (a.consumedAtStep ?? 0) ||
        b.pos - a.pos ||
        b.score - a.score ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .map((p, i) => ({ place: i + 1, ...publicParticipant(p) }));
}

function publicParticipant(p) {
  return {
    id: p.id,
    name: p.name,
    characterSlot: p.characterSlot,
    wasGhost: p.wasGhost,
    score: p.score,
    start: p.start,
    pos: p.pos,
    status: p.status,
    consumedAtStep: p.consumedAtStep,
    disconnected: p.disconnected,
  };
}

/** Wire snapshot of the race (no answers, no correct index). */
function publicState(race) {
  return {
    step: race.step,
    exit: race.exit,
    darkness: race.darkness,
    winnerId: race.winnerId,
    ending: race.ending,
    participants: race.participants.map(publicParticipant),
  };
}

module.exports = {
  ENDING,
  startPosition,
  darknessAt,
  createRace,
  beginStep,
  submitAnswer,
  allAnswered,
  markDisconnected,
  resolveStep,
  standings,
  publicState,
};
