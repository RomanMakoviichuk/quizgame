const test = require("node:test");
const assert = require("node:assert");
const { MINIGAMES, selectForRound } = require("./index");

const ids = (list) => list.map((d) => d.ID);
const ALL = ids(MINIGAMES);

test("a fresh game: every minigame is a candidate, in random order", () => {
  const firsts = new Set();
  for (let k = 0; k < 60; k++) {
    const list = ids(selectForRound(1, []));
    firsts.add(list[0]);
    assert.deepStrictEqual([...list].sort(), [...ALL].sort());
  }
  assert.ok(firsts.size >= 3, `the first one varies: ${[...firsts]}`);
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

test("a whole game: every minigame at most once; once all are played, no more minigames", () => {
  const history = [];
  // (with more minigames than a game's 9 rounds, some simply don't come up this game)
  for (let round = 1; round <= ALL.length; round++) {
    const list = ids(selectForRound(Math.min(round, 9), history));
    if (list.length) history.push(list[0]); // pretend the first candidate's trigger always holds
  }
  assert.deepStrictEqual([...history].sort(), [...ALL].sort(), "each one exactly once");
  assert.deepStrictEqual(ids(selectForRound(9, history)), []);
});

test("from round 5 an unplayed RARE minigame (tug of war) goes first", () => {
  const list = ids(selectForRound(5, ["rps"]));
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
