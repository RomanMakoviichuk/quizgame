/**
 * «Ідеальна секунда» (id: perfectSecond) — stop your own clock at exactly 10.00 s.
 *
 * Trigger: at least ONE player got the quiz question wrong; everyone alive plays.
 *
 * Three rounds, the same for everybody. A round: a 3-2-1 countdown, then a timer
 * on the TV counts from 0.00 and vanishes at `hideMs` (8 / 6 / 5 s); the players
 * keep counting in their heads and press СТОП on the phone at what they think is
 * 10.00 s. The round closes when everybody has stopped or LIMIT_MS after the start.
 *
 * Timeline (server clock): PREP (title + rules) -> round 1 [COUNTDOWN -> live ->
 * RESULT] -> round 2 -> round 3 -> the final board (resolve).
 *
 * Time: the TV and the phones sync their clocks to the server's (`ps:ping` /
 * `ps:pong`, the sample with the shortest round trip wins), so the TV draws the
 * timer from the shared `startAt` and a phone stamps its tap in server time
 * (`ps:stop { at }`). The server keeps that stamp only within sane bounds of when
 * the tap arrived (never in the future, never long ago), one per player per
 * round; the phones are never told anyone's time before the round result.
 *
 * Points per round by the error |elapsed - 10000 ms| (exact ms, equal errors
 * share the place): 1st +5, 2nd +3, 3rd +2, every other stop +1, no stop 0.
 * Lives: the lowest total loses ONE life (ties: the bigger summed error, a missed
 * round counting LIMIT_MS); everybody exactly equal -> nobody. The single best
 * total gets the usual minigame bonus.
 */
const placing = require("./placing");

const ID = "perfectSecond";
const MIN_PLAYERS = 2;

const CONFIG = {
  PREP_MS: Number(process.env.PERFECT_SECOND_PREP_MS) || 14000, // title, the host's line, the rules
  COUNTDOWN_MS: 3000, // 3-2-1 before every round
  TARGET_MS: 10000,
  LIMIT_MS: Number(process.env.PERFECT_SECOND_LIMIT_MS) || 15000, // from the round start: no stop -> missed
  RESULT_MS: Number(process.env.PERFECT_SECOND_RESULT_MS) || 11000, // a round's result on the TV (the needle sweep, then the table)
  LAST_RESULT_MS: 9500, // round 3's result, then the final board
  CLOSE_GRACE_MS: 400, // a stop made before the end may arrive a little after it
  PAST_TOLERANCE_MS: 2500, // a stamp far behind its arrival (stale / forged) is raised to this
};

const ROUNDS = [
  { hideMs: 8000, level: "Легкий", hint: "Ще трішки…" },
  { hideMs: 6000, level: "Середній", hint: "Не поспішай!" },
  { hideMs: 5000, level: "Важкий", hint: "Тепер усе залежить від тебе!" },
];
const TOTAL_DURATION_MS =
  CONFIG.PREP_MS + ROUNDS.length * (CONFIG.COUNTDOWN_MS + CONFIG.LIMIT_MS + CONFIG.CLOSE_GRACE_MS + CONFIG.RESULT_MS) + 10000; // server hard stop

// ---------------------------------------------------------------- scoring (pure)

/** One round's table from the stops { playerId: elapsedMs }, best first (see placing.js). */
const scoreRound = (contestantIds, stops, cfg = CONFIG) => placing.placeRows(contestantIds, stops, cfg.TARGET_MS, "ms");
/** Totals over the rounds played (a missed round counts LIMIT_MS of error). */
const totalsOf = (contestantIds, roundRows, cfg = CONFIG) => placing.totalsOf(contestantIds, roundRows, cfg.LIMIT_MS);
const { rankIds, PLACE_POINTS } = placing;

// ---------------------------------------------------------------- contest

function buildContest({ players, correctIndex, roundIndex }) {
  const failers = players.filter((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex)).map((p) => p.id);
  if (failers.length === 0 || players.length < MIN_PLAYERS) return null;
  return {
    minigameId: ID,
    mode: "all_play_lowest_loses",
    roundIndex,
    contestantIds: players.map((p) => p.id), // EVERYONE plays
    quizFailerIds: failers,
  };
}

function onStart(mg) {
  mg.ps = {
    introEndsAt: 0,
    current: -1, // index into ROUNDS
    rounds: ROUNDS.map(() => ({ countdownAt: 0, startAt: 0, hideAt: 0, endAt: 0, stops: {}, rows: null })),
    outcome: null,
  };
}

const roundMeta = () => ROUNDS.map((r, i) => ({ index: i + 1, hideMs: r.hideMs, level: r.level, hint: r.hint }));

function roundPayload(mg, i, now) {
  const r = mg.ps.rounds[i];
  return {
    round: i + 1,
    of: ROUNDS.length,
    ...roundMeta()[i],
    countdownAt: r.countdownAt,
    startAt: r.startAt,
    hideAt: r.hideAt,
    endAt: r.endAt,
    targetMs: CONFIG.TARGET_MS,
    serverNow: now,
  };
}

function resultPayload(mg, i, now) {
  const r = mg.ps.rounds[i];
  const totals = totalsOf(mg.contestantIds, mg.ps.rounds.slice(0, i + 1).map((x) => x.rows || []));
  return {
    round: i + 1,
    of: ROUNDS.length,
    targetMs: CONFIG.TARGET_MS,
    rows: r.rows,
    totals: totals.points,
    ranked: rankIds(mg.contestantIds, totals),
    nextAt: r.nextAt || 0,
    serverNow: now,
  };
}

const progressPayload = (mg) => {
  const r = mg.ps.rounds[mg.ps.current];
  return { round: mg.ps.current + 1, stoppedIds: r ? Object.keys(r.stops) : [] };
};

function onSync(mg, nowTs, ctx) {
  const s = mg.ps;
  s.introEndsAt = nowTs + CONFIG.PREP_MS;
  ctx.emitAll("ps:go", {
    introEndsAt: s.introEndsAt,
    rounds: roundMeta(),
    targetMs: CONFIG.TARGET_MS,
    limitMs: CONFIG.LIMIT_MS,
    serverNow: nowTs,
  });
  ctx.setTimer(() => startRound(mg, 0, ctx), CONFIG.PREP_MS);
}

function startRound(mg, i, ctx) {
  const s = mg.ps;
  const now = ctx.now();
  const r = s.rounds[i];
  s.current = i;
  r.countdownAt = now;
  r.startAt = now + CONFIG.COUNTDOWN_MS;
  r.hideAt = r.startAt + ROUNDS[i].hideMs;
  r.endAt = r.startAt + CONFIG.LIMIT_MS;
  ctx.emitAll("ps:round", roundPayload(mg, i, now));
  ctx.emitAll("ps:progress", progressPayload(mg));
  ctx.setTimer(() => closeRound(mg, i, ctx), r.endAt - now + CONFIG.CLOSE_GRACE_MS);
}

function closeRound(mg, i, ctx) {
  const s = mg.ps;
  const r = s.rounds[i];
  if (!r || r.rows) return;
  const now = ctx.now();
  r.rows = scoreRound(mg.contestantIds, r.stops);
  const last = i === ROUNDS.length - 1;
  const hold = last ? CONFIG.LAST_RESULT_MS : CONFIG.RESULT_MS;
  r.nextAt = now + hold;
  ctx.emitAll("ps:roundResult", resultPayload(mg, i, now));
  if (last) ctx.scheduleResolve(hold);
  else ctx.setTimer(() => startRound(mg, i + 1, ctx), hold);
}

/** The stamp of a stop, in server time, held to what its arrival allows. */
function acceptStamp(at, now, r, cfg = CONFIG) {
  let t = Number(at);
  if (!Number.isFinite(t)) t = now;
  t = Math.min(t, now); // ahead of its arrival (clock sync error): the arrival
  t = Math.max(t, now - cfg.PAST_TOLERANCE_MS);
  if (t < r.startAt || t > r.endAt) return null; // before the start / after the end
  return Math.round(t - r.startAt);
}

function onClientEvent(mg, playerId, name, data, ctx) {
  const s = mg.ps;
  if (!s) return;
  const now = ctx.now();

  if (name === "ps:ping") {
    ctx.emitPlayer(playerId, "ps:pong", { t: data?.t, s: now });
    return;
  }
  if (name === "ps:hello") {
    sendState(mg, now, (ev, payload) => ctx.emitPlayer(playerId, ev, payload));
    const r = s.rounds[s.current];
    if (r && !r.rows && r.stops[playerId] != null) ctx.emitPlayer(playerId, "ps:ack", { round: s.current + 1 });
    return;
  }
  if (name !== "ps:stop") return;
  const i = s.current;
  const r = s.rounds[i];
  if (!r || r.rows || r.stops[playerId] != null) return; // no round / closed / already stopped
  if (Number(data?.round) !== i + 1) return; // a tap meant for another round
  const ms = acceptStamp(data?.at, now, r);
  if (ms == null) return;
  r.stops[playerId] = ms;
  ctx.emitPlayer(playerId, "ps:ack", { round: i + 1 }); // no time, no result: those come with the round
  ctx.emitAll("ps:progress", progressPayload(mg));
  if (mg.contestantIds.every((id) => r.stops[id] != null)) closeRound(mg, i, ctx); // everybody stopped
}

/** A (re)opened TV: the same clock service and state as a phone. */
function onDisplayEvent(mg, name, data, ctx) {
  const now = ctx.now();
  if (name === "ps:ping") ctx.emitDisplay?.("ps:pong", { t: data?.t, s: now });
  else if (name === "ps:hello") sendState(mg, now, (ev, payload) => ctx.emitDisplay?.(ev, payload));
}

function sendState(mg, now, emit) {
  const s = mg.ps;
  if (!s.introEndsAt) return;
  emit("ps:go", { introEndsAt: s.introEndsAt, rounds: roundMeta(), targetMs: CONFIG.TARGET_MS, limitMs: CONFIG.LIMIT_MS, serverNow: now });
  if (s.current < 0) return;
  emit("ps:round", roundPayload(mg, s.current, now));
  emit("ps:progress", progressPayload(mg));
  if (s.rounds[s.current].rows) emit("ps:roundResult", resultPayload(mg, s.current, now));
}

// ---------------------------------------------------------------- outcome

/** Close whatever round is open and freeze the totals (idempotent). */
function outcomeOf(mg) {
  const s = mg.ps;
  if (s.outcome) return s.outcome;
  for (const r of s.rounds) if (r.startAt && !r.rows) r.rows = scoreRound(mg.contestantIds, r.stops); // a hard stop mid-round
  s.outcome = placing.outcomeOf(mg.contestantIds, s.rounds.filter((r) => r.rows).map((r) => r.rows), CONFIG.LIMIT_MS);
  return s.outcome;
}

function resolveLosers(mg) {
  return [...outcomeOf(mg).loserIds];
}

function resolveWinner(mg) {
  return outcomeOf(mg).winnerId;
}

function buildResults(mg) {
  const o = outcomeOf(mg);
  return {
    minigameScores: { ...o.points },
    perfectSecond: {
      targetMs: CONFIG.TARGET_MS,
      rounds: mg.ps.rounds.map((r, i) => ({ round: i + 1, level: ROUNDS[i].level, hideMs: ROUNDS[i].hideMs, rows: r.rows || [] })),
      totals: { ...o.points },
      errSum: { ...o.errSum },
      ranked: [...o.ranked],
      winnerId: o.winnerId,
      // the minigame's loser even when the quiz answer shields their life (results.loserIds leaves them out)
      lowestIds: [...(mg.minigameLoserIds || o.loserIds)],
    },
  };
}

module.exports = {
  ID,
  CONFIG,
  ROUNDS,
  PLACE_POINTS,
  TOTAL_DURATION_MS,
  scoreRound,
  totalsOf,
  rankIds,
  acceptStamp,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  onDisplayEvent,
  resolveLosers,
  resolveWinner,
  buildResults,
};
