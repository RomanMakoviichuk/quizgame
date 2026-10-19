/**
 * «Вгадай мелодію» — run: node --test minigames/nameThatTune.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const tune = require("./nameThatTune");

const players = (n, wrong = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, hasAnswered: true, lastAnswerIndex: i < wrong ? 0 : 2 })); // correctIndex 2

// ---------------------------------------------------------------- catalogue

test("file names: 'Artist - Title', em dash too; the real folder has enough songs", () => {
  assert.deepEqual(tune.parseFileName("Queen - Bohemian Raphsody.mp3"), { artist: "Queen", title: "Bohemian Raphsody" });
  assert.deepEqual(tune.parseFileName("KAZKA — ПЛАКАЛА.mp3"), { artist: "KAZKA", title: "ПЛАКАЛА" });
  assert.deepEqual(tune.parseFileName("Gorillaz - Feel Good Inc..mp3"), { artist: "Gorillaz", title: "Feel Good Inc." });
  assert.deepEqual(tune.parseFileName("JustATitle.ogg"), { artist: "", title: "JustATitle" });
  const catalog = tune.loadCatalog();
  assert.ok(catalog.length >= 5, `songs found: ${catalog.length}`);
  assert.equal(tune.catalogProblem(catalog), null);
  // tunes.json fixes the names that the files get wrong
  assert.ok(catalog.some((s) => s.title === "Bohemian Rhapsody"));
  assert.ok(catalog.every((s) => fs.existsSync(s.path)));
});

test("a new file in the folder is picked up without code changes; tunes.json overrides / skips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunes-"));
  for (const f of ["A - One.mp3", "B - Two.mp3", "C - Three.ogg", "readme.txt", "D - Four.wav"]) fs.writeFileSync(path.join(dir, f), "x");
  const cat = path.join(dir, "tunes.json");
  fs.writeFileSync(cat, JSON.stringify({ files: { "A - One.mp3": { title: "Uno", artist: "Ay" }, "D - Four.wav": { skip: true } } }));
  const songs = tune.loadCatalog(dir, cat);
  assert.deepEqual(songs.map((s) => s.title).sort(), ["Three", "Two", "Uno"]);
  assert.equal(songs.find((s) => s.title === "Uno").artist, "Ay");
  assert.match(tune.catalogProblem(songs), /5 пісень/, "too few songs -> a clear message, no game");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("4 options: unique titles, the right one included, its position varies", () => {
  const catalog = tune.loadCatalog();
  const positions = new Set();
  for (let k = 0; k < 200; k++) {
    const song = catalog[k % catalog.length];
    const { options, correctIndex } = tune.makeOptions(song, catalog);
    assert.equal(options.length, 4);
    assert.equal(new Set(options.map((o) => o.title.toLowerCase())).size, 4, "no duplicate titles");
    assert.equal(options[correctIndex].songId, song.id);
    positions.add(correctIndex);
  }
  assert.equal(positions.size, 4, "the right answer moves around");
});

// ---------------------------------------------------------------- harness

function harness(n = 4) {
  const mg = tune.buildContest({ players: players(n), correctIndex: 2, roundIndex: 3 });
  tune.onStart(mg);
  let clock = 0;
  let timer = null;
  const all = [];
  const display = [];
  const toPlayer = [];
  let resolved = 0;
  let present = mg.contestantIds.map((id) => ({ id }));
  const ctx = {
    now: () => clock,
    players: () => present,
    emitAll: (ev, d) => all.push([ev, d]),
    emitDisplay: (ev, d) => display.push([ev, d]),
    emitPlayer: (id, ev, d) => toPlayer.push([id, ev, d]),
    setTimer: (fn, ms) => {
      timer = { at: clock + ms, fn };
    },
    scheduleResolve: () => {},
    resolveNow: () => {
      resolved += 1;
    },
  };
  tune.onSync(mg, clock, ctx);
  const runTo = (t) => {
    while (timer && timer.at <= t) {
      const tm = timer;
      timer = null;
      clock = tm.at;
      tm.fn();
    }
    clock = t;
  };
  const t = () => mg.tune;
  const r = () => mg.tune.rounds[mg.tune.index];
  const toLive = () => runTo(r().startAt); // round open
  const answer = (id, choice, index = mg.tune.index) => tune.onClientEvent(mg, id, "tune:answer", { index, choice }, ctx);
  const wrongOf = (round) => (round.correctIndex + 1) % 4;
  return {
    mg, ctx, all, display, toPlayer, runTo, t, r, toLive, answer, wrongOf,
    get clock() { return clock; },
    get resolved() { return resolved; },
    leave: (id) => { present = present.filter((p) => p.id !== id); },
  };
}

function startFirstRound(h) {
  tune.onDisplayEvent(h.mg, "tune:ready", {}, h.ctx);
  h.runTo(tune.CONFIG.INTRO_MS);
  h.toLive();
}

// ---------------------------------------------------------------- the game

test("5 rounds, 5 different songs; the same options for everybody; the answer stays on the server", () => {
  const h = harness(3);
  assert.equal(h.t().rounds.length, 5);
  assert.equal(new Set(h.t().rounds.map((r) => r.song.id)).size, 5);
  startFirstRound(h);
  const roundMsg = h.all.find(([ev]) => ev === "tune:round")[1];
  assert.equal(roundMsg.options.length, 4);
  const leaked = JSON.stringify(h.all) + JSON.stringify(h.toPlayer);
  assert.ok(!leaked.includes("correctIndex"), "no answer before the round closes");
  assert.ok(!leaked.includes("songId") && !leaked.includes(".mp3"), "no song ids / file names to phones");
  const play = h.display.find(([ev]) => ev === "tune:play")[1];
  assert.match(play.url, /^\/tune\/[0-9a-f]{24}$/, "the TV gets an opaque audio url");
});

test("speed scoring: 100 / 80 / 60 by arrival; wrong and silent = 0; one answer only", () => {
  const h = harness(5);
  startFirstRound(h);
  const r = h.r();
  h.runTo(r.startAt + 1000);
  h.answer("P3", r.correctIndex); // 1st right
  h.runTo(r.startAt + 1500);
  h.answer("P1", h.wrongOf(r)); // wrong
  h.answer("P1", r.correctIndex); // a second try is ignored
  h.runTo(r.startAt + 2000);
  h.answer("P5", r.correctIndex); // 2nd right
  h.answer("P2", r.correctIndex); // 3rd right (same ms, later arrival)
  // P4 says nothing
  h.runTo(r.endAt);
  const res = h.all.filter(([ev]) => ev === "tune:result")[0][1];
  const by = Object.fromEntries(res.players.map((p) => [p.id, p]));
  assert.equal(res.correctIndex, r.correctIndex);
  assert.equal(by.P3.points, 100);
  assert.equal(by.P5.points, 80);
  assert.equal(by.P2.points, 60);
  assert.equal(by.P1.points, 0);
  assert.equal(by.P1.correct, false);
  assert.equal(by.P4.points, 0);
  assert.equal(by.P4.choice, null);
  assert.deepEqual(h.t().totals, { P1: 0, P2: 60, P3: 100, P4: 0, P5: 80 });
});

test("points table: any number of players, 8th and later get 10", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(tune.pointsFor), [100, 80, 60, 50, 40, 30, 20, 10, 10, 10]);
});

test("answers before the start, after the end, for another round are rejected", () => {
  const h = harness(3);
  tune.onDisplayEvent(h.mg, "tune:ready", {}, h.ctx);
  h.runTo(tune.CONFIG.INTRO_MS);
  const r = h.r();
  h.answer("P1", r.correctIndex); // during the announce
  assert.equal(r.answers.P1, undefined);
  h.toLive();
  h.answer("P2", r.correctIndex, h.t().index + 1); // wrong round number
  assert.equal(r.answers.P2, undefined);
  h.answer("P3", 7); // not an option
  assert.equal(r.answers.P3, undefined);
  h.runTo(r.endAt);
  h.answer("P1", r.correctIndex); // late
  assert.equal(r.answers.P1, undefined);
});

test("everybody answered -> the round closes early; a player who left isn't waited for", () => {
  const h = harness(3);
  startFirstRound(h);
  const r = h.r();
  h.leave("P3");
  h.answer("P1", r.correctIndex);
  assert.equal(r.status, "live");
  h.answer("P2", h.wrongOf(r));
  assert.equal(r.status, "done", "closed without waiting for the timer");
});

test("five rounds are summed; the game ends once", () => {
  const h = harness(4);
  startFirstRound(h);
  for (let k = 0; k < 5; k++) {
    const r = h.r();
    h.runTo(r.startAt + 100);
    h.answer("P1", r.correctIndex);
    h.runTo(r.startAt + 200);
    if (k < 2) h.answer("P2", r.correctIndex);
    h.runTo(r.endAt);
    h.runTo(h.clock + tune.CONFIG.RESULT_MS);
    if (k < 4) h.runTo(h.r().startAt);
  }
  assert.equal(h.resolved, 1);
  assert.deepEqual(h.t().totals, { P1: 500, P2: 160, P3: 0, P4: 0 });
  assert.deepEqual(h.t().correct, { P1: 5, P2: 2, P3: 0, P4: 0 });
  const res = tune.buildResults(h.mg).tune;
  assert.deepEqual(res.ranked.slice(0, 2), ["P1", "P2"]);
  assert.equal(tune.resolveWinner(h.mg), "P1");
});

// ---------------------------------------------------------------- lives

test("4+ players -> the 3 lowest lose; 3 players -> 1; 2 players -> 1", () => {
  const t5 = { A: 300, B: 250, C: 120, D: 60, E: 0 };
  assert.deepEqual(tune.decideLosers(Object.keys(t5), t5).loserIds.sort(), ["C", "D", "E"]);
  const t3 = { A: 300, B: 100, C: 40 };
  assert.deepEqual(tune.decideLosers(Object.keys(t3), t3).loserIds, ["C"]);
  const t2 = { A: 100, B: 0 };
  assert.deepEqual(tune.decideLosers(Object.keys(t2), t2).loserIds, ["B"]);
});

test("ties on the border all lose (explicitly flagged); everybody equal -> nobody", () => {
  const t = { A: 300, B: 80, C: 80, D: 80, E: 0 };
  const d = tune.decideLosers(Object.keys(t), t);
  assert.deepEqual(d.loserIds.sort(), ["B", "C", "D", "E"]);
  assert.equal(d.tie, true);
  const strict = tune.decideLosers(Object.keys(t), t, { shareLast: false, correct: { B: 2, C: 1, D: 1 }, fastMs: { C: 900, D: 500 } });
  assert.deepEqual(strict.loserIds, ["E", "C", "D"], "strict mode: fewer right, then slower");
  const eq = tune.decideLosers(["A", "B", "C", "D"], { A: 50, B: 50, C: 50, D: 50 });
  assert.deepEqual(eq.loserIds, []);
  assert.equal(eq.allEqual, true);
});

test("through phases: lives are taken once, only from the losers", (t) => {
  const createPhases = require("../phases");
  const rooms = require("../rooms");
  const { GAME_STATE, TOTAL_ROUNDS, LIVES_PER_PLAYER } = require("../config");
  const log = [];
  const io = { to: (target) => ({ emit: (event, data) => log.push({ target, event, data }) }) };
  const phases = createPhases(io);
  const room = rooms.createRoom("display-sock", "cat");
  t.after(() => rooms.deleteRoom(room.code));
  const ps = [0, 1, 2, 3, 4].map((i) => rooms.addPlayer(room, `s${i}`, `P${i}`));
  room.rounds = Array.from({ length: TOTAL_ROUNDS }, (_, i) => ({
    roundIndex: i + 1,
    question: { id: `q${i}`, text: `Q${i}`, options: ["a", "b", "c", "d"], correctIndex: 0 },
  }));
  room.currentRoundIndex = 0;
  room.gameState = GAME_STATE.ANSWER_PHASE;
  ps.forEach((p, i) => {
    p.hasAnswered = true;
    p.lastAnswerIndex = i === 0 ? 2 : 0; // one wrong -> everybody plays
  });
  const prev = process.env.MINIGAME_DEMO;
  process.env.MINIGAME_DEMO = "tune";
  t.after(() => {
    if (prev === undefined) delete process.env.MINIGAME_DEMO;
    else process.env.MINIGAME_DEMO = prev;
  });
  phases.emitScores(room);
  const mg = room.minigame;
  assert.equal(mg.minigameId, "tune");
  assert.equal(mg.contestantIds.length, 5, "every living player plays");
  phases.startMinigame(room);
  phases.syncMinigame(room);
  // pretend the 5 rounds were played
  Object.assign(mg.tune.totals, { [ps[0].id]: 400, [ps[1].id]: 300, [ps[2].id]: 100, [ps[3].id]: 60, [ps[4].id]: 0 });
  phases.resolveMinigame(room);
  phases.resolveMinigame(room);
  const results = log.filter((e) => e.event === "trueFalseResults");
  assert.equal(results.length, 1);
  assert.deepEqual([...results[0].data.loserIds].sort(), [ps[2].id, ps[3].id, ps[4].id].sort());
  phases.applyMinigameLives(room);
  phases.applyMinigameLives(room);
  assert.deepEqual(ps.map((p) => p.lives), [LIVES_PER_PLAYER, LIVES_PER_PLAYER, LIVES_PER_PLAYER - 1, LIVES_PER_PLAYER - 1, LIVES_PER_PLAYER - 1]);
  assert.equal(ps[0].score, 10, "the best total gets the usual bonus once");
  assert.equal(ps[1].score, 5, "kept the life: the safe points");
  assert.equal(ps[2].score, 0, "lost a life: nothing");
});

// ---------------------------------------------------------------- failures & reconnects

test("a clip the TV can't play: the round is replayed with a spare song, nobody punished", () => {
  const h = harness(3);
  startFirstRound(h);
  const before = h.r();
  h.answer("P1", before.correctIndex);
  tune.onDisplayEvent(h.mg, "tune:audioFail", { index: 0 }, h.ctx);
  assert.ok(h.all.some(([ev]) => ev === "tune:retry"));
  h.runTo(h.clock + 1500);
  const after = h.r();
  assert.notEqual(after.song.id, before.song.id, "a different song");
  assert.deepEqual(after.answers, {}, "the earlier answer doesn't carry over");
  assert.deepEqual(h.t().totals, { P1: 0, P2: 0, P3: 0 });
  // no spares left -> the round is void, 0 for everybody, the game goes on
  h.t().spares = [];
  h.toLive();
  tune.onDisplayEvent(h.mg, "tune:audioFail", { index: 0 }, h.ctx);
  const res = h.all.filter(([ev]) => ev === "tune:result").at(-1)[1];
  assert.equal(res.void, true);
  assert.equal(res.correctIndex, null);
});

test("the TV is not waited for forever: no 'ready' -> the first round starts anyway", () => {
  const h = harness(2);
  h.runTo(tune.CONFIG.INTRO_MS + tune.CONFIG.READY_TIMEOUT_MS + 600);
  assert.equal(h.t().index, 0);
});

test("a reopened phone gets the round and its locked answer back", () => {
  const h = harness(3);
  startFirstRound(h);
  const r = h.r();
  h.answer("P2", r.correctIndex);
  h.toPlayer.length = 0;
  tune.onClientEvent(h.mg, "P2", "tune:hello", {}, h.ctx);
  const evs = h.toPlayer.filter(([id]) => id === "P2").map(([, ev, d]) => [ev, d]);
  assert.ok(evs.some(([ev]) => ev === "tune:round"));
  assert.ok(evs.some(([ev, d]) => ev === "tune:ack" && d.choice === r.correctIndex));
});

test("the audio route serves a token, refuses anything else", () => {
  const h = harness(2);
  const url = h.display.find(([ev]) => ev === "tune:preload")[1].urls[0];
  const res = { set() {}, type() {}, sendFile: (p) => (res.sent = p), sendStatus: (c) => (res.status = c), headersSent: false };
  tune.serveAudio({ params: { token: url.split("/").pop() } }, res);
  assert.ok(fs.existsSync(res.sent));
  const bad = { set() {}, type() {}, sendFile() {}, sendStatus: (c) => (bad.status = c) };
  tune.serveAudio({ params: { token: "nope" } }, bad);
  assert.equal(bad.status, 404);
});
