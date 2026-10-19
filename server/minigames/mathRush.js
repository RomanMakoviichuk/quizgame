/**
 * "Тупоматика" (id: mathRush) — fast mental-arithmetic minigame.
 *
 * Trigger: at least ONE player got the quiz question wrong.
 * Participants: EVERYONE plays (the failers get a chance to save themselves).
 * Scoring: +1 for a right answer, -1 for a wrong one (the score may go below 0,
 * so blind tapping never pays).
 * Life loss: exactly one player — the lowest total score (ties broken by pace).
 *
 * Server-authoritative: the server generates the shared question pool, validates
 * every answer, awards points and owns the clock. The client only renders and
 * forwards taps.
 *
 * Pure functions (makeQuestion / makePool / resolveLosers) are unit-tested in
 * mathRush.test.js.
 */
const crypto = require("crypto");

const ID = "mathRush";

// --- tunables (env overrides let tests run fast) ---
const CONFIG = {
  MIN_NUMBER: Number(process.env.MATH_RUSH_MIN) || 5,
  MAX_NUMBER: Number(process.env.MATH_RUSH_MAX) || 20,
  // reading time for the on-screen instruction + a 3-2-1 countdown at the end
  PREP_MS: Number(process.env.MATH_RUSH_PREP_MS) || 15000,
  PLAY_MS: Number(process.env.MATH_RUSH_PLAY_MS) || 30000, // answering window
  POOL_SIZE: 40,
};
const TOTAL_DURATION_MS = CONFIG.PREP_MS + CONFIG.PLAY_MS + 6000; // server hard stop

const rint = (min, max) => crypto.randomInt(min, max + 1);
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * One equation: `+` or `-` only, 4 options, exactly one correct, the three
 * wrong options are within a few of the answer and never negative.
 */
function makeQuestion(cfg = CONFIG) {
  const addition = crypto.randomInt(0, 2) === 0;
  let a;
  let b;
  let answer;
  let text;
  if (addition) {
    a = rint(cfg.MIN_NUMBER, cfg.MAX_NUMBER);
    b = rint(cfg.MIN_NUMBER, cfg.MAX_NUMBER);
    answer = a + b;
    text = `${a} + ${b}`;
  } else {
    // both operands >= MIN, result >= MIN -> never negative, never trivial
    a = rint(cfg.MIN_NUMBER * 2, cfg.MAX_NUMBER);
    b = rint(cfg.MIN_NUMBER, a - cfg.MIN_NUMBER);
    answer = a - b;
    text = `${a} - ${b}`;
  }

  const opts = new Set([answer]);
  for (const d of shuffle([1, -1, 2, -2, 3, -3, 4, -4])) {
    if (opts.size >= 4) break;
    const v = answer + d;
    if (v >= 0) opts.add(v);
  }
  let pad = 5;
  while (opts.size < 4) {
    opts.add(answer + pad);
    pad += 1;
  }
  const options = shuffle([...opts]);
  return { text, options, correctIndex: options.indexOf(answer), answer };
}

function makePool(cfg = CONFIG) {
  return Array.from({ length: cfg.POOL_SIZE }, () => makeQuestion(cfg));
}

// ---------------------------------------------------------------- contest

function buildContest({ players, correctIndex, roundIndex }) {
  const failers = players
    .filter((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex))
    .map((p) => p.id);
  if (failers.length === 0) return null; // everyone correct -> no minigame

  return {
    minigameId: ID,
    mode: "all_play_lowest_loses",
    roundIndex,
    contestantIds: players.map((p) => p.id), // EVERYONE plays
    quizFailerIds: failers,
  };
}

function onStart(mg) {
  mg.pool = makePool();
  mg.mr = {};
  for (const id of mg.contestantIds) {
    mg.mr[id] = { cursor: 0, score: 0, wrong: 0, answered: 0, lastAt: 0 };
  }
}

function questionFor(mg, id) {
  const st = mg.mr[id];
  const q = mg.pool[st.cursor % mg.pool.length];
  return { seq: st.cursor, text: q.text, options: q.options, score: st.score };
}

function snapshot(mg) {
  const out = {};
  for (const id of mg.contestantIds) out[id] = mg.mr[id]?.score ?? 0;
  return out;
}

function onSync(mg, nowTs, ctx) {
  mg.playStartAt = nowTs + CONFIG.PREP_MS;
  mg.playEndAt = mg.playStartAt + CONFIG.PLAY_MS;
  ctx.emitAll("mathRush:go", {
    playStartAt: mg.playStartAt,
    playEndAt: mg.playEndAt,
    serverNow: nowTs,
  });
  for (const id of mg.contestantIds) {
    ctx.emitPlayer(id, "mathRush:question", questionFor(mg, id));
  }
  ctx.scheduleResolve(mg.playEndAt - ctx.now() + 400);
}

function onClientEvent(mg, playerId, name, data, ctx) {
  if (name !== "mathRush:answer") return;
  const st = mg.mr[playerId];
  if (!st) return;

  const now = ctx.now();
  if (now < mg.playStartAt || now > mg.playEndAt) return; // outside window

  const seq = Number(data.seq);
  if (!Number.isInteger(seq) || seq !== st.cursor) return; // stale / double answer

  const q = mg.pool[st.cursor % mg.pool.length];
  const correct = Number(data.choice) === q.correctIndex;
  if (correct) st.score += 1;
  else {
    st.score -= 1; // a wrong answer costs a point
    st.wrong += 1;
  }
  st.answered += 1;
  st.lastAt = now;
  st.cursor += 1;

  ctx.emitPlayer(playerId, "mathRush:question", {
    ...questionFor(mg, playerId),
    prev: { seq, correct },
  });
  ctx.emitAll("mathRush:scores", { scoresById: snapshot(mg) });
}

/**
 * Lowest total score loses ONE life. Ties among the lowest are broken
 * deterministically by performance, in order:
 *   1. fewer questions answered   (slower pace)      -> loses
 *   2. then more wrong answers    (less accurate)    -> loses
 *   3. then later final answer    (slower to finish) -> loses
 *   4. then higher playerId       (pure determinism; should never be reached)
 */
function resolveLosers(mg) {
  const ids = mg.contestantIds;
  if (!ids.length) return [];
  const lowest = Math.min(...ids.map((id) => mg.mr[id].score));
  const tied = ids.filter((id) => mg.mr[id].score === lowest);
  if (tied.length === 1) return tied;

  tied.sort((x, y) => {
    const A = mg.mr[x];
    const B = mg.mr[y];
    if (A.answered !== B.answered) return A.answered - B.answered;
    if (A.wrong !== B.wrong) return B.wrong - A.wrong;
    if (A.lastAt !== B.lastAt) return B.lastAt - A.lastAt;
    return x < y ? 1 : -1;
  });
  return [tied[0]];
}

/**
 * The rating bonus goes to a single clear winner: highest score, ties broken by
 * fewer wrong answers, then the earlier final answer, then lower playerId.
 * Nobody scored, or fewer than two players -> no winner.
 */
function resolveWinner(mg) {
  const ids = mg.contestantIds || [];
  if (ids.length < 2) return null;
  const best = Math.max(...ids.map((id) => mg.mr[id].score));
  if (best <= 0) return null;
  const tied = ids.filter((id) => mg.mr[id].score === best);
  tied.sort((x, y) => {
    const A = mg.mr[x];
    const B = mg.mr[y];
    if (A.wrong !== B.wrong) return A.wrong - B.wrong;
    if (A.lastAt !== B.lastAt) return A.lastAt - B.lastAt;
    return x < y ? -1 : 1;
  });
  return tied[0];
}

function buildResults(mg) {
  const scores = snapshot(mg);
  const loser = (mg.pendingLoserIds || [])[0];
  const ranked = [...mg.contestantIds].sort((a, b) => scores[b] - scores[a]);
  return {
    minigameScores: scores,
    ranked,
    quizFailerIds: mg.quizFailerIds || [],
    savedFailerIds: (mg.quizFailerIds || []).filter((id) => id !== loser),
    stats: Object.fromEntries(
      mg.contestantIds.map((id) => [
        id,
        {
          score: mg.mr[id].score,
          wrong: mg.mr[id].wrong,
          answered: mg.mr[id].answered,
        },
      ])
    ),
  };
}

module.exports = {
  ID,
  CONFIG,
  TOTAL_DURATION_MS,
  makeQuestion,
  makePool,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  resolveLosers,
  resolveWinner,
  buildResults,
};
