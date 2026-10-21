/**
 * «Меморі: кольоровий хаос» — run: node --test minigames/memory.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const mem = require("./memory");

const players = (n, wrong = n) =>
  Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, hasAnswered: true, lastAnswerIndex: i < wrong ? 0 : 2 })); // correctIndex 2

// ---------------------------------------------------------------- registry

test("the registry loads every item with an id + image; bad rows are skipped", () => {
  assert.ok(mem.items.length >= 5, "the shipped registry has at least 5 items");
  for (const it of mem.items) {
    assert.ok(it.id && it.name && it.src && it.fallback);
    assert.deepEqual(it.colors, mem.COLORS);
  }
  const file = path.join(os.tmpdir(), `memitems-${process.pid}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify([
      { id: "a", name: "А", image: "a.png" },
      { id: "a", name: "дубль", image: "a2.png" },
      { name: "без id", image: "x.png" },
      { id: "b", image: "b b.png", colors: ["red", "pink"] },
    ])
  );
  const items = mem.loadItems(file);
  fs.unlinkSync(file);
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
  assert.equal(items[1].name, "b");
  assert.deepEqual(items[1].colors, ["red"], "unknown colours are dropped");
  assert.equal(items[1].fallback, "/assets/minigames/memory/b%20b.png");
});

test("a new item in the registry is used without touching the game code", () => {
  const saved = mem.items;
  try {
    const extra = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, name: `X${i}`, src: `s${i}`, fallback: `f${i}`, colors: mem.COLORS }));
    mem._setItems(extra);
    const seen = new Set();
    for (let k = 0; k < 200; k++) mem.makeRound().lineup.forEach((it) => seen.add(it.id));
    assert.equal(seen.size, 9, "every registered item shows up");
  } finally {
    mem._setItems(saved);
  }
});

// ---------------------------------------------------------------- the round

test("a round: 5 different items, random order, colours from the 4, a mode", () => {
  const orders = new Set();
  const colorsSeen = new Set();
  const modes = { order: 0, color: 0 };
  for (let k = 0; k < 400; k++) {
    const r = mem.makeRound();
    assert.equal(r.lineup.length, 5);
    assert.equal(new Set(r.lineup.map((i) => i.id)).size, 5, "no item twice");
    r.lineup.forEach((it) => {
      assert.ok(mem.COLORS.includes(it.color));
      colorsSeen.add(it.color);
    });
    orders.add(r.lineup.map((i) => i.id).join(","));
    modes[r.mode] += 1;
  }
  assert.ok(orders.size > 100, "item choice and order are random");
  assert.deepEqual([...colorsSeen].sort(), [...mem.COLORS].sort());
  assert.ok(modes.order > 120 && modes.color > 120, `both modes ~50/50: ${JSON.stringify(modes)}`);
});

test("levels: rounds 1-3 easy (2 colours), 4-6 medium (3), 7+ hard (4)", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => mem.levelFor(r).colors), [2, 2, 2, 3, 3, 3, 4, 4, 4]);
  for (const size of [2, 3, 4]) {
    const palettes = new Set();
    for (let k = 0; k < 200; k++) {
      const r = mem.makeRound(mem.items, 5, size);
      assert.equal(r.palette.length, size);
      assert.ok(r.lineup.every((it) => r.palette.includes(it.color)), "every item is painted from the palette");
      const counts = r.palette.map((c) => r.lineup.filter((it) => it.color === c).length);
      assert.ok(counts.every((k) => k >= 1), "every palette colour is used");
      assert.ok(Math.max(...counts) <= Math.ceil(5 / size), `colours dealt evenly: ${counts}`);
      palettes.add(r.palette.join(","));
    }
    if (size < 4) assert.ok(palettes.size > 1, "the palette itself is random");
  }
});

test("the level and palette reach the clients; colour answers outside the palette don't count", () => {
  const mg = mem.buildContest({ players: players(2), correctIndex: 2, roundIndex: 2 });
  mem.onStart(mg);
  assert.equal(mg.mem.level.id, "easy");
  assert.equal(mg.mem.palette.length, 2);
  const outside = mem.COLORS.find((c) => !mg.mem.palette.includes(c));
  mg.mem.mode = "color";
  mg.mem.answerAt = 1;
  mg.mem.endAt = 10;
  const ctx = { now: () => 5, emitPlayer: () => {}, emitAll: () => {}, resolveNow: () => {} };
  mem.onClientEvent(mg, "P1", "mem:answer", { colors: Array(mg.mem.lineup.length).fill(outside) }, ctx);
  assert.ok(mg.mem.answers.P1.colors.every((c) => c === null));
});

test("fewer items than the row: uses what there is, still no repeats", () => {
  const items = mem.items.slice(0, 3);
  const r = mem.makeRound(items, 5);
  assert.equal(r.lineup.length, 3);
  assert.equal(new Set(r.lineup.map((i) => i.id)).size, 3);
});

test("only the wrong players play; fewer than 2 -> no contest", () => {
  assert.deepEqual(mem.buildContest({ players: players(5, 3), correctIndex: 2, roundIndex: 1 }).contestantIds, ["P1", "P2", "P3"]);
  assert.equal(mem.buildContest({ players: players(5, 1), correctIndex: 2, roundIndex: 1 }), null);
});

// ---------------------------------------------------------------- scoring

const ROUND = {
  mode: "order",
  lineup: [
    { id: "a", color: "red" },
    { id: "b", color: "blue" },
    { id: "c", color: "yellow" },
    { id: "d", color: "green" },
    { id: "e", color: "blue" },
  ],
};

test("order: 1 point per item in its place; empty spots score 0", () => {
  assert.equal(mem.scoreAnswer(ROUND, { order: ["a", "b", "c", "d", "e"] }), 5);
  assert.equal(mem.scoreAnswer(ROUND, { order: ["b", "a", "c", "d", "e"] }), 3);
  assert.equal(mem.scoreAnswer(ROUND, { order: ["a", null, null, null, "e"] }), 2);
  assert.equal(mem.scoreAnswer(ROUND, null), 0);
});

test("colour: 1 point per right colour; empty = 0", () => {
  const r = { ...ROUND, mode: "color" };
  assert.equal(mem.scoreAnswer(r, { colors: ["red", "blue", "yellow", "green", "blue"] }), 5);
  assert.equal(mem.scoreAnswer(r, { colors: ["red", "red", "red", "red", "red"] }), 1);
  assert.equal(mem.scoreAnswer(r, { colors: [null, "blue", null, null, null] }), 1);
});

// ---------------------------------------------------------------- the game flow

function harness(n = 3) {
  const mg = mem.buildContest({ players: players(n), correctIndex: 2, roundIndex: 1 });
  mem.onStart(mg);
  let clock = 1000;
  let timer = null;
  const all = [];
  const display = [];
  const toPlayer = [];
  let resolved = 0;
  const ctx = {
    now: () => clock,
    emitAll: (ev, d) => all.push([ev, d]),
    emitDisplay: (ev, d) => display.push([ev, d]),
    emitPlayer: (id, ev, d) => toPlayer.push([id, ev, d]),
    setTimer: (fn, ms) => {
      timer = { at: clock + ms, fn };
    },
    scheduleResolve: (ms) => {
      timer = { at: clock + ms, fn: () => (resolved += 1) };
    },
    resolveNow: () => {
      resolved += 1;
    },
  };
  mem.onSync(mg, clock, ctx);
  const advanceTo = (t) => {
    while (timer && timer.at <= t) {
      const tm = timer;
      timer = null;
      clock = tm.at;
      tm.fn();
    }
    clock = t;
  };
  const answer = (id, data) => mem.onClientEvent(mg, id, "mem:answer", data, ctx);
  const right = () => (mg.mem.mode === "order" ? { order: [...mg.mem.order] } : { colors: [...mg.mem.colors] });
  const wrongBy = (k) => {
    // k mistakes
    if (mg.mem.mode === "order") {
      const o = [...mg.mem.order];
      if (k >= 2) [o[0], o[1]] = [o[1], o[0]];
      if (k >= 4) [o[2], o[3]] = [o[3], o[2]];
      return { order: o };
    }
    const c = [...mg.mem.colors];
    for (let i = 0; i < k; i++) c[i] = mem.COLORS.find((x) => x !== c[i]);
    return { colors: c };
  };
  return { mg, ctx, all, display, toPlayer, answer, right, wrongBy, advanceTo, get resolved() { return resolved; } };
}

test("the coloured row goes to the TV only; phones get the task at the answer phase", () => {
  const h = harness();
  const s = h.mg.mem;
  assert.equal(s.answerAt - s.showAt, mem.CONFIG.SHOW_MS);
  assert.equal(s.endAt - s.answerAt, mem.CONFIG.ANSWER_MS);
  h.advanceTo(s.showAt);
  assert.equal(h.display.length, 1);
  assert.equal(h.display[0][0], "mem:show");
  assert.ok(h.display[0][1].lineup.every((it) => it.color));
  assert.ok(!h.all.some(([ev]) => ev === "mem:show"), "never broadcast to the phones");
  assert.ok(!h.all.some(([ev]) => ev === "mem:task"), "no task before the answer phase");
  h.advanceTo(s.answerAt);
  const task = h.all.find(([ev]) => ev === "mem:task")[1];
  assert.equal(task.mode, s.mode, "the same task for everybody");
  if (s.mode === "color") assert.ok(task.items.every((it) => !("color" in it)), "the colour task hides the colours");
  else assert.deepEqual([...task.items.map((i) => i.id)].sort(), [...s.order].sort());
});

test("answers count only in the window; a locked answer can't change; late ones are ignored", () => {
  const h = harness();
  const s = h.mg.mem;
  h.answer("P1", { ...h.right(), final: true });
  assert.equal(s.answers.P1, undefined, "before the answer phase");
  h.advanceTo(s.answerAt);
  h.answer("P1", { ...h.right(), final: true });
  h.answer("P1", h.wrongBy(4)); // after the lock
  h.answer("P2", h.wrongBy(2)); // a draft, never confirmed — still counts
  h.advanceTo(s.endAt);
  h.answer("P3", { ...h.right(), final: true }); // too late
  h.advanceTo(s.endAt + mem.CONFIG.CLOSE_GRACE_MS);
  assert.equal(h.resolved, 1);
  const res = mem.buildResults(h.mg).memory;
  assert.equal(res.scores.P1, 5);
  assert.equal(res.scores.P2, 3);
  assert.equal(res.scores.P3, 0, "no answer = 0");
  assert.deepEqual(mem.resolveLosers(h.mg), ["P3"]);
  assert.equal(mem.resolveWinner(h.mg), "P1");
});

test("garbage answers are ignored; duplicate ids don't score twice", () => {
  const h = harness(2);
  h.advanceTo(h.mg.mem.answerAt);
  h.answer("P1", { order: "abc" });
  h.answer("P1", { colors: [1, 2] });
  assert.equal(h.mg.mem.answers.P1, undefined);
  if (h.mg.mem.mode === "order") {
    const first = h.mg.mem.order[0];
    h.answer("P2", { order: [first, first, first, first, first] });
    assert.equal(mem.scoreAnswer(h.mg.mem, h.mg.mem.answers.P2), 1);
  } else {
    h.answer("P2", { colors: ["pink", "red", null, "x", "blue"] });
    assert.deepEqual(h.mg.mem.answers.P2.colors.map((c) => c === null || mem.COLORS.includes(c)), [true, true, true, true, true]);
  }
});

test("everybody locked -> results right away", () => {
  const h = harness(2);
  h.advanceTo(h.mg.mem.answerAt + 100);
  h.answer("P1", { ...h.right(), final: true });
  assert.equal(h.resolved, 0);
  h.answer("P2", { ...h.wrongBy(2), final: true });
  assert.equal(h.resolved, 1);
});

test("everybody equal -> nobody loses; ties at the bottom all lose", () => {
  let h = harness(3);
  h.advanceTo(h.mg.mem.answerAt);
  ["P1", "P2", "P3"].forEach((id) => h.answer(id, h.wrongBy(2)));
  assert.deepEqual(mem.resolveLosers(h.mg), []);
  assert.equal(mem.resolveWinner(h.mg), null);

  h = harness(3);
  h.advanceTo(h.mg.mem.answerAt);
  h.answer("P1", h.right());
  h.answer("P2", h.wrongBy(4));
  h.answer("P3", h.wrongBy(4));
  assert.deepEqual(mem.resolveLosers(h.mg), ["P2", "P3"]);
});

test("the outcome is frozen once decided", () => {
  const h = harness(2);
  h.advanceTo(h.mg.mem.answerAt);
  h.answer("P1", h.right());
  const first = JSON.stringify(mem.buildResults(h.mg));
  h.answer("P2", h.right()); // after the outcome was read
  assert.equal(JSON.stringify(mem.buildResults(h.mg)), first);
});

test("a reopened phone gets the clock, the task and its lock back", () => {
  const h = harness(2);
  h.advanceTo(h.mg.mem.answerAt);
  h.answer("P1", { ...h.right(), final: true });
  h.toPlayer.length = 0;
  mem.onClientEvent(h.mg, "P1", "mem:hello", {}, h.ctx);
  const evs = h.toPlayer.filter(([id]) => id === "P1").map(([, ev]) => ev);
  assert.deepEqual(evs.sort(), ["mem:ack", "mem:go", "mem:task"]);
});

// ---------------------------------------------------------------- with the real lives system

test("through phases: lives taken once, the TV gets the row, the phones do not", (t) => {
  const createPhases = require("../phases");
  const rooms = require("../rooms");
  const clock = require("../clock");
  const { GAME_STATE, TOTAL_ROUNDS, LIVES_PER_PLAYER } = require("../config");
  const log = [];
  const io = { to: (target) => ({ emit: (event, data) => log.push({ target, event, data }) }) };
  const phases = createPhases(io);
  const room = rooms.createRoom("display-sock", "cat");
  t.after(() => rooms.deleteRoom(room.code));
  const ps = [0, 1, 2].map((i) => rooms.addPlayer(room, `s${i}`, `P${i}`));
  room.rounds = Array.from({ length: TOTAL_ROUNDS }, (_, i) => ({
    roundIndex: i + 1,
    question: { id: `q${i}`, text: `Q${i}`, options: ["a", "b", "c", "d"], correctIndex: 0 },
  }));
  room.currentRoundIndex = 0;
  room.gameState = GAME_STATE.ANSWER_PHASE;
  ps.forEach((p) => {
    p.hasAnswered = true;
    p.lastAnswerIndex = 2; // all wrong
  });
  const prev = process.env.MINIGAME_DEMO;
  process.env.MINIGAME_DEMO = "memory";
  t.after(() => {
    if (prev === undefined) delete process.env.MINIGAME_DEMO;
    else process.env.MINIGAME_DEMO = prev;
  });
  phases.emitScores(room);
  const mg = room.minigame;
  assert.equal(mg.minigameId, "memory");
  phases.startMinigame(room);
  phases.syncMinigame(room);
  // jump into the answer phase
  mg.mem.answerAt = clock.now(room) - 1;
  const right = mg.mem.mode === "order" ? { order: [...mg.mem.order] } : { colors: [...mg.mem.colors] };
  phases.handleMinigameEvent(room, ps[0].id, "mem:answer", { ...right, final: true });
  phases.handleMinigameEvent(room, ps[1].id, "mem:answer", { ...right, final: true });
  phases.resolveMinigame(room);
  phases.resolveMinigame(room);
  const results = log.filter((e) => e.event === "trueFalseResults");
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].data.loserIds, [ps[2].id]);
  assert.equal(results[0].data.memory.scores[ps[0].id], 5);
  phases.applyMinigameLives(room);
  phases.applyMinigameLives(room);
  assert.equal(ps[2].lives, LIVES_PER_PLAYER - 1, "one life, once");
  assert.equal(ps[0].lives, LIVES_PER_PLAYER);
  assert.ok(!log.some((e) => e.event === "mem:show" && e.target !== "display-sock"), "mem:show only to the display socket");
});

test("levels follow the game's difficulty; mixed (climbing) climbs with the round", () => {
  assert.equal(mem.levelFor(9, "easy").colors, 2);
  assert.equal(mem.levelFor(1, "medium").colors, 3);
  assert.equal(mem.levelFor(1, "hard").colors, 4);
  assert.deepEqual([1, 4, 7].map((r) => mem.levelFor(r, "mixed").colors), [2, 3, 4]);
  assert.equal(mem.CONFIG.SHOW_MS, 10000);
});
