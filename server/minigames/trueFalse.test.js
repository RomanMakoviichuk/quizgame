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
