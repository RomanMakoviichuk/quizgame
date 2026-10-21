/**
 * «До міліметра!» (id: tapeMeasure) — pull a tape measure out to exactly N cm.
 *
 * Trigger: at least ONE player got the quiz question wrong; everyone alive plays.
 *
 * The tape is life-size on the phone (1 cm on the glass ≈ 1 cm), the case at the
 * bottom, the blade pulled up to the top of the screen at most (8–13 cm, by phone).
 * While the TV explains the rules the phones already pull a practice tape (not
 * scored): the blade shows its scale, so everybody gets a feel for a few cm and
 * sees how far their phone goes. Then three rounds with a
 * blank blade (judge it by eye), each a random target of 3.0–7.5 cm (whole mm,
 * the rounds' targets at least MIN_GAP_MM apart) — the same for everybody.
 * A round: the host's line + the target, then ROUND_MS to pull and press
 * ЗАФІКСУВАТИ. Closes when everybody has locked or the time is up; no lock ->
 * «Не встиг».
 *
 * Timeline (server clock): PRACTICE (the rules + the practice pull) -> round 1 [INTRO ->
 * pulling -> RESULT] -> round 2 -> round 3 -> the final board (resolve).
 *
 * The length is the phone's own measurement (the tape lives there), sent once
 * per round in millimetres (0.1 mm); the server keeps the first lock only,
 * clamps it to the tape, and never tells anybody else's length before the result.
 *
 * Points per round by the error |length - target| (shared places, see
 * placing.js): 1st +5, 2nd +3, 3rd +2, every other lock +1, no lock 0.
 * Lives: the lowest total loses ONE life (ties: the bigger summed error, a
 * missing lock counting MAX_MM); everybody exactly equal -> nobody.
 */
const crypto = require("crypto");
const placing = require("./placing");

const ID = "tapeMeasure";
const MIN_PLAYERS = 2;

const CONFIG = {
  PRACTICE_MS: Number(process.env.TAPE_PRACTICE_MS) || 30000, // the rules on the TV = the practice pull on the phones (with the scale, not scored)
  INTRO_MS: 5000, // the host's line and the target, the last 3 s count down
  ROUND_MS: Number(process.env.TAPE_ROUND_MS) || 20000, // pulling + locking
  RESULT_MS: Number(process.env.TAPE_RESULT_MS) || 12000, // a round's result on the TV (tapes out, then the zoom)
  LAST_RESULT_MS: 10000, // round 3's result, then the final board
  CLOSE_GRACE_MS: 400, // a lock made before the end may arrive a little after it
  MAX_MM: 200, // no phone is taller than 20 cm: anything past it is nonsense
  TARGET_MM: [30, 75], // every round's target, whole mm (fits the shortest phone)
  MIN_GAP_MM: 8, // the three targets differ at least this much
};

const ROUNDS = [
  { level: "Розминка", host: "Так, майстри ремонту! Витягуємо рівно {cm} см. Не більше, не менше!" },
  { level: "Точність", host: "А тепер точніше: рівно {cm} см. Око — ватерпас, рука — штангенциркуль!" },
  { level: "Фінальний замір", host: "Останній замір: {cm} см! Хто помилиться, той сьогодні нічого не ремонтує!" },
];
const cmText = (mm) => String(mm / 10).replace(".", ","); // 45 -> "4,5"

const TOTAL_DURATION_MS =
  CONFIG.PRACTICE_MS + ROUNDS.length * (CONFIG.INTRO_MS + CONFIG.ROUND_MS + CONFIG.CLOSE_GRACE_MS + CONFIG.RESULT_MS) + 10000; // server hard stop

// ---------------------------------------------------------------- pure helpers

/**
 * The targets in mm, one per round: random whole mm in TARGET_MM, every two at
 * least MIN_GAP_MM apart. Dev: TAPE_TARGETS=4.5,6,7.2 (cm) fixes them.
 */
function pickTargets(env = process.env.TAPE_TARGETS, cfg = CONFIG) {
  const [lo, hi] = cfg.TARGET_MM;
  const fixed = String(env || "")
    .split(",")
    .map((x) => Math.round(Number(x) * 10))
    .filter((mm) => Number.isFinite(mm) && mm > 0 && mm <= cfg.MAX_MM);
  const out = [];
  for (let i = 0; i < ROUNDS.length; i++) {
    if (fixed[i] != null) {
      out.push(fixed[i]);
      continue;
    }
    let mm;
    for (let tries = 0; tries < 50; tries++) {
      mm = crypto.randomInt(lo, hi + 1);
      if (out.every((o) => Math.abs(o - mm) >= cfg.MIN_GAP_MM)) break;
    }
    out.push(mm);
  }
  return out;
}

/** A lock's length in mm: a number, on the tape (0..MAX_MM), to 0.1 mm. Else null. */
function cleanLength(mm, cfg = CONFIG) {
  const v = Number(mm);
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.max(0, Math.min(cfg.MAX_MM, v)) * 10) / 10;
}

const scoreRound = (contestantIds, locks, targetMm) => placing.placeRows(contestantIds, locks, targetMm, "mm");

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
  const targets = pickTargets();
  mg.tm = {
    introEndsAt: 0,
    practice: null, // { startAt, endAt }
    current: -1,
    rounds: ROUNDS.map((r, i) => ({ targetMm: targets[i], introAt: 0, startAt: 0, endAt: 0, busy: {}, locks: {}, rows: null, nextAt: 0 })),
    outcome: null,
  };
}

const roundMeta = () => ROUNDS.map((r, i) => ({ index: i + 1, level: r.level }));

function roundPayload(mg, i, now) {
  const r = mg.tm.rounds[i];
  const def = ROUNDS[i];
  return {
    round: i + 1,
    of: ROUNDS.length,
    level: def.level,
    host: def.host.replace("{cm}", cmText(r.targetMm)),
    targetMm: r.targetMm,
    maxMm: CONFIG.MAX_MM,
    introAt: r.introAt,
    startAt: r.startAt,
    endAt: r.endAt,
    serverNow: now,
  };
}

function resultPayload(mg, i, now) {
  const r = mg.tm.rounds[i];
  const played = mg.tm.rounds.slice(0, i + 1).map((x) => x.rows || []);
  const totals = placing.totalsOf(mg.contestantIds, played, CONFIG.MAX_MM);
  return {
    round: i + 1,
    of: ROUNDS.length,
    targetMm: r.targetMm,
    rows: r.rows,
    totals: totals.points,
    ranked: placing.rankIds(mg.contestantIds, totals),
    nextAt: r.nextAt,
    serverNow: now,
  };
}

function progressPayload(mg) {
  const r = mg.tm.rounds[mg.tm.current];
  return { round: mg.tm.current + 1, busyIds: r ? Object.keys(r.busy) : [], lockedIds: r ? Object.keys(r.locks) : [] };
}

function goPayload(mg, now) {
  return { introEndsAt: mg.tm.introEndsAt, practiceMs: CONFIG.PRACTICE_MS, rounds: roundMeta(), maxMm: CONFIG.MAX_MM, serverNow: now };
}

function onSync(mg, nowTs, ctx) {
  mg.tm.introEndsAt = nowTs + CONFIG.PRACTICE_MS;
  ctx.emitAll("tm:go", goPayload(mg, nowTs));
  startPractice(mg, ctx); // the rules on the TV, the practice pull on the phones — at once
}

/** The practice pull: the blade with its scale, nothing sent, nothing scored. */
function startPractice(mg, ctx) {
  const now = ctx.now();
  mg.tm.practice = { startAt: now, endAt: now + CONFIG.PRACTICE_MS };
  ctx.emitAll("tm:practice", { ...mg.tm.practice, serverNow: now });
  ctx.setTimer(() => startRound(mg, 0, ctx), CONFIG.PRACTICE_MS);
}

function startRound(mg, i, ctx) {
  const s = mg.tm;
  const now = ctx.now();
  const r = s.rounds[i];
  s.current = i;
  r.introAt = now;
  r.startAt = now + CONFIG.INTRO_MS;
  r.endAt = r.startAt + CONFIG.ROUND_MS;
  ctx.emitAll("tm:round", roundPayload(mg, i, now));
  ctx.emitAll("tm:progress", progressPayload(mg));
  ctx.setTimer(() => closeRound(mg, i, ctx), r.endAt - now + CONFIG.CLOSE_GRACE_MS);
}

function closeRound(mg, i, ctx) {
  const r = mg.tm.rounds[i];
  if (!r || r.rows) return;
  const now = ctx.now();
  r.rows = scoreRound(mg.contestantIds, r.locks, r.targetMm);
  const last = i === ROUNDS.length - 1;
  const hold = last ? CONFIG.LAST_RESULT_MS : CONFIG.RESULT_MS;
  r.nextAt = now + hold;
  ctx.emitAll("tm:roundResult", resultPayload(mg, i, now));
  if (last) ctx.scheduleResolve(hold);
  else ctx.setTimer(() => startRound(mg, i + 1, ctx), hold);
}

function sendState(mg, now, emit) {
  const s = mg.tm;
  if (!s.introEndsAt) return;
  emit("tm:go", goPayload(mg, now));
  if (s.practice) emit("tm:practice", { ...s.practice, serverNow: now });
  if (s.current < 0) return;
  emit("tm:round", roundPayload(mg, s.current, now));
  emit("tm:progress", progressPayload(mg));
  if (s.rounds[s.current].rows) emit("tm:roundResult", resultPayload(mg, s.current, now));
}

function onClientEvent(mg, playerId, name, data, ctx) {
  const s = mg.tm;
  if (!s) return;
  const now = ctx.now();
  if (name === "tm:hello") {
    sendState(mg, now, (ev, payload) => ctx.emitPlayer(playerId, ev, payload));
    const r = s.rounds[s.current];
    if (r && r.locks[playerId] != null) ctx.emitPlayer(playerId, "tm:ack", { round: s.current + 1, mm: r.locks[playerId] });
    return;
  }
  const i = s.current;
  const r = s.rounds[i];
  if (!r || r.rows || Number(data?.round) !== i + 1) return; // no round / closed / meant for another round
  if (now < r.startAt || now > r.endAt + CONFIG.CLOSE_GRACE_MS) return; // before the start / after the end
  if (r.locks[playerId] != null) return; // locked already: nothing changes it

  if (name === "tm:busy") {
    // the TV shows who is measuring (never how much)
    if (r.busy[playerId]) return;
    r.busy[playerId] = true;
    ctx.emitAll("tm:progress", progressPayload(mg));
    return;
  }
  if (name !== "tm:lock") return;
  const mm = cleanLength(data?.mm);
  if (mm == null) return;
  r.locks[playerId] = mm;
  r.busy[playerId] = true;
  ctx.emitPlayer(playerId, "tm:ack", { round: i + 1, mm });
  ctx.emitAll("tm:progress", progressPayload(mg));
  if (mg.contestantIds.every((id) => r.locks[id] != null)) closeRound(mg, i, ctx); // everybody locked
}

function onDisplayEvent(mg, name, data, ctx) {
  if (name === "tm:hello") sendState(mg, ctx.now(), (ev, payload) => ctx.emitDisplay?.(ev, payload));
}

// ---------------------------------------------------------------- outcome

/** Close whatever round is open and freeze the totals (idempotent). */
function outcomeOf(mg) {
  const s = mg.tm;
  if (s.outcome) return s.outcome;
  for (const r of s.rounds) if (r.startAt && !r.rows) r.rows = scoreRound(mg.contestantIds, r.locks, r.targetMm); // a hard stop mid-round
  s.outcome = placing.outcomeOf(mg.contestantIds, s.rounds.filter((r) => r.rows).map((r) => r.rows), CONFIG.MAX_MM);
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
    tapeMeasure: {
      rounds: mg.tm.rounds.map((r, i) => ({ round: i + 1, level: ROUNDS[i].level, targetMm: r.targetMm, rows: r.rows || [] })),
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
  TOTAL_DURATION_MS,
  pickTargets,
  cleanLength,
  scoreRound,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  onDisplayEvent,
  resolveLosers,
  resolveWinner,
  buildResults,
};
