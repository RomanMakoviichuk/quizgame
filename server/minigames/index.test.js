const test = require("node:test");
const assert = require("node:assert");
const { MINIGAMES, selectForRound } = require("./index");

const ids = (list) => list.map((d) => d.ID);
const ALL = ids(MINIGAMES);

test("a fresh game: every minigame is a candidate, tug of war (RARE) first", () => {
  for (let k = 0; k < 20; k++) {
    const list = ids(selectForRound(1, []));
    assert.strictEqual(list[0], "tugOfWar");
    assert.deepStrictEqual([...list].sort(), [...ALL].sort());
  }
});

test("a played minigame is never offered again while others are unplayed", () => {
  const history = ["tugOfWar", "rat", "tune"];
  const list = ids(selectForRound(4, history));
  assert.ok(history.every((id) => !list.includes(id)), list.join());
  assert.deepStrictEqual([...list].sort(), ALL.filter((id) => !history.includes(id)).sort());
});

test("the unplayed ones come in random order", () => {
  const firsts = new Set();
  for (let k = 0; k < 60; k++) firsts.add(selectForRound(2, ["tugOfWar"])[0].ID);
  assert.ok(firsts.size >= 3, `only ${[...firsts]}`);
});

test("a whole game: all 8 once, then a new cycle that never starts with the previous one", () => {
  const history = [];
  for (let round = 1; round <= ALL.length + 4; round++) {
    const list = ids(selectForRound(round, history));
    history.push(list[0]); // pretend the first candidate's trigger always holds
  }
  assert.deepStrictEqual([...history.slice(0, ALL.length)].sort(), [...ALL].sort(), "no repeats in the first cycle");
  assert.notStrictEqual(history[ALL.length], history[ALL.length - 1]);
  for (let i = 1; i < history.length; i++) assert.notStrictEqual(history[i], history[i - 1]);
});

test("a skipped trigger (odd count) keeps tug of war first for later rounds", () => {
  const list = ids(selectForRound(2, ["rps"]));
  assert.strictEqual(list[0], "tugOfWar");
  assert.ok(!list.includes("rps"));
});

test("only one minigame left unplayed: it is the only candidate (no repeat as a fallback)", () => {
  const history = ALL.filter((id) => id !== "memory");
  assert.deepStrictEqual(ids(selectForRound(8, history)), ["memory"]);
});

test("MINIGAME_DEMO forces one minigame (+ mathRush fallback)", () => {
  process.env.MINIGAME_DEMO = "rat";
  try {
    assert.deepStrictEqual(ids(selectForRound(3, ["rat"])), ["rat", "mathRush"]);
  } finally {
    delete process.env.MINIGAME_DEMO;
  }
});
