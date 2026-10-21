/**
 * «До міліметра!» — run: node --test minigames/tapeMeasure.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const tm = require("./tapeMeasure");
const placing = require("./placing");

const { CONFIG } = tm;
const players = (n, wrong = n) =>
  Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, hasAnswered: true, lastAnswerIndex: i < wrong ? 0 : 2 })); // correctIndex 2

/** A minigame on a fake clock: ctx timers run on `advance`, emits are recorded. */
function harness(n = 3, targets = "4.5,6,7.2") {
  const saved = process.env.TAPE_TARGETS;
  process.env.TAPE_TARGETS = targets;
  const mg = tm.buildContest({ players: players(n), correctIndex: 2, roundIndex: 1 });
  tm.onStart(mg);
  if (saved === undefined) delete process.env.TAPE_TARGETS;
  else process.env.TAPE_TARGETS = saved;
  let now = 1_000_000;
  let timer = null;
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
  const lock = (id, mm, round = mg.tm.current + 1) => tm.onClientEvent(mg, id, "tm:lock", { round, mm }, ctx);
  tm.onSync(mg, now, ctx);
  return { mg, ctx, advance, last, all, lock, now: () => now };
}
const toStart = (h) => h.advance(CONFIG.PRACTICE_MS + CONFIG.INTRO_MS);

// ---------------------------------------------------------------- pure

test("targets: three different whole cm from 1 to 7; TAPE_TARGETS (cm) fixes them", () => {
  const seen = new Set();
  for (let k = 0; k < 300; k++) {
    const t = tm.pickTargets("");
    assert.equal(t.length, 3);
    assert.equal(new Set(t).size, 3, `${t}: no repeats`);
    t.forEach((mm) => {
      assert.equal(mm % 10, 0, "a whole cm");
      assert.ok(mm >= CONFIG.TARGET_CM[0] * 10 && mm <= CONFIG.TARGET_CM[1] * 10, `${mm}`);
      seen.add(mm);
    });
  }
  assert.equal(seen.size, 7, "every cm from 1 to 7 comes up");
  assert.deepEqual(tm.pickTargets("4,6,2"), [40, 60, 20]);
  assert.equal(tm.pickTargets("4,x,99").length, 3, "bad values fall back to random");
});

test("a lock's length: on the tape, to 0.1 mm, never negative or past its end", () => {
  assert.equal(tm.cleanLength(38.04), 38);
  assert.equal(tm.cleanLength("45.27"), 45.3);
  assert.equal(tm.cleanLength(-12), 0);
  assert.equal(tm.cleanLength(99999), CONFIG.MAX_MM);
  assert.equal(tm.cleanLength("abc"), null);
  assert.equal(tm.cleanLength(undefined), null);
});

test("the example from the brief: 338 / 345 / 331 / 360 mm for 34 cm", () => {
  const rows = tm.scoreRound(["P1", "P2", "P3", "P4", "P5"], { P1: 338, P2: 345, P3: 331, P4: 360 }, 340);
  assert.deepEqual(
    rows.map((r) => [r.id, r.err, r.place, r.points]),
    [
      ["P1", 2, 1, 5],
      ["P2", 5, 2, 3],
      ["P3", 9, 3, 2],
      ["P4", 20, 4, 1],
      ["P5", null, null, 0],
    ]
  );
});

test("no rounding before the result: 0.4 mm decides", () => {
  const rows = tm.scoreRound(["A", "B"], { A: 340.4, B: 339.7 }, 340);
  assert.equal(rows[0].id, "B");
  assert.equal(rows[0].place, 1);
  assert.equal(rows[1].place, 2);
});

// ---------------------------------------------------------------- a full game

test("three rounds with the same target for everybody, then the final board", () => {
  const h = harness(3);
  const targets = [45, 60, 72];
  const pr = h.last("tm:practice");
  assert.equal(pr.endAt - pr.startAt, CONFIG.PRACTICE_MS, "the practice pull runs under the rules, from the start");
  assert.equal(h.last("tm:round"), undefined, "no round during the practice");
  h.lock("P1", 45, 1);
  assert.deepEqual(h.mg.tm.rounds[0].locks, {}, "nothing counts in the practice");
  for (let k = 1; k <= 3; k++) {
    h.advance(k === 1 ? CONFIG.PRACTICE_MS : 0);
    const r = h.last("tm:round");
    assert.equal(r.round, k);
    assert.equal(r.targetMm, targets[k - 1]);
    assert.ok(r.host.includes(String(targets[k - 1] / 10).replace(".", ",")), "the host names the target (4,5 см)");
    assert.equal(h.all("tm:round").filter((m) => m.data.round === k && m.to === "all").length, 1, "one start, to everyone");
    h.advance(CONFIG.INTRO_MS + 3000);
    ["P1", "P2", "P3"].forEach((id, i) => h.lock(id, targets[k - 1] + i * 3));
    const res = h.last("tm:roundResult");
    assert.equal(res.round, k, "everybody locked -> the result right away");
    h.advance(k < 3 ? CONFIG.RESULT_MS : 0);
  }
  assert.equal(h.mg.resolvedAt, undefined);
  h.advance(CONFIG.LAST_RESULT_MS);
  assert.ok(h.mg.resolvedAt);
  assert.deepEqual(tm.buildResults(h.mg).tapeMeasure.totals, { P1: 15, P2: 9, P3: 6 });
  assert.deepEqual(tm.resolveLosers(h.mg), ["P3"]);
  assert.equal(tm.resolveWinner(h.mg), "P1");
});

test("a lock is final: a second one changes nothing; the ack carries only your own length", () => {
  const h = harness(3);
  toStart(h);
  h.lock("P1", 43.8);
  h.lock("P1", 45);
  assert.equal(h.mg.tm.rounds[0].locks.P1, 43.8);
  const acks = h.all("tm:ack").filter((m) => m.to === "P1");
  assert.equal(acks.length, 1);
  assert.deepEqual(acks[0].data, { round: 1, mm: 43.8 });
  const p = h.last("tm:progress");
  assert.deepEqual(p.lockedIds, ["P1"], "the TV sees who locked, not the length");
  assert.equal(JSON.stringify(p).includes("43.8"), false);
});

test("'measuring' shows on the TV once per player; nothing before the start or for another round", () => {
  const h = harness(2);
  h.advance(CONFIG.PRACTICE_MS + 1000); // the intro
  tm.onClientEvent(h.mg, "P1", "tm:busy", { round: 1 }, h.ctx);
  h.lock("P2", 45);
  assert.deepEqual(h.mg.tm.rounds[0].busy, {}, "before the start");
  assert.deepEqual(h.mg.tm.rounds[0].locks, {});
  h.advance(CONFIG.INTRO_MS);
  tm.onClientEvent(h.mg, "P1", "tm:busy", { round: 1 }, h.ctx);
  tm.onClientEvent(h.mg, "P1", "tm:busy", { round: 1 }, h.ctx);
  h.lock("P2", 45, 2);
  assert.deepEqual(h.last("tm:progress").busyIds, ["P1"]);
  assert.equal(h.all("tm:progress").length, 2, "the round start + one 'measuring'");
  assert.equal(h.mg.tm.rounds[0].locks.P2, undefined, "a lock meant for round 2");
});

test("no lock in time -> 'not in time' (0 points); the round does not wait for them", () => {
  const h = harness(3);
  toStart(h);
  h.lock("P1", 46);
  h.lock("P2", 43);
  h.advance(CONFIG.ROUND_MS + CONFIG.CLOSE_GRACE_MS);
  const res = h.last("tm:roundResult");
  const p3 = res.rows.find((r) => r.id === "P3");
  assert.equal(p3.mm, null);
  assert.equal(p3.points, 0);
  h.lock("P3", 45);
  assert.equal(h.mg.tm.rounds[0].locks.P3, undefined, "after the end");
});

test("a phone that comes back: the round and its own lock — not a second try", () => {
  const h = harness(2);
  toStart(h);
  h.lock("P1", 42.5);
  tm.onClientEvent(h.mg, "P1", "tm:hello", {}, h.ctx);
  const mine = (ev) => h.all(ev).filter((m) => m.to === "P1");
  assert.equal(mine("tm:go").length, 1);
  assert.equal(mine("tm:round").length, 1);
  assert.deepEqual(mine("tm:ack").pop().data, { round: 1, mm: 42.5 });
  tm.onDisplayEvent(h.mg, "tm:hello", {}, h.ctx);
  assert.equal(h.all("tm:round").filter((m) => m.to === "tv").length, 1);
});

test("a hard stop mid-round scores the locks made so far; the shielded loser is named", () => {
  const h = harness(2);
  toStart(h);
  h.lock("P1", 45);
  assert.deepEqual(tm.resolveLosers(h.mg), ["P2"]);
  h.mg.minigameLoserIds = ["P2"];
  assert.deepEqual(tm.buildResults(h.mg).tapeMeasure.lowestIds, ["P2"]);
});

test("the shared scoring: ties share places, equal totals go by the summed error", () => {
  const rows = placing.placeRows(["a", "b", "c"], { a: 5, b: 15, c: 10 }, 10, "v");
  assert.deepEqual(rows.map((r) => [r.id, r.place, r.points]), [["c", 1, 5], ["a", 2, 3], ["b", 2, 3]]);
  const o = placing.outcomeOf(["a", "b"], [placing.placeRows(["a", "b"], { a: 9, b: 12 }, 10)], 100);
  assert.deepEqual(o.loserIds, ["b"]);
  assert.equal(o.winnerId, "a");
});

test("the hard stop leaves room for three full rounds", () => {
  const full = CONFIG.PRACTICE_MS + 3 * (CONFIG.INTRO_MS + CONFIG.ROUND_MS + CONFIG.CLOSE_GRACE_MS) + 2 * CONFIG.RESULT_MS + CONFIG.LAST_RESULT_MS;
  assert.ok(tm.TOTAL_DURATION_MS > full);
});
