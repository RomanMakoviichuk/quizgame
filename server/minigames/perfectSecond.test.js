/**
 * «Ідеальна секунда» — run: node --test minigames/perfectSecond.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const ps = require("./perfectSecond");

const { CONFIG } = ps;
const players = (n, wrong = n) =>
  Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, hasAnswered: true, lastAnswerIndex: i < wrong ? 0 : 2 })); // correctIndex 2

/** A minigame on a fake clock: ctx timers run on `advance`, emits are recorded. */
function harness(n = 3) {
  const mg = ps.buildContest({ players: players(n), correctIndex: 2, roundIndex: 1 });
  ps.onStart(mg);
  let now = 1_000_000;
  let timer = null; // the single pending minigame timer, as in phases.js
  const sent = [];
  const ctx = {
    now: () => now,
    emitAll: (ev, data) => sent.push({ to: "all", ev, data }),
    emitDisplay: (ev, data) => sent.push({ to: "tv", ev, data }),
    emitPlayer: (id, ev, data) => sent.push({ to: id, ev, data }),
    setTimer: (fn, ms) => (timer = { fn, at: now + Math.max(0, ms) }),
    scheduleResolve: (ms) => (timer = { fn: () => (mg.resolvedAt = now), at: now + Math.max(0, ms) }),
    resolveNow: () => (mg.resolvedAt = now),
  };
  const advance = (ms) => {
    assert.ok(ms >= 0, "the fake clock only goes forward");
    const until = now + ms;
    while (timer && timer.at <= until) {
      const t = timer;
      timer = null;
      now = t.at;
      t.fn();
    }
    now = until;
  };
  const last = (ev, to) => [...sent].reverse().find((m) => m.ev === ev && (!to || m.to === to))?.data;
  const all = (ev) => sent.filter((m) => m.ev === ev);
  const stop = (id, elapsed, round = mg.ps.current + 1) =>
    ps.onClientEvent(mg, id, "ps:stop", { round, at: mg.ps.rounds[round - 1].startAt + elapsed }, ctx);
  ps.onSync(mg, now, ctx);
  return { mg, ctx, advance, last, all, stop, now: () => now };
}

/** Into round `k` (1-based), right after its start. */
function toRound(h, k) {
  h.advance(CONFIG.PREP_MS + CONFIG.COUNTDOWN_MS);
  for (let i = 1; i < k; i++) h.advance(CONFIG.LIMIT_MS + CONFIG.CLOSE_GRACE_MS + CONFIG.RESULT_MS + CONFIG.COUNTDOWN_MS);
}

// ---------------------------------------------------------------- scoring

test("points by the error to 10.00: 5 / 3 / 2, then 1 each, a miss 0", () => {
  const rows = ps.scoreRound(["a", "b", "c", "d", "e", "f"], { a: 10020, b: 9840, c: 10610, d: 12000, e: 7000 });
  assert.deepEqual(
    rows.map((r) => [r.id, r.err, r.place, r.points]),
    [
      ["a", 20, 1, 5],
      ["b", 160, 2, 3],
      ["c", 610, 3, 2],
      ["d", 2000, 4, 1],
      ["e", 3000, 5, 1],
      ["f", null, null, 0],
    ]
  );
});

test("equal errors share the place (early and late alike), exact ms — no rounding", () => {
  const rows = ps.scoreRound(["a", "b", "c", "d"], { a: 9900, b: 10100, c: 10101, d: 10099 });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.d.place, 1);
  assert.equal(by.d.points, 5);
  assert.equal(by.a.place, 2);
  assert.equal(by.b.place, 2);
  assert.equal(by.a.points, 3);
  assert.equal(by.b.points, 3);
  assert.equal(by.c.place, 4, "1 ms worse is a worse place");
  assert.equal(by.c.points, 1);
});

test("the trigger: somebody wrong, 2+ players -> everybody plays", () => {
  assert.equal(ps.buildContest({ players: players(4, 0), correctIndex: 2 }), null, "all right -> none");
  assert.equal(ps.buildContest({ players: players(1, 1), correctIndex: 2 }), null, "one player -> none");
  const c = ps.buildContest({ players: players(5, 1), correctIndex: 2, roundIndex: 3 });
  assert.deepEqual(c.contestantIds, ["P1", "P2", "P3", "P4", "P5"]);
  assert.deepEqual(c.quizFailerIds, ["P1"]);
});

// ---------------------------------------------------------------- the stamp

test("a stop's stamp: never later than its arrival, never long before it, inside the round", () => {
  const r = { startAt: 1000, endAt: 16000 };
  assert.equal(ps.acceptStamp(11000, 11050, r), 10000, "a normal stop: its own stamp");
  assert.equal(ps.acceptStamp(11500, 11000, r), 10000, "a stamp from the future -> the arrival");
  assert.equal(ps.acceptStamp(1000, 11000, r), 10000 - CONFIG.PAST_TOLERANCE_MS, "a forged early stamp is raised");
  assert.equal(ps.acceptStamp("x", 9000, r), 8000, "no stamp -> the arrival");
  assert.equal(ps.acceptStamp(900, 950, r), null, "before the start");
  assert.equal(ps.acceptStamp(16100, 16200, r), null, "after the end");
});

// ---------------------------------------------------------------- a full game

test("three rounds: the timer hides at 8 / 6 / 5 s, every round has the shared start", () => {
  const h = harness(3);
  const go = h.last("ps:go");
  assert.equal(go.rounds.length, 3);
  assert.deepEqual(go.rounds.map((r) => r.hideMs), [8000, 6000, 5000]);
  for (let k = 1; k <= 3; k++) {
    h.advance(k === 1 ? CONFIG.PREP_MS : 0);
    const r = h.last("ps:round");
    assert.equal(r.round, k);
    assert.equal(r.startAt - r.countdownAt, CONFIG.COUNTDOWN_MS);
    assert.equal(r.hideAt - r.startAt, ps.ROUNDS[k - 1].hideMs);
    assert.equal(r.endAt - r.startAt, CONFIG.LIMIT_MS);
    assert.equal(h.all("ps:round").filter((m) => m.data.round === k).length, 1, "one start, sent to everyone");
    h.advance(CONFIG.COUNTDOWN_MS + 10000);
    ["P1", "P2", "P3"].forEach((id, i) => h.stop(id, 10000 + i * 100));
    assert.equal(h.last("ps:roundResult").round, k, "everybody stopped -> the result right away");
    h.advance(k < 3 ? CONFIG.RESULT_MS : 0);
  }
  assert.equal(h.mg.resolvedAt, undefined, "the last result is still on screen");
  h.advance(CONFIG.LAST_RESULT_MS);
  assert.ok(h.mg.resolvedAt, "then the final board");
});

test("one stop per player per round; the phone learns nothing but 'fixed'", () => {
  const h = harness(3);
  toRound(h, 1);
  h.advance(9000);
  h.stop("P1", 9000);
  h.stop("P1", 10000); // a second tap
  ps.onClientEvent(h.mg, "P1", "ps:stop", { round: 1, at: h.now() }, h.ctx);
  assert.equal(h.mg.ps.rounds[0].stops.P1, 9000, "the first stop stays");
  const acks = h.all("ps:ack").filter((m) => m.to === "P1");
  assert.equal(acks.length, 1);
  assert.deepEqual(acks[0].data, { round: 1 }, "no time, no error in the ack");
  assert.deepEqual(h.last("ps:progress").stoppedIds, ["P1"], "the TV sees who stopped, not their time");
  assert.equal(h.last("ps:roundResult"), undefined);
});

test("a stop for another round, before the start or after the end is ignored", () => {
  const h = harness(2);
  h.advance(CONFIG.PREP_MS + 1000); // round 1 counting down
  ps.onClientEvent(h.mg, "P1", "ps:stop", { round: 1, at: h.now() }, h.ctx);
  assert.equal(h.mg.ps.rounds[0].stops.P1, undefined, "before the start");
  h.advance(5000);
  h.stop("P1", 4000, 2);
  assert.equal(h.mg.ps.rounds[0].stops.P1, undefined, "a tap meant for round 2");
  h.advance(CONFIG.LIMIT_MS);
  ps.onClientEvent(h.mg, "P2", "ps:stop", { round: 1, at: h.now() }, h.ctx);
  assert.equal(h.mg.ps.rounds[0].stops.P2, undefined, "after the end");
});

test("nobody waits for a silent player: the round closes at the limit, the miss scores 0", () => {
  const h = harness(3);
  toRound(h, 1);
  h.advance(10000);
  h.stop("P1", 10000);
  h.stop("P2", 10300);
  assert.equal(h.last("ps:roundResult"), undefined, "P3 has not stopped yet");
  h.advance(CONFIG.LIMIT_MS - 10000 + CONFIG.CLOSE_GRACE_MS);
  const res = h.last("ps:roundResult");
  assert.equal(res.round, 1);
  const p3 = res.rows.find((r) => r.id === "P3");
  assert.equal(p3.ms, null);
  assert.equal(p3.points, 0);
  assert.equal(res.rows[res.rows.length - 1].id, "P3", "the miss is last");
});

test("totals over three rounds; the lowest loses a life, the best gets the bonus", () => {
  const h = harness(3);
  toRound(h, 1);
  const plan = [
    { P1: 10010, P2: 10300, P3: 9000 }, // 5 3 2
    { P1: 10500, P2: 10050, P3: 11000 }, // 3 5 2
    { P1: 10020, P2: null, P3: 10900 }, // 5 0 3
  ];
  plan.forEach((stops, k) => {
    const r = h.mg.ps.rounds[k];
    h.advance(11500); // the stops arrive late, stamped when they were made
    for (const [id, ms] of Object.entries(stops)) if (ms != null) h.stop(id, ms);
    if (!r.rows) h.advance(r.endAt + CONFIG.CLOSE_GRACE_MS - h.now()); // somebody missed: closes at the limit
    if (k < 2) h.advance(r.nextAt + CONFIG.COUNTDOWN_MS - h.now()); // the next round's start
  });
  assert.deepEqual(h.last("ps:roundResult").totals, { P1: 13, P2: 8, P3: 7 });
  assert.deepEqual(ps.resolveLosers(h.mg), ["P3"]);
  assert.equal(ps.resolveWinner(h.mg), "P1");
  const res = ps.buildResults(h.mg);
  assert.deepEqual(res.minigameScores, { P1: 13, P2: 8, P3: 7 });
  assert.deepEqual(res.perfectSecond.ranked, ["P1", "P2", "P3"]);
  assert.equal(res.perfectSecond.rounds.length, 3);
});

test("equal totals: the bigger summed error loses (a miss counts the whole limit)", () => {
  const mg = { contestantIds: ["A", "B"], ps: { rounds: [], outcome: null } };
  mg.ps.rounds = [
    { startAt: 1, rows: ps.scoreRound(["A", "B"], { A: 10100, B: 10200 }) }, // A 5, B 3
    { startAt: 1, rows: ps.scoreRound(["A", "B"], { A: 10900, B: 10050 }) }, // A 3, B 5
  ];
  assert.deepEqual(ps.resolveLosers(mg), ["A"], "8 each; A missed by 1000 ms in all, B by 250");
  assert.equal(ps.resolveWinner(mg), "B");
});

test("everybody exactly equal -> nobody loses, nobody wins", () => {
  const mg = { contestantIds: ["A", "B"], ps: { rounds: [{ startAt: 1, rows: ps.scoreRound(["A", "B"], { A: 9900, B: 10100 }) }], outcome: null } };
  assert.deepEqual(ps.resolveLosers(mg), []);
  assert.equal(ps.resolveWinner(mg), null);
});

test("a hard stop mid-round scores the stops made so far", () => {
  const h = harness(2);
  toRound(h, 1);
  h.advance(10000);
  h.stop("P1", 10000);
  assert.deepEqual(ps.resolveLosers(h.mg), ["P2"]);
  assert.equal(ps.buildResults(h.mg).perfectSecond.rounds[0].rows[0].id, "P1");
});

test("a phone that comes back gets the clock, the round and its own 'fixed' — not a second try", () => {
  const h = harness(2);
  toRound(h, 1);
  h.advance(9500);
  h.stop("P1", 9500);
  ps.onClientEvent(h.mg, "P1", "ps:hello", {}, h.ctx);
  const mine = (ev) => h.all(ev).filter((m) => m.to === "P1");
  assert.equal(mine("ps:go").length, 1);
  assert.equal(mine("ps:round").length, 1);
  assert.equal(mine("ps:ack").length, 2, "the ack again after the hello");
  h.stop("P1", 10000);
  assert.equal(h.mg.ps.rounds[0].stops.P1, 9500);
});

test("clock sync: a ping is answered with the server time, to a phone or the TV", () => {
  const h = harness(2);
  ps.onClientEvent(h.mg, "P2", "ps:ping", { t: 42 }, h.ctx);
  assert.deepEqual(h.last("ps:pong", "P2"), { t: 42, s: h.now() });
  ps.onDisplayEvent(h.mg, "ps:ping", { t: 7 }, h.ctx);
  assert.deepEqual(h.last("ps:pong", "tv"), { t: 7, s: h.now() });
});

test("the hard stop leaves room for three full rounds", () => {
  const full = CONFIG.PREP_MS + 3 * (CONFIG.COUNTDOWN_MS + CONFIG.LIMIT_MS + CONFIG.CLOSE_GRACE_MS) + 2 * CONFIG.RESULT_MS + CONFIG.LAST_RESULT_MS;
  assert.ok(ps.TOTAL_DURATION_MS > full);
});

test("the results name the lowest even when the quiz answer shields their life", () => {
  const mg = { contestantIds: ["A", "B"], ps: { rounds: [{ startAt: 1, rows: ps.scoreRound(["A", "B"], { A: 10000, B: 11000 }) }], outcome: null } };
  assert.deepEqual(ps.buildResults(mg).perfectSecond.lowestIds, ["B"], "no phases.js filter yet: the module's own loser");
  mg.minigameLoserIds = ["B"]; // what phases.js records before buildResults (loserIds there drops the protected)
  assert.deepEqual(ps.buildResults(mg).perfectSecond.lowestIds, ["B"]);
});
