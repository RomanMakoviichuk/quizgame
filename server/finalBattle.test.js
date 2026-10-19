/**
 * Final race rules (pure). The timer/socket wiring is covered in phases.test.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const fb = require("./finalBattle");
const { pickFinalDeck } = require("./questions");
const { FINAL } = require("./config");

const mkPlayers = (specs) =>
  specs.map((s, i) => ({
    id: s.id || `p${i + 1}`,
    name: s.name || `P${i + 1}`,
    score: s.score ?? 0,
    isGhost: !!s.isGhost,
    characterSlot: i + 1,
  }));

/** A race where every participant starts on `pos` (bypasses the rating). */
function raceAt(positions, extra = {}) {
  const race = fb.createRace(mkPlayers(positions.map(() => ({}))));
  race.participants.forEach((p, i) => (p.pos = positions[i]));
  Object.assign(race, extra);
  return race;
}

const pos = (race, id) => race.participants.find((p) => p.id === id).pos;
const status = (race, id) => race.participants.find((p) => p.id === id).status;

/** One question: answers = [[id, index], ...] in arrival order; correct index 0. */
function step(race, answers) {
  fb.beginStep(race, 0);
  for (const [id, idx] of answers) fb.submitAnswer(race, id, idx);
  return fb.resolveStep(race);
}

// ------------------------------------------------------------- start cells

test("startPosition: relative to the leader — the leader in the middle, 0 nearest the darkness", () => {
  assert.equal(FINAL.START_MAX, FINAL.EXIT / 2);
  for (const [score, best, cell] of [[0, 100, 6], [100, 100, 15], [50, 100, 11], [25, 100, 8], [180, 180, 15], [0, 0, 6]]) {
    assert.equal(fb.startPosition(score, best), cell, `score ${score} of ${best}`);
  }
});

test("startPosition: always within START_MIN..START_MAX (the middle), also for junk input", () => {
  for (let s = -50; s <= 300; s++) {
    const c = fb.startPosition(s, 200);
    assert.ok(c >= FINAL.START_MIN && c <= FINAL.START_MAX, `score ${s} -> ${c}`);
  }
  assert.equal(fb.startPosition(undefined, 50), 6);
  assert.equal(fb.startPosition("abc", 50), 6);
  assert.equal(fb.startPosition(80, "junk"), 6);
});

test("createRace: everyone races, ghosts included, start from the rating vs the leader", () => {
  const race = fb.createRace(mkPlayers([{ score: 90 }, { score: 20, isGhost: true }]));
  assert.equal(race.participants.length, 2);
  assert.deepEqual(race.participants.map((p) => p.status), ["racing", "racing"]);
  assert.equal(race.participants[0].pos, 15); // the leader: the middle
  assert.equal(race.participants[1].pos, 8); // 20/90 of the way: 6 + 2
  assert.equal(race.participants[1].wasGhost, true);
});

// ---------------------------------------------------------------- movement

test("correct answers move 4 / 3 / 2 by arrival, every later correct one +1", () => {
  assert.deepEqual(FINAL.MOVES, [4, 3, 2]);
  assert.equal(FINAL.MOVE_OTHER_CORRECT, 1);
  const race = raceAt([10, 10, 10, 10, 10, 10, 10]);
  const r = step(race, ["p1", "p2", "p3", "p4", "p5", "p6", "p7"].map((id) => [id, 0]));
  assert.deepEqual(
    race.participants.map((p) => p.pos),
    [14, 13, 12, 11, 11, 11, 11] // 4-3-2-1-1-1-1
  );
  assert.deepEqual(r.movers.map((m) => m.rank), [1, 2, 3, 4, 5, 6, 7]);
});

test("wrong or missing answers still don't move, even among late correct ones", () => {
  const race = raceAt([10, 10, 10, 10, 10]);
  step(race, [["p1", 0], ["p2", 0], ["p3", 1], ["p4", 0], ["p5", 0]]); // p3 wrong
  assert.deepEqual(race.participants.map((p) => p.pos), [14, 13, 10, 12, 11]);
});

test("a wrong answer does not take a podium slot", () => {
  const race = raceAt([10, 10, 10]);
  step(race, [["p1", 2], ["p2", 0], ["p3", 0]]);
  assert.equal(pos(race, "p1"), 10);
  assert.equal(pos(race, "p2"), 14);
  assert.equal(pos(race, "p3"), 13);
});

test("a lone correct answer gets the full first-place move; nobody correct -> nobody moves", () => {
  const race = raceAt([10, 10]);
  step(race, [["p1", 1], ["p2", 0]]);
  assert.deepEqual([pos(race, "p1"), pos(race, "p2")], [10, 14]);
  step(race, [["p1", 1], ["p2", 3]]);
  assert.deepEqual([pos(race, "p1"), pos(race, "p2")], [10, 14]);
});

test("no answer -> no movement", () => {
  const race = raceAt([10, 10]);
  step(race, [["p2", 0]]);
  assert.equal(pos(race, "p1"), 10);
});

test("a repeated answer is ignored (no double move, can't change the answer)", () => {
  const race = raceAt([10, 10]);
  fb.beginStep(race, 0);
  assert.equal(fb.submitAnswer(race, "p1", 2).accepted, true);
  assert.equal(fb.submitAnswer(race, "p1", 0).accepted, false);
  assert.equal(fb.submitAnswer(race, "p1", 0).accepted, false);
  fb.submitAnswer(race, "p2", 0);
  fb.resolveStep(race);
  assert.equal(pos(race, "p1"), 10); // first answer (wrong) stands
  assert.equal(pos(race, "p2"), 14);
});

test("invalid indices and unknown players are rejected; answers only while open", () => {
  const race = raceAt([10]);
  assert.equal(fb.submitAnswer(race, "p1", 0).accepted, false); // not open yet
  fb.beginStep(race, 0);
  assert.equal(fb.submitAnswer(race, "p1", 7).accepted, false);
  assert.equal(fb.submitAnswer(race, "p1", "x").accepted, false);
  assert.equal(fb.submitAnswer(race, "ghost-of-nobody", 0).accepted, false);
  fb.resolveStep(race);
  assert.equal(fb.resolveStep(race), null); // a step resolves once
});

test("a ghost moves exactly like a living player", () => {
  const race = fb.createRace(mkPlayers([{ score: 0, isGhost: true }, { score: 0 }]));
  step(race, [["p1", 0], ["p2", 0]]);
  assert.equal(pos(race, "p1"), 10);
  assert.equal(pos(race, "p2"), 9);
});

// -------------------------------------------------------------- exit / win

test("position never exceeds the exit", () => {
  const race = raceAt([29, 10]);
  const r = step(race, [["p1", 0]]);
  assert.equal(pos(race, "p1"), FINAL.EXIT);
  assert.equal(r.movers[0].to, 30);
});

test("reaching the exit wins, once; the race then ignores further steps", () => {
  const race = raceAt([28, 10]);
  const r = step(race, [["p1", 0]]);
  assert.equal(r.winnerId, "p1");
  assert.equal(r.ending, fb.ENDING.ESCAPED);
  assert.equal(status(race, "p1"), "escaped");
  assert.equal(fb.beginStep(race, 0), false);
  assert.equal(fb.resolveStep(race), null);
  assert.equal(race.participants.filter((p) => p.status === "escaped").length, 1);
});

test("two players reach the exit in one step: the earlier server answer wins", () => {
  const race = raceAt([28, 29]);
  const r = step(race, [["p2", 0], ["p1", 0]]); // p2 first -> +4, p1 second -> +3 (both reach 30)
  assert.equal(r.winnerId, "p2");
  assert.equal(status(race, "p1"), "racing");

  const race2 = raceAt([28, 29]);
  const r2 = step(race2, [["p1", 0], ["p2", 0]]);
  assert.equal(r2.winnerId, "p1"); // same cells, opposite arrival -> opposite winner
});

test("simultaneous answers are ordered by the server's acceptance seq, never ties", () => {
  const race = raceAt([10, 10, 10]);
  fb.beginStep(race, 0);
  ["p3", "p1", "p2"].forEach((id) => fb.submitAnswer(race, id, 0));
  const seqs = [...race.answers.values()].map((a) => a.seq);
  assert.deepEqual(seqs, [1, 2, 3]);
  const r = fb.resolveStep(race);
  assert.deepEqual(r.movers.map((m) => m.id), ["p3", "p1", "p2"]);
});

// -------------------------------------------------------------- darkness

test("darkness schedule: grace 2, +2 until step 6, then +3 — past the exit on step 13", () => {
  for (const n of [1, 2, 4, 8]) {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 11, 12].map((s) => fb.darknessAt(s, n)),
      [2, 2, 4, 6, 8, 10, 13, 16, 25, 28]
    );
    assert.ok(fb.darknessAt(13, n) >= FINAL.EXIT);
  }
});

test("darkness consumes racers on or behind it — not after a single bad step", () => {
  const race = raceAt([6, 20]);
  step(race, []); // step 1 — grace
  step(race, []); // step 2 — grace
  assert.equal(status(race, "p1"), "racing");
  const r = step(race, []); // 2 players: darkness -> 4
  assert.equal(status(race, "p1"), "racing");
  const r2 = step(race, []); // darkness -> 6 == p1
  assert.deepEqual(r.consumed, []);
  assert.deepEqual(r2.consumed, ["p1"]);
  assert.equal(status(race, "p1"), "consumed");
  assert.equal(race.participants[0].consumedAtStep, 4);
});

test("a consumed player can't answer or move any more", () => {
  const race = raceAt([6, 20]);
  for (let i = 0; i < 4; i++) step(race, []);
  assert.equal(status(race, "p1"), "consumed");
  fb.beginStep(race, 0);
  assert.equal(fb.submitAnswer(race, "p1", 0).accepted, false);
  fb.resolveStep(race);
  assert.equal(pos(race, "p1"), 6);
});

test("everyone consumed -> 'all consumed' ending, and it always terminates", () => {
  for (const n of [1, 2, 4, 8]) {
    const race = fb.createRace(mkPlayers(Array.from({ length: n }, () => ({ score: 99 }))));
    let r;
    let steps = 0;
    do {
      r = step(race, []); // nobody ever answers
      steps++;
    } while (!r.ending && steps < 100);
    assert.equal(r.ending, fb.ENDING.ALL_CONSUMED, `n=${n}`);
    assert.ok(steps <= 13, `n=${n} took ${steps} steps`);
    assert.equal(race.winnerId, null);
  }
});

test("a lone participant still has to make it to the exit", () => {
  const race = fb.createRace(mkPlayers([{ score: 0 }]));
  let r;
  do r = step(race, [["p1", 0]]);
  while (!r.ending);
  assert.equal(r.ending, fb.ENDING.ESCAPED);
  assert.equal(r.winnerId, "p1");
});

test("a disconnected player is not waited for and is eventually consumed", () => {
  const race = raceAt([10, 10]);
  fb.markDisconnected(race, "p2");
  fb.beginStep(race, 0);
  fb.submitAnswer(race, "p1", 0);
  assert.equal(fb.allAnswered(race), true);
  assert.equal(fb.submitAnswer(race, "p2", 0).accepted, false);
});

test("standings: winner first, then by cell, consumed last (latest first)", () => {
  const race = raceAt([5, 12, 27, 6], { playerCount: 2 });
  for (let i = 0; i < 4; i++) step(race, []); // darkness -> 6: p1 (5) and p4 (6) consumed at step 4
  step(race, [["p3", 0]]);
  const s = fb.standings(race).map((x) => x.id);
  assert.equal(s[0], "p3");
  assert.equal(s[1], "p2");
  assert.deepEqual(s.slice(2).sort(), ["p1", "p4"]);
});

// ------------------------------------------------------------------ deck

test("pickFinalDeck: unplayed questions first, never empty while the category has any", () => {
  const qs = Array.from({ length: 12 }, (_, i) => ({
    id: `q${i}`,
    text: `q${i}?`,
    answers: [
      { id: "a", text: "a", isCorrect: true },
      { id: "b", text: "b", isCorrect: false },
      { id: "c", text: "c", isCorrect: false },
      { id: "d", text: "d", isCorrect: false },
    ],
  }));
  const used = qs.slice(0, 9).map((q) => q.id);
  const deck = pickFinalDeck(qs, used, 20);
  assert.equal(deck.length, 20);
  assert.deepEqual(deck.slice(0, 3).map((q) => q.id).sort(), ["q10", "q11", "q9"]);
  for (const q of deck) {
    assert.equal(q.options.length, 4);
    assert.equal(q.options[q.correctIndex], "a");
  }
  assert.deepEqual(pickFinalDeck([], [], 5), []);
});
