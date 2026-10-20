const test = require("node:test");
const assert = require("node:assert/strict");
const { createUsage } = require("./usage");

const items = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` }));
const quiet = { log: () => {} };

test("draws only unused items until all are played, then starts over", () => {
  const u = createUsage(null, quiet);
  const seen = new Set();
  for (let g = 0; g < 3; g++) {
    for (const x of u.draw("k", items, 3)) {
      assert.ok(!seen.has(x.id), `repeat before the cycle ended: ${x.id}`);
      seen.add(x.id);
    }
  }
  assert.equal(seen.size, 9);
  // 1 new left: it comes first, the cycle resets, 2 repeats count for the next cycle
  const last = u.draw("k", items, 3);
  assert.ok(!seen.has(last[0].id));
  assert.equal(u.usedSet("k").size, 2);
});

test("record: false only peeks; mark records later", () => {
  const u = createUsage(null, quiet);
  const peek = u.draw("k", items, 4, { record: false });
  assert.equal(u.usedSet("k").size, 0);
  u.mark("k", [peek[0].id], items.map((x) => x.id));
  assert.deepEqual([...u.usedSet("k")], [peek[0].id]);
});

test("kinds are independent", () => {
  const u = createUsage(null, quiet);
  u.draw("a", items, 5);
  assert.equal(u.usedSet("a").size, 5);
  assert.equal(u.usedSet("b").size, 0);
});
