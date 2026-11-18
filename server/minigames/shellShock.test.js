/**
 * «Не кліпай!» — run: node --test minigames/shellShock.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const ss = require("./shellShock");

const { CONFIG, DIFFICULTY, CUPS } = ss;
const players = (n, wrong = n) =>
  Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, hasAnswered: true, lastAnswerIndex: i < wrong ? 0 : 2 })); // correctIndex 2

/** A minigame on a fake clock: ctx timers run on `advance`, emits are recorded. */
function harness(n = 3) {
  const mg = ss.buildContest({ players: players(n), correctIndex: 2, roundIndex: 1 });
  ss.onStart(mg);
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
  const advanceTo = (t) => advance(Math.max(0, t - now));
  const last = (ev, to) => [...sent].reverse().find((m) => m.ev === ev && (!to || m.to === to))?.data;
  const all = (ev) => sent.filter((m) => m.ev === ev);
  const pickPos = (id, pos, round = mg.ss.current + 1) => ss.onClientEvent(mg, id, "ss:pick", { round, pos }, ctx);
  const round = () => mg.ss.rounds[mg.ss.current];
  const right = () => ss.correctAnswer(round());
  const wrong = () => (right() % 3) + 1;
  ss.onSync(mg, now, ctx);
  return { mg, ctx, advance, advanceTo, last, all, pickPos, round, right, wrong, sent, now: () => now };
}
const toAnswer = (h) => h.advanceTo(h.round().answerAt);

/** Replays a sequence move by move, checking each move's start is the last one's end. */
function replay(seq) {
  let pos = { ...seq.start };
  for (const m of seq.moves) {
    assert.deepEqual(m.from, pos, "a move starts where the last one ended");
    pos = { ...m.to };
  }
  return pos;
}

// ---------------------------------------------------------------- the moves

test("moves: every cup keeps its identity; positions are always a permutation of 0..2", () => {
  for (let k = 0; k < 500; k++) {
    for (const diff of DIFFICULTY) {
      const seq = ss.makeSequence(diff);
      assert.deepEqual(Object.keys(seq.start).sort(), [...CUPS].sort());
      assert.ok(CUPS.includes(seq.objectCup));
      for (const m of seq.moves) {
        assert.deepEqual(Object.values(m.to).sort(), [0, 1, 2], "three cups on three places");
        assert.deepEqual(Object.keys(m.to).sort(), [...CUPS].sort(), "the same three cups");
        const moved = CUPS.filter((c) => m.from[c] !== m.to[c]);
        if (m.kind === "feint") assert.equal(moved.length, 0, "a feint changes nothing");
        if (m.kind === "swap") assert.ok(moved.length === 2 && Math.abs(m.from[moved[0]] - m.from[moved[1]]) === 1, "neighbours");
        if (m.kind === "cross") assert.deepEqual(moved.map((c) => m.from[c]).sort(), [0, 2], "over the middle");
        if (m.kind === "rotate") assert.equal(moved.length, 3);
      }
      assert.deepEqual(replay(seq), ss.finalPositions(seq), "the final positions follow the moves");
      assert.equal(ss.correctAnswer(seq), ss.finalPositions(seq)[seq.objectCup] + 1, "the answer is where the thing's cup ended");
    }
  }
});

test("moves: the timeline is ordered, no move overlaps the next", () => {
  for (let k = 0; k < 200; k++) {
    for (const diff of DIFFICULTY) {
      const seq = ss.makeSequence(diff);
      seq.moves.forEach((m, i) => {
        if (i) assert.ok(m.at >= seq.moves[i - 1].at + seq.moves[i - 1].ms, "one move at a time");
      });
      const lastMove = seq.moves[seq.moves.length - 1];
      assert.equal(seq.shuffleMs, lastMove.at + lastMove.ms);
    }
  }
});

test("difficulty: each round shows the thing for less, moves more, faster, more tricks", () => {
  const stats = DIFFICULTY.map((diff) => {
    let moves = 0;
    let ms = 0;
    let tricks = 0;
    for (let k = 0; k < 300; k++) {
      const seq = ss.makeSequence(diff);
      moves += seq.moves.length;
      ms += seq.moves.reduce((s, m) => s + m.ms, 0) / seq.moves.length;
      tricks += seq.moves.filter((m) => m.kind !== "swap").length;
    }
    return { memorize: diff.memorizeMs, moves: moves / 300, ms: ms / 300, tricks: tricks / 300 };
  });
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].memorize < stats[i - 1].memorize, "a shorter look");
    assert.ok(stats[i].moves > stats[i - 1].moves, "more moves");
    assert.ok(stats[i].ms < stats[i - 1].ms, "faster moves");
    assert.ok(stats[i].tricks > stats[i - 1].tricks, "more crossovers / feints");
  }
  const r1 = ss.makeSequence(DIFFICULTY[0]);
  assert.ok(r1.moves.length >= 12 && r1.moves.length <= 16, "round 1 is already a real chaos");
  const r3 = ss.makeSequence(DIFFICULTY[2]);
  assert.ok(r3.moves.length >= 20 && r3.moves.length <= 26);
  for (const diff of DIFFICULTY)
    for (let k = 0; k < 100; k++) assert.ok(ss.makeSequence(diff).shuffleMs < 9000, "a shuffle fits the hard stop's budget");
});

test("things: the drop-in folder's pictures, named by their file; an empty folder -> the defaults", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-items-"));
  try {
    assert.deepEqual(ss.loadObjects(dir), ss.OBJECTS);
    assert.deepEqual(ss.loadObjects(path.join(dir, "missing")), ss.OBJECTS);
    fs.writeFileSync(path.join(dir, "гумова_качка 2.webp"), "x");
    fs.writeFileSync(path.join(dir, "Огірок.png"), "x");
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    const got = ss.loadObjects(dir);
    assert.deepEqual(got.map((o) => o.name).sort(), ["гумова качка", "огірок"]);
    assert.ok(got.every((o) => o.src.startsWith(ss.ITEMS_URL + "/")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("moves: a fixed rng gives the same sequence (it is data, not a client-side dice)", () => {
  const mk = () => {
    let seed = 7;
    const rng = (lo, hi) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return lo + (seed % (hi - lo + 1));
    };
    return ss.makeSequence(DIFFICULTY[2], rng);
  };
  assert.deepEqual(mk(), mk());
});

// ---------------------------------------------------------------- the game

test("trigger: one wrong answer is enough, everybody plays; nobody wrong or alone -> no game", () => {
  const mg = ss.buildContest({ players: players(4, 1), correctIndex: 2, roundIndex: 3 });
  assert.equal(mg.contestantIds.length, 4);
  assert.deepEqual(mg.quizFailerIds, ["P1"]);
  assert.equal(ss.buildContest({ players: players(4, 0), correctIndex: 2 }), null);
  assert.equal(ss.buildContest({ players: players(1, 1), correctIndex: 2 }), null);
});

test("exactly three rounds: intro -> reveal -> cover -> shuffle -> answer -> result, then the resolve", () => {
  const h = harness();
  h.advance(CONFIG.PREP_MS);
  for (let i = 0; i < 3; i++) {
    const r = h.round();
    assert.equal(h.mg.ss.current, i);
    assert.ok(r.introAt < r.revealAt && r.revealAt < r.coverAt && r.coverAt < r.shuffleAt && r.shuffleAt + r.shuffleMs <= r.answerAt && r.answerAt < r.endAt);
    assert.equal(r.coverAt - r.revealAt, DIFFICULTY[i].memorizeMs);
    h.advanceTo(r.endAt + CONFIG.CLOSE_GRACE_MS);
    assert.ok(r.rows, `round ${i + 1} closed by the timer`);
    if (i < 2) h.advance(CONFIG.RESULT_MS);
  }
  assert.equal(h.all("ss:round").length, 3);
  assert.equal(h.all("ss:roundResult").length, 3);
  h.advance(CONFIG.LAST_RESULT_MS);
  assert.ok(h.mg.resolvedAt, "the game ends after round 3");
});

test("the phones never get the cups: the sequence and the thing's cup go to the TV only", () => {
  const h = harness();
  h.advance(CONFIG.PREP_MS);
  const phone = h.last("ss:round", "all");
  assert.ok(!("moves" in phone) && !("objectCup" in phone) && !("start" in phone));
  const tv = h.last("ss:show", "tv");
  assert.deepEqual(tv.moves, h.round().moves);
  assert.equal(tv.objectCup, h.round().objectCup);
  assert.ok(!h.sent.some((m) => m.ev === "ss:show" && m.to !== "tv"));
});

test("answers: not while shuffling, one per player (final), not after the end, only 1..3, only contestants", () => {
  const h = harness();
  h.advance(CONFIG.PREP_MS);
  h.advanceTo(h.round().shuffleAt + 50);
  h.pickPos("P1", 1);
  assert.equal(h.round().answers.P1, undefined, "too early: still shuffling");
  toAnswer(h);
  h.pickPos("P1", h.right());
  h.pickPos("P1", h.wrong());
  assert.equal(h.round().answers.P1, h.right(), "the first answer stays");
  h.pickPos("P2", 7);
  h.pickPos("P2", "x");
  assert.equal(h.round().answers.P2, undefined, "nonsense is ignored");
  h.pickPos("STRANGER", 1);
  assert.equal(h.round().answers.STRANGER, undefined);
  h.pickPos("P2", 2, 3);
  assert.equal(h.round().answers.P2, undefined, "an answer for another round");
  h.advanceTo(h.round().endAt + CONFIG.CLOSE_GRACE_MS + 1);
  const r1 = h.mg.ss.rounds[0];
  assert.ok(r1.rows);
  h.pickPos("P3", 1, 1);
  assert.equal(r1.answers.P3, undefined, "too late");
  assert.deepEqual(
    r1.rows.map((r) => [r.id, r.points]),
    [
      ["P1", CONFIG.ROUND_POINTS[0]],
      ["P2", 0],
      ["P3", 0],
    ]
  );
});

test("everybody answered -> the round closes at once, scored once", () => {
  const h = harness();
  h.advance(CONFIG.PREP_MS);
  toAnswer(h);
  h.pickPos("P1", h.right());
  h.pickPos("P2", h.wrong());
  h.pickPos("P3", h.right());
  assert.equal(h.all("ss:roundResult").length, 1);
  const res = h.last("ss:roundResult");
  assert.equal(res.correct, h.right());
  assert.deepEqual(res.totals, { P1: 100, P2: 0, P3: 100 });
  h.advance(CONFIG.ANSWER_MS); // the old timer can't close it again
  assert.equal(h.all("ss:roundResult").filter((m) => m.data.round === 1).length, 1);
});

test("a whole game: totals, the lowest loses (ties: all), a single best wins; repeated resolves change nothing", () => {
  const h = harness(4);
  h.advance(CONFIG.PREP_MS);
  const plan = [
    { P1: true, P2: true, P3: false, P4: false },
    { P1: true, P2: false, P3: false, P4: null },
    { P1: true, P2: true, P3: false, P4: false },
  ];
  plan.forEach((who, i) => {
    toAnswer(h);
    for (const [id, ok] of Object.entries(who)) if (ok != null) h.pickPos(id, ok ? h.right() : h.wrong());
    h.advanceTo(h.round().endAt + CONFIG.CLOSE_GRACE_MS);
    h.advance(i < 2 ? CONFIG.RESULT_MS : CONFIG.LAST_RESULT_MS);
  });
  assert.ok(h.mg.resolvedAt);
  const res = ss.buildResults(h.mg);
  assert.deepEqual(res.shellShock.totals, { P1: 450, P2: 300, P3: 0, P4: 0 });
  assert.deepEqual(res.minigameScores, res.shellShock.totals);
  assert.deepEqual(ss.resolveLosers(h.mg).sort(), ["P3", "P4"]);
  assert.equal(ss.resolveWinner(h.mg), "P1");
  assert.deepEqual(res.shellShock.ranked.slice(0, 2), ["P1", "P2"]);
  assert.deepEqual(ss.resolveLosers(h.mg).sort(), ["P3", "P4"], "idempotent");
  assert.equal(res.shellShock.rounds.length, 3);
});

test("everybody equal -> nobody loses, no winner", () => {
  const h = harness(2);
  h.advance(CONFIG.PREP_MS);
  for (let i = 0; i < 3; i++) {
    toAnswer(h);
    h.pickPos("P1", h.wrong());
    h.pickPos("P2", h.wrong());
    h.advance(i < 2 ? CONFIG.RESULT_MS : CONFIG.LAST_RESULT_MS);
  }
  assert.deepEqual(ss.resolveLosers(h.mg), []);
  assert.equal(ss.resolveWinner(h.mg), null);
});

test("a screen that comes back gets the same round and sequence, never a new one", () => {
  const h = harness();
  h.advance(CONFIG.PREP_MS);
  h.advanceTo(h.round().shuffleAt + 300);
  const moves = JSON.stringify(h.round().moves);
  ss.onDisplayEvent(h.mg, "ss:hello", {}, h.ctx);
  assert.equal(JSON.stringify(h.last("ss:show", "tv").moves), moves);
  ss.onClientEvent(h.mg, "P2", "ss:hello", {}, h.ctx);
  assert.equal(h.last("ss:round", "P2").round, 1);
  assert.ok(!h.sent.some((m) => m.to === "P2" && m.ev === "ss:show"));
  toAnswer(h);
  h.pickPos("P2", 2);
  ss.onClientEvent(h.mg, "P2", "ss:hello", {}, h.ctx);
  assert.equal(h.last("ss:ack", "P2").pick, 2, "its answer is remembered");
});

test("a hard stop mid-round still scores what was answered (no stuck game)", () => {
  const h = harness();
  h.advance(CONFIG.PREP_MS);
  toAnswer(h);
  h.pickPos("P1", h.right());
  const res = ss.buildResults(h.mg); // the framework's hard stop resolves now
  assert.equal(res.shellShock.totals.P1, 100);
  assert.deepEqual(ss.resolveLosers(h.mg).sort(), ["P2", "P3"]);
});
