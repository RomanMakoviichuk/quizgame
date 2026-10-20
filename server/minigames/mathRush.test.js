const test = require("node:test");
const assert = require("node:assert/strict");
const mr = require("./mathRush");

// helper: a contest+state object shaped like phases.js builds it
function mkMg(perPlayer) {
  const ids = Object.keys(perPlayer);
  return {
    contestantIds: ids,
    quizFailerIds: [],
    mr: Object.fromEntries(
      ids.map((id) => [
        id,
        { score: 0, wrong: 0, answered: 0, lastAt: 0, ...perPlayer[id] },
      ])
    ),
    pendingLoserIds: [],
  };
}

test("makeQuestion: addition and subtraction both occur", () => {
  let sawAdd = false;
  let sawSub = false;
  for (let i = 0; i < 400; i++) {
    const q = mr.makeQuestion();
    if (q.text.includes("+")) sawAdd = true;
    if (q.text.includes("-")) sawSub = true;
  }
  assert.ok(sawAdd, "expected some addition questions");
  assert.ok(sawSub, "expected some subtraction questions");
});

test("makeQuestion: exactly one correct option, and it is the stated answer", () => {
  for (let i = 0; i < 1000; i++) {
    const q = mr.makeQuestion();
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4, "options are distinct");
    const correct = q.options.filter((v) => v === q.answer);
    assert.equal(correct.length, 1, "exactly one option equals the answer");
    assert.equal(q.options[q.correctIndex], q.answer);
  }
});

test("makeQuestion: arithmetic is right, no negatives, wrong options are plausible", () => {
  for (let i = 0; i < 1000; i++) {
    const q = mr.makeQuestion();
    const [a, op, b] = q.text.split(" ");
    const expected = op === "+" ? Number(a) + Number(b) : Number(a) - Number(b);
    assert.equal(q.answer, expected);
    assert.ok(q.answer >= 0, "no negative answers");
    for (const opt of q.options) {
      assert.ok(opt >= 0, "no negative options");
      assert.ok(
        Math.abs(opt - q.answer) <= 9,
        `distractor ${opt} too far from ${q.answer}`
      );
    }
  }
});

test("makeQuestion: honours a custom number range", () => {
  const cfg = { MIN_NUMBER: 2, MAX_NUMBER: 6 };
  for (let i = 0; i < 300; i++) {
    const q = mr.makeQuestion(cfg);
    const [a, , b] = q.text.split(" ");
    assert.ok(Number(a) >= 2 && Number(a) <= 6);
    assert.ok(Number(b) >= 2 && Number(b) <= 6);
  }
});

test("buildContest: no minigame when everyone answered correctly", () => {
  const players = [
    { id: "A", hasAnswered: true, lastAnswerIndex: 1 },
    { id: "B", hasAnswered: true, lastAnswerIndex: 1 },
  ];
  assert.equal(mr.buildContest({ players, correctIndex: 1, roundIndex: 2 }), null);
});

test("buildContest: 1 wrong -> everyone plays, failer recorded", () => {
  const players = [
    { id: "A", hasAnswered: true, lastAnswerIndex: 0 },
    { id: "B", hasAnswered: true, lastAnswerIndex: 1 },
    { id: "C", hasAnswered: true, lastAnswerIndex: 1 },
  ];
  const c = mr.buildContest({ players, correctIndex: 1, roundIndex: 2 });
  assert.deepEqual(c.contestantIds.sort(), ["A", "B", "C"]);
  assert.deepEqual(c.quizFailerIds, ["A"]);
});

test("resolveLosers: single lowest score loses", () => {
  const mg = mkMg({ A: { score: 8 }, B: { score: 6 }, C: { score: 3 }, D: { score: 5 } });
  assert.deepEqual(mr.resolveLosers(mg), ["C"]);
});

test("resolveLosers: a quiz-failer who beats the minimum is safe", () => {
  // C failed the quiz but scored 5; D scored lowest (3) -> D loses.
  const mg = mkMg({ A: { score: 8 }, B: { score: 6 }, C: { score: 5 }, D: { score: 3 } });
  mg.quizFailerIds = ["C"];
  const losers = mr.resolveLosers(mg);
  assert.deepEqual(losers, ["D"]);
  mg.pendingLoserIds = losers;
  const res = mr.buildResults(mg);
  assert.deepEqual(res.savedFailerIds, ["C"]);
});

test("resolveLosers: multiple quiz-failers, only the worst Math Rush score loses", () => {
  // A and B failed the quiz. B has the lowest Math Rush score -> only B loses.
  const mg = mkMg({ A: { score: 7 }, B: { score: 4 }, C: { score: 6 }, D: { score: 5 } });
  mg.quizFailerIds = ["A", "B"];
  assert.deepEqual(mr.resolveLosers(mg), ["B"]);
});

test("resolveLosers: tied lowest score broken by pace, then accuracy, then time", () => {
  // B and D tie at 3. D answered fewer questions (slower pace) -> D loses.
  const mg = mkMg({
    A: { score: 8, answered: 12 },
    B: { score: 3, answered: 9, wrong: 6 },
    C: { score: 6, answered: 7 },
    D: { score: 3, answered: 5, wrong: 2 },
  });
  assert.deepEqual(mr.resolveLosers(mg), ["D"]);

  // same pace -> more wrong answers loses
  const mg2 = mkMg({
    B: { score: 3, answered: 9, wrong: 6, lastAt: 100 },
    D: { score: 3, answered: 9, wrong: 2, lastAt: 100 },
  });
  assert.deepEqual(mr.resolveLosers(mg2), ["B"]);

  // same pace + accuracy -> later last answer loses
  const mg3 = mkMg({
    B: { score: 3, answered: 9, wrong: 3, lastAt: 200 },
    D: { score: 3, answered: 9, wrong: 3, lastAt: 500 },
  });
  assert.deepEqual(mr.resolveLosers(mg3), ["D"]);
});

test("onClientEvent: server awards points, rejects stale/duplicate answers", () => {
  const mg = mr.buildContest({
    players: [
      { id: "A", hasAnswered: true, lastAnswerIndex: 9 },
      { id: "B", hasAnswered: true, lastAnswerIndex: 0 },
    ],
    correctIndex: 0,
    roundIndex: 2,
  });
  mr.onStart(mg);
  const emitted = [];
  const ctx = {
    now: () => 1000,
    emitAll: () => {},
    emitPlayer: (pid, ev, data) => emitted.push({ pid, ev, data }),
    scheduleResolve: () => {},
  };
  mr.onSync(mg, 1000 - mr.CONFIG.PREP_MS, ctx); // playStartAt = 1000

  const q0 = mg.pool[0];
  // correct answer for A
  mr.onClientEvent(mg, "A", "mathRush:answer", { seq: 0, choice: q0.correctIndex }, ctx);
  assert.equal(mg.mr.A.score, 1);
  assert.equal(mg.mr.A.cursor, 1);

  // duplicate seq=0 is ignored
  mr.onClientEvent(mg, "A", "mathRush:answer", { seq: 0, choice: q0.correctIndex }, ctx);
  assert.equal(mg.mr.A.score, 1);
  assert.equal(mg.mr.A.answered, 1);

  // wrong answer -> minus one point, still advances
  const q1 = mg.pool[1];
  const wrongChoice = (q1.correctIndex + 1) % 4;
  mr.onClientEvent(mg, "A", "mathRush:answer", { seq: 1, choice: wrongChoice }, ctx);
  assert.equal(mg.mr.A.score, 0);
  assert.equal(mg.mr.A.wrong, 1);
  assert.equal(mg.mr.A.cursor, 2);

  // the score may go below zero
  const q2 = mg.pool[2];
  mr.onClientEvent(mg, "A", "mathRush:answer", { seq: 2, choice: (q2.correctIndex + 1) % 4 }, ctx);
  assert.equal(mg.mr.A.score, -1);
});

test("onClientEvent: answers outside the play window are rejected", () => {
  const mg = mr.buildContest({
    players: [
      { id: "A", hasAnswered: true, lastAnswerIndex: 9 },
      { id: "B", hasAnswered: true, lastAnswerIndex: 0 },
    ],
    correctIndex: 0,
    roundIndex: 2,
  });
  mr.onStart(mg);
  const ctx = { now: () => 0, emitAll: () => {}, emitPlayer: () => {}, scheduleResolve: () => {} };
  mr.onSync(mg, 1000, ctx); // playStartAt = 1000 + PREP
  // now() is 0 -> before the window
  mr.onClientEvent(mg, "A", "mathRush:answer", { seq: 0, choice: mg.pool[0].correctIndex }, ctx);
  assert.equal(mg.mr.A.answered, 0);
});

test("maximum level: multiplication 2..15 joins in, right answer, plausible slips", () => {
  const cfg = { ...mr.CONFIG };
  let products = 0;
  for (let i = 0; i < 600; i++) {
    const q = mr.makeQuestion(cfg, { multiply: true });
    if (!q.text.includes("×")) continue;
    products += 1;
    const [a, , b] = q.text.split(" ");
    assert.ok(Number(a) >= 1 && Number(a) <= 15 && Number(b) >= 1 && Number(b) <= 15, q.text);
    assert.equal(q.answer, Number(a) * Number(b));
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.equal(q.options[q.correctIndex], q.answer);
    assert.ok(q.options.every((o) => o >= 0));
  }
  assert.ok(products > 120 && products < 300, `about a third: ${products}`);
  for (let i = 0; i < 200; i++) assert.ok(!mr.makeQuestion(cfg).text.includes("×"), "no multiplication below the max level");
});

test("maximum level: hard always, mixed from round 7, easy/medium never", () => {
  assert.equal(mr.isMaxLevel("hard", 1), true);
  assert.equal(mr.isMaxLevel("mixed", 6), false);
  assert.equal(mr.isMaxLevel("mixed", 7), true);
  assert.equal(mr.isMaxLevel("medium", 9), false);
  assert.equal(mr.isMaxLevel("easy", 9), false);
});
