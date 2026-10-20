const test = require("node:test");
const assert = require("node:assert/strict");
const trueFalse = require("./trueFalse");

test("tf:progress is relayed to the TV, clamped, other events ignored", () => {
  const mg = { contestantIds: ["A", "B"] };
  const sent = [];
  const ctx = { emitAll: (ev, d) => sent.push([ev, JSON.parse(JSON.stringify(d))]) };

  trueFalse.onClientEvent(mg, "A", "tf:progress", { score: 3, frozen: false }, ctx);
  trueFalse.onClientEvent(mg, "B", "tf:progress", { score: -5, frozen: 1 }, ctx);
  trueFalse.onClientEvent(mg, "A", "something", { score: 99 }, ctx);
  trueFalse.onClientEvent(mg, "A", "tf:progress", { score: 1e9 }, ctx);

  assert.equal(sent.length, 3);
  assert.deepEqual(sent[1], ["trueFalse:live", { byId: { A: { score: 3, frozen: false }, B: { score: 0, frozen: true } } }]);
  assert.equal(sent[2][1].byId.A.score, 999);
});

test("lowest final score loses; ties all lose", () => {
  const mg = { contestantIds: ["A", "B", "C"], scores: new Map([["A", 5], ["B", 2], ["C", 2]]) };
  assert.deepEqual(trueFalse.resolveLosers(mg), ["B", "C"]);
});

test("statements: the file is valid, no duplicates; each game gets a fresh set", () => {
  const all = trueFalse.loadStatements();
  assert.ok(all.length >= 400, `only ${all.length} statements`);
  assert.equal(new Set(all.map((s) => s.text.toLowerCase())).size, all.length, "duplicate statements");
  const a = { contestantIds: ["A"] };
  const b = { contestantIds: ["A"] };
  trueFalse.onStart(a);
  trueFalse.onStart(b);
  assert.equal(a.statements.length, trueFalse.STATEMENTS_PER_GAME);
  const seen = new Set(a.statements.map((s) => s.text));
  assert.ok(b.statements.every((s) => !seen.has(s.text)), "the second game repeated a statement");
  assert.deepEqual(trueFalse.startPayload(a), { statements: a.statements });
});
