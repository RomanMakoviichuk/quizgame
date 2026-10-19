const test = require("node:test");
const assert = require("node:assert/strict");
const tug = require("./tugOfWar");

const players = (n, wrong = 1) =>
  Array.from({ length: n }, (_, i) => ({
    id: `P${i + 1}`,
    hasAnswered: true,
    lastAnswerIndex: i < wrong ? 0 : 2, // the first `wrong` players are wrong
  }));

test("only the wrong players pull, and only 2, 4, 6 or 8 of them", () => {
  for (const n of [2, 4, 6, 8]) {
    const c = tug.buildContest({ players: players(8, n), correctIndex: 2, roundIndex: 5 });
    assert.ok(c, `${n} wrong`);
    assert.deepEqual(c.contestantIds, players(8, n).slice(0, n).map((p) => p.id));
  }
  for (const n of [1, 3, 5, 7]) {
    assert.equal(tug.buildContest({ players: players(8, n), correctIndex: 2, roundIndex: 5 }), null, `${n} wrong`);
  }
});

test("players who didn't answer count as wrong", () => {
  const ps = players(4, 0);
  ps[1].hasAnswered = false;
  ps[3].hasAnswered = false;
  assert.deepEqual(tug.buildContest({ players: ps, correctIndex: 2, roundIndex: 5 }).contestantIds, ["P2", "P4"]);
});

test("nobody wrong -> no tug of war", () => {
  assert.equal(tug.buildContest({ players: players(4, 0), correctIndex: 2, roundIndex: 5 }), null);
});

test("teams are always equal, cover everyone once, and are shuffled", () => {
  const seen = new Set();
  for (const n of [2, 4, 6, 8]) {
    const ids = players(n).map((p) => p.id);
    for (let k = 0; k < 50; k++) {
      const { blue, red } = tug.makeTeams(ids);
      assert.equal(blue.length, n / 2);
      assert.equal(red.length, n / 2);
      assert.deepEqual([...blue, ...red].sort(), [...ids].sort());
      if (n === 8) seen.add(blue.join(","));
    }
  }
  assert.ok(seen.size > 10, "join order must not decide the teams");
});

test("rope: blue ahead -> left (negative), red ahead -> right, equal -> centre, always within -1..1", () => {
  assert.ok(tug.ropePosition(30, 10, 2) < 0);
  assert.ok(tug.ropePosition(10, 30, 2) > 0);
  assert.equal(tug.ropePosition(17, 17, 2), 0);
  assert.ok(tug.ropePosition(10000, 0, 4) >= -1);
  assert.ok(tug.ropePosition(0, 10000, 4) <= 1);
  // a bigger lead pulls further
  assert.ok(tug.ropePosition(20, 10, 2) > tug.ropePosition(40, 10, 2));
});

// ---------------------------------------------------------------- full game

function harness(n, present = null) {
  const ids = players(n).map((p) => p.id);
  const mg = { contestantIds: ids };
  tug.onStart(mg);
  let clock = 0;
  let pending = null;
  const sent = [];
  let resolved = 0;
  const ctx = {
    now: () => clock,
    players: () => (present || ids).map((id) => ({ id })),
    emitAll: (ev, d) => sent.push([ev, d]),
    emitPlayer: () => {},
    setTimer: (fn, ms) => {
      pending = { at: clock + ms, fn };
    },
    resolveNow: () => {
      resolved += 1;
    },
  };
  const advance = (ms) => {
    const until = clock + ms;
    while (pending && pending.at <= until) {
      const p = pending;
      pending = null;
      clock = Math.max(clock, p.at);
      p.fn();
    }
    clock = until;
  };
  const counters = {};
  const tap = (id) => {
    counters[id] = (counters[id] || 0) + 1;
    tug.onClientEvent(mg, id, "tow:pull", { n: counters[id] }, ctx);
  };
  tug.onSync(mg, 0, ctx);
  return { mg, ctx, advance, tap, sent, s: () => mg.tow, get resolved() { return resolved; }, timerPending: () => !!pending };
}

/** One 10-second round: each blue member taps `b` times a second, each red one `r` times. */
function playRound(h, b, r) {
  const { blue, red } = h.s().teams;
  for (let sec = 0; sec < tug.CONFIG.PLAY_MS / 1000; sec++) {
    for (let i = 0; i < b; i++) blue.forEach(h.tap);
    for (let i = 0; i < r; i++) red.forEach(h.tap);
    h.advance(1000);
  }
}
const nextRound = (h) => h.advance(tug.CONFIG.BREAK_MS);

test("taps before the start, after the end and during the break are not counted", () => {
  const h = harness(4);
  const b = h.s().teams.blue[0];
  h.tap(b);
  h.advance(tug.CONFIG.PREP_MS - 1);
  h.tap(b);
  assert.equal(h.s().score.blue, 0);
  h.advance(1); // start
  h.tap(b);
  assert.equal(h.s().score.blue, 1);
  h.advance(tug.CONFIG.PLAY_MS); // end of round 1
  assert.equal(h.s().phase, "break");
  h.tap(b);
  assert.equal(h.s().score.blue, 1, "the finished round's score stays on screen during the break");
  nextRound(h);
  assert.equal(h.s().phase, "live");
  assert.equal(h.s().round, 2);
  assert.equal(h.s().score.blue, 0, "every round starts from zero");
});

test("rate limit: no more than MAX_TAPS_PER_SEC counted per player per second", () => {
  const h = harness(2);
  h.advance(tug.CONFIG.PREP_MS);
  const b = h.s().teams.blue[0];
  for (let i = 0; i < 30; i++) h.tap(b); // 30 taps in the same instant
  assert.equal(h.s().score.blue, tug.CONFIG.MAX_TAPS_PER_SEC);
  h.advance(1000);
  for (let i = 0; i < 5; i++) h.tap(b);
  assert.equal(h.s().score.blue, tug.CONFIG.MAX_TAPS_PER_SEC + 5);
});

test("replayed / bogus tap events are ignored; a client can't send a total", () => {
  const h = harness(2);
  h.advance(tug.CONFIG.PREP_MS);
  const r = h.s().teams.red[0];
  tug.onClientEvent(h.mg, r, "tow:pull", { n: 1 }, h.ctx);
  tug.onClientEvent(h.mg, r, "tow:pull", { n: 1 }, h.ctx); // same event again
  tug.onClientEvent(h.mg, r, "tow:pull", { n: "x" }, h.ctx);
  tug.onClientEvent(h.mg, r, "tow:pull", { n: 1, score: 500 }, h.ctx);
  tug.onClientEvent(h.mg, "STRANGER", "tow:pull", { n: 99 }, h.ctx);
  assert.equal(h.s().score.red, 1);
  assert.equal(h.s().score.blue, 0);
});

test("first to 2 round wins takes the series (2:0); the losing team loses lives", () => {
  const h = harness(4);
  h.advance(tug.CONFIG.PREP_MS);
  const { red } = h.s().teams;
  playRound(h, 8, 5);
  assert.equal(h.s().phase, "break");
  assert.deepEqual(h.s().wins, { blue: 1, red: 0 });
  assert.equal(h.s().winner, null, "no series winner after one round");
  assert.equal(h.resolved, 0);
  nextRound(h);
  playRound(h, 7, 6);
  assert.equal(h.s().phase, "done");
  assert.equal(h.s().winner, "blue");
  assert.deepEqual(h.s().wins, { blue: 2, red: 0 });
  assert.deepEqual(h.s().rounds.map((r) => r.winner), ["blue", "blue"]);
  assert.deepEqual(h.s().rounds[0].score, { blue: 8 * 2 * 10, red: 5 * 2 * 10 });
  assert.deepEqual(tug.resolveLosers(h.mg).sort(), [...red].sort());
  assert.equal(h.resolved, 1);
  const res = tug.buildResults(h.mg);
  assert.deepEqual(res.wins, { blue: 2, red: 0 });
  assert.equal(res.minigameScores[red[0]], 5 * 10 + 6 * 10, "taps add up over the series");
});

test("a comeback: 1:1 goes to a third round (2:1)", () => {
  const h = harness(2);
  h.advance(tug.CONFIG.PREP_MS);
  const { blue } = h.s().teams;
  playRound(h, 6, 3);
  nextRound(h);
  playRound(h, 3, 6);
  assert.equal(h.s().phase, "break");
  assert.deepEqual(h.s().wins, { blue: 1, red: 1 });
  nextRound(h);
  assert.equal(h.s().round, 3);
  playRound(h, 2, 9);
  assert.equal(h.s().winner, "red");
  assert.deepEqual(tug.resolveLosers(h.mg), [...blue]);
});

test("a drawn round is replayed; two draws in a row end it and cost every puller a life", () => {
  const h = harness(4);
  h.advance(tug.CONFIG.PREP_MS);
  playRound(h, 4, 4);
  assert.equal(h.s().phase, "break"); // one draw: replay
  assert.deepEqual(h.s().wins, { blue: 0, red: 0 });
  assert.equal(h.s().doubleDraw, false);
  nextRound(h);
  playRound(h, 3, 3);
  assert.equal(h.s().phase, "done");
  assert.equal(h.s().doubleDraw, true);
  assert.equal(h.s().winner, "draw");
  const all = [...h.s().teams.blue, ...h.s().teams.red];
  assert.deepEqual([...tug.resolveLosers(h.mg)].sort(), [...all].sort());
  assert.equal(tug.buildResults(h.mg).doubleDraw, true);
});

test("draws that are not in a row are only replayed", () => {
  const h = harness(2);
  h.advance(tug.CONFIG.PREP_MS);
  playRound(h, 4, 4); // draw
  nextRound(h);
  playRound(h, 5, 1); // blue
  nextRound(h);
  playRound(h, 2, 2); // draw — not right after the first one
  assert.equal(h.s().phase, "break");
  assert.equal(h.s().doubleDraw, false);
  nextRound(h);
  playRound(h, 6, 1); // blue: 2 wins
  assert.equal(h.s().phase, "done");
  assert.equal(h.s().winner, "blue");
  assert.deepEqual(tug.resolveLosers(h.mg), [...h.s().teams.red]);
});

test("the whole series fits in TOTAL_DURATION_MS", () => {
  const h = harness(2);
  h.advance(tug.CONFIG.PREP_MS);
  for (let k = 0; k < tug.CONFIG.MAX_ROUNDS; k++) {
    playRound(h, 1, 1);
    if (h.s().phase === "break") nextRound(h);
  }
  assert.equal(h.resolved, 1);
  assert.ok(tug.CONFIG.PREP_MS + tug.CONFIG.MAX_ROUNDS * (tug.CONFIG.PLAY_MS + tug.CONFIG.BREAK_MS) < tug.TOTAL_DURATION_MS);
});

test("result is fixed once: late events and timers can't change or re-resolve it", () => {
  const h = harness(2);
  h.advance(tug.CONFIG.PREP_MS);
  playRound(h, 3, 1);
  nextRound(h);
  playRound(h, 3, 1);
  assert.equal(h.s().phase, "done");
  const before = JSON.stringify(h.s().score);
  h.tap(h.s().teams.red[0]);
  h.advance(60000);
  assert.equal(JSON.stringify(h.s().score), before);
  assert.equal(h.resolved, 1);
  assert.equal(h.timerPending(), false, "no timers left behind");
});

test("a player left between the round and the start -> cancelled, no lives lost", () => {
  const h = harness(4, ["P1", "P2", "P3"]); // P4 left
  assert.equal(h.s().phase, "cancelled");
  h.advance(5000);
  assert.equal(h.resolved, 1);
  assert.deepEqual(tug.resolveLosers(h.mg), []);
  assert.equal(tug.buildResults(h.mg).message, tug.CANCEL_MESSAGE);
});
