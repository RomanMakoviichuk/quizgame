/**
 * «Серед нас: КРИСА» — run: node --test minigames/rat.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const rat = require("./rat");

const ids = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
const players = (n, wrong = n) =>
  ids(n).map((id, i) => ({ id, hasAnswered: true, lastAnswerIndex: i < wrong ? 0 : 2 })); // correctIndex 2

// ---------------------------------------------------------------- the four scenarios

test("A: everybody keeps -> team win, nobody loses a life", () => {
  const o = rat.decide(ids(4), { P1: "keep", P2: "keep", P3: "keep", P4: "keep" });
  assert.equal(o.scenario, "trust");
  assert.deepEqual(o.winnerIds, ids(4));
  assert.deepEqual(o.loserIds, []);
  assert.equal(o.steal + o.keep, o.total);
});

test("B: exactly one steals -> that one wins, everybody else loses", () => {
  const o = rat.decide(ids(4), { P1: "keep", P2: "steal", P3: "keep", P4: "keep" });
  assert.equal(o.scenario, "rat");
  assert.deepEqual(o.winnerIds, ["P2"]);
  assert.deepEqual(o.loserIds, ["P1", "P3", "P4"]);
});

test("C: two or more but not all steal -> the rats lose, everybody else is safe", () => {
  let o = rat.decide(ids(4), { P1: "steal", P2: "steal", P3: "keep", P4: "keep" });
  assert.equal(o.scenario, "manyRats");
  assert.deepEqual(o.loserIds, ["P1", "P2"]);
  assert.deepEqual(o.winnerIds, ["P3", "P4"]);
  o = rat.decide(ids(4), { P1: "steal", P2: "steal", P3: "steal" }); // P4 didn't vote = kept
  assert.equal(o.scenario, "manyRats");
  assert.deepEqual(o.loserIds, ["P1", "P2", "P3"]);
  assert.deepEqual(o.winnerIds, ["P4"]);
});

test("D: everybody steals -> everybody loses", () => {
  const o = rat.decide(ids(3), { P1: "steal", P2: "steal", P3: "steal" });
  assert.equal(o.scenario, "allRats");
  assert.deepEqual(o.loserIds, ids(3));
  // with two players "both steal" is D, not B or C
  assert.equal(rat.decide(ids(2), { P1: "steal", P2: "steal" }).scenario, "allRats");
});

test("no vote = keep by inaction, listed separately; T = S + N always", () => {
  const o = rat.decide(ids(4), { P2: "steal" });
  assert.equal(o.scenario, "rat");
  assert.deepEqual(o.abstainIds, ["P1", "P3", "P4"]);
  assert.deepEqual(o.keepIds, ["P1", "P3", "P4"]);
  assert.equal(o.steal + o.keep, 4);
  // nobody voted at all -> everybody "kept" -> team win
  assert.equal(rat.decide(ids(3), {}).scenario, "trust");
});

// ---------------------------------------------------------------- who plays

test("only the players who were wrong play; fewer than 2 -> no contest", () => {
  const c = rat.buildContest({ players: players(5, 3), correctIndex: 2, roundIndex: 4 });
  assert.deepEqual(c.contestantIds, ["P1", "P2", "P3"]);
  assert.equal(rat.buildContest({ players: players(5, 1), correctIndex: 2, roundIndex: 4 }), null);
  assert.equal(rat.buildContest({ players: players(5, 0), correctIndex: 2, roundIndex: 4 }), null);
  assert.equal(rat.buildContest({ players: [], correctIndex: 2, roundIndex: 4 }), null);
  // didn't answer = wrong
  const ps = players(3, 0);
  ps[0].hasAnswered = false;
  ps[2].hasAnswered = false;
  assert.deepEqual(rat.buildContest({ players: ps, correctIndex: 2, roundIndex: 4 }).contestantIds, ["P1", "P3"]);
});

// ---------------------------------------------------------------- the vote

function harness(n) {
  const mg = rat.buildContest({ players: players(n), correctIndex: 2, roundIndex: 1 });
  rat.onStart(mg);
  let clock = 1000;
  const all = [];
  const toPlayer = [];
  const ctx = {
    now: () => clock,
    emitAll: (ev, d) => all.push([ev, d]),
    emitPlayer: (id, ev, d) => toPlayer.push([id, ev, d]),
    scheduleResolve: () => {},
  };
  rat.onSync(mg, clock, ctx);
  const vote = (id, choice) => rat.onClientEvent(mg, id, "rat:vote", { choice }, ctx);
  return {
    mg,
    ctx,
    vote,
    all,
    toPlayer,
    at: (t) => {
      clock = t;
    },
    open: () => {
      clock = mg.rat.voteStartAt;
    },
    end: () => {
      clock = mg.rat.voteEndAt;
    },
  };
}

test("the vote window is 30 s on the server clock; early and late votes are ignored", () => {
  const h = harness(3);
  assert.equal(h.mg.rat.voteEndAt - h.mg.rat.voteStartAt, 30000);
  h.at(h.mg.rat.voteStartAt - 1);
  h.vote("P1", "steal");
  assert.equal(h.mg.rat.votes.P1, undefined, "before the window");
  h.open();
  h.vote("P1", "steal");
  assert.equal(h.mg.rat.votes.P1, "steal");
  h.at(h.mg.rat.voteEndAt - 1);
  h.vote("P2", "keep");
  assert.equal(h.mg.rat.votes.P2, "keep", "the last millisecond still counts");
  h.end();
  h.vote("P3", "steal"); // exactly at the end = late
  assert.equal(h.mg.rat.votes.P3, undefined);
});

test("a vote is final: re-voting can't change it, bad choices are ignored", () => {
  const h = harness(3);
  h.open();
  h.vote("P1", "keep");
  h.vote("P1", "steal");
  h.vote("P2", "maybe");
  h.vote("P2", "");
  assert.equal(h.mg.rat.votes.P1, "keep");
  assert.equal(h.mg.rat.votes.P2, undefined);
  // the second try only re-confirms the original choice to that player
  const acks = h.toPlayer.filter(([id, ev]) => id === "P1" && ev === "rat:ack").map(([, , d]) => d.choice);
  assert.deepEqual(acks, ["keep", "keep"]);
});

test("secrecy: before the end nothing public tells who chose what, or how many stole", () => {
  const h = harness(4);
  h.open();
  h.vote("P1", "steal");
  h.vote("P2", "keep");
  const publicEvents = JSON.stringify(h.all);
  assert.ok(!publicEvents.includes("steal") && !publicEvents.includes("keep"));
  assert.deepEqual(h.all.at(-1), ["rat:progress", { voted: 2, total: 4 }]);
  // the own choice goes to the voter only
  assert.ok(h.toPlayer.every(([id, ev, d]) => ev !== "rat:ack" || h.mg.rat.votes[id] === d.choice));
});

test("the outcome is frozen at the close: late votes and repeated resolving can't change it", () => {
  const h = harness(3);
  h.open();
  h.vote("P2", "steal");
  h.end();
  const losers = rat.resolveLosers(h.mg);
  assert.deepEqual(losers, ["P1", "P3"]);
  assert.equal(rat.resolveWinner(h.mg), "P2");
  // simultaneous / later vote after the close
  h.at(h.mg.rat.voteStartAt + 1);
  h.vote("P1", "steal");
  assert.deepEqual(rat.resolveLosers(h.mg), ["P1", "P3"]);
  assert.equal(rat.buildResults(h.mg).rat.scenario, "rat");
});

test("a player who left keeps the vote they cast; one who never voted counts as keep", () => {
  const h = harness(3);
  h.open();
  h.vote("P3", "steal"); // P3 then disconnects; P1 left before voting
  h.vote("P2", "steal");
  h.end();
  const r = rat.buildResults(h.mg).rat;
  assert.equal(r.total, 3, "T is the fixed participant list");
  assert.equal(r.scenario, "manyRats");
  assert.deepEqual(r.abstainIds, ["P1"]);
});

test("reopened page: hello re-sends the clock and the own locked vote only", () => {
  const h = harness(3);
  h.open();
  h.vote("P1", "steal");
  h.toPlayer.length = 0;
  rat.onClientEvent(h.mg, "P1", "rat:hello", {}, h.ctx);
  const evs = h.toPlayer.map(([id, ev, d]) => [id, ev, d]);
  assert.ok(evs.some(([id, ev]) => id === "P1" && ev === "rat:go"));
  assert.ok(evs.some(([id, ev, d]) => id === "P1" && ev === "rat:ack" && d.choice === "steal"));
  h.toPlayer.length = 0;
  rat.onClientEvent(h.mg, "P2", "rat:hello", {}, h.ctx);
  assert.ok(!h.toPlayer.some(([, ev]) => ev === "rat:ack"), "nothing to confirm for P2");
});

test("all devices get the same server clock (start / end / server time)", () => {
  const h = harness(2);
  const go = h.all.find(([ev]) => ev === "rat:go")[1];
  assert.equal(go.voteStartAt, h.mg.rat.voteStartAt);
  assert.equal(go.voteEndAt, h.mg.rat.voteEndAt);
  assert.equal(go.serverNow, 1000);
  assert.equal(go.total, 2);
});

// ---------------------------------------------------------------- with the real lives system

test("through phases: lives taken once, max one per player, winner +1, ghosts handled", (t) => {
  const createPhases = require("../phases");
  const rooms = require("../rooms");
  const clock = require("../clock");
  const { GAME_STATE, TOTAL_ROUNDS, LIVES_PER_PLAYER } = require("../config");
  const log = [];
  const io = { to: (target) => ({ emit: (event, data) => log.push({ target, event, data }) }) };
  const phases = createPhases(io);
  const room = rooms.createRoom("display-sock", "cat");
  t.after(() => rooms.deleteRoom(room.code));
  const ps = [0, 1, 2, 3].map((i) => rooms.addPlayer(room, `s${i}`, `P${i}`));
  room.rounds = Array.from({ length: TOTAL_ROUNDS }, (_, i) => ({
    roundIndex: i + 1,
    question: { id: `q${i}`, text: `Q${i}`, options: ["a", "b", "c", "d"], correctIndex: 0 },
  }));
  room.currentRoundIndex = 0;
  room.gameState = GAME_STATE.ANSWER_PHASE;
  // three wrong, one right; P0 is on the last life
  ps.forEach((p, i) => {
    p.hasAnswered = true;
    p.lastAnswerIndex = i < 3 ? 2 : 0;
  });
  ps[0].lives = 1;

  const prev = process.env.MINIGAME_DEMO;
  process.env.MINIGAME_DEMO = "rat";
  t.after(() => {
    if (prev === undefined) delete process.env.MINIGAME_DEMO;
    else process.env.MINIGAME_DEMO = prev;
  });
  phases.emitScores(room);
  const mg = room.minigame;
  assert.equal(mg.minigameId, "rat");
  assert.deepEqual(mg.contestantIds, [ps[0].id, ps[1].id, ps[2].id]);

  phases.startMinigame(room);
  phases.syncMinigame(room);
  mg.rat.voteStartAt = clock.now(room) - 1; // open the window now
  phases.handleMinigameEvent(room, ps[1].id, "rat:vote", { choice: "steal" });
  phases.handleMinigameEvent(room, ps[3].id, "rat:vote", { choice: "steal" }); // not a contestant
  phases.handleMinigameEvent(room, ps[0].id, "rat:vote", { choice: "keep" });

  phases.resolveMinigame(room);
  phases.resolveMinigame(room); // the hard-stop timer firing too
  const results = log.filter((e) => e.event === "trueFalseResults");
  assert.equal(results.length, 1);
  assert.equal(results[0].data.rat.scenario, "rat");
  assert.deepEqual(results[0].data.loserIds, [ps[0].id, ps[2].id]);
  assert.equal(results[0].data.bonusWinnerId, ps[1].id);

  phases.applyMinigameLives(room);
  phases.applyMinigameLives(room); // duplicate aftermath handshake
  assert.equal(ps[0].lives, 0);
  assert.equal(ps[0].isGhost, true, "last life -> ghost");
  assert.equal(ps[2].lives, LIVES_PER_PLAYER - 1);
  assert.equal(ps[1].lives, LIVES_PER_PLAYER, "the rat keeps its lives");
  assert.equal(ps[1].score, 10, "the rat gets the minigame bonus once");
  assert.equal(ps[3].lives, LIVES_PER_PLAYER, "a non-contestant is untouched");
  assert.equal(ps[3].score, 0, "no minigame points for a non-contestant");
});
