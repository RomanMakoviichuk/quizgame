const test = require("node:test");
const assert = require("node:assert");
const { MINIGAMES, selectForRound } = require("./index");

const ids = (list) => list.map((d) => d.ID);
const ALL = ids(MINIGAMES);

test("every minigame is a candidate, tug of war (RARE) first while unplayed", () => {
  for (let k = 0; k < 20; k++) {
    const list = ids(selectForRound(1, []));
    assert.strictEqual(list[0], "tugOfWar");
    assert.deepStrictEqual([...list].sort(), [...ALL].sort());
  }
});

test("played minigames go after the unplayed ones, least recent first", () => {
  const history = ["tugOfWar", "rat", "tune"];
  const list = ids(selectForRound(4, history));
  assert.deepStrictEqual(list.slice(-3), ["tugOfWar", "rat", "tune"]);
  assert.deepStrictEqual([...list.slice(0, -3)].sort(), ALL.filter((id) => !history.includes(id)).sort());
});

test("the unplayed ones come in random order", () => {
  const firsts = new Set();
  for (let k = 0; k < 60; k++) firsts.add(selectForRound(2, ["tugOfWar"])[0].ID);
  assert.ok(firsts.size >= 3, `only ${[...firsts]}`);
});

test("a whole game: no repeats until all have run, the previous round's game never first", () => {
  const history = [];
  for (let round = 1; round <= ALL.length + 4; round++) {
    const list = ids(selectForRound(round, history));
    history.push(list[0]); // pretend the first candidate's trigger always holds
  }
  assert.deepStrictEqual([...history.slice(0, ALL.length)].sort(), [...ALL].sort());
  for (let i = 1; i < history.length; i++) assert.notStrictEqual(history[i], history[i - 1]);
  // after a full cycle: the oldest one comes back first
  assert.deepStrictEqual(history.slice(ALL.length, ALL.length + 4), history.slice(0, 4));
});

test("a skipped trigger (odd count) keeps tug of war first for later rounds", () => {
  // round 1: tug's buildContest returned null, something else ran
  const list = ids(selectForRound(2, ["rps"]));
  assert.strictEqual(list[0], "tugOfWar");
  assert.strictEqual(list.at(-1), "rps");
});

test("MINIGAME_DEMO forces one minigame (+ mathRush fallback)", () => {
  process.env.MINIGAME_DEMO = "rat";
  try {
    assert.deepStrictEqual(ids(selectForRound(3, ["rat"])), ["rat", "mathRush"]);
  } finally {
    delete process.env.MINIGAME_DEMO;
  }
});
