const test = require("node:test");
const assert = require("node:assert/strict");
const rps = require("./rps");

const { resolveRoundOutcome, pickLifeLoser } = rps;

test("2 players, different choices -> loser eliminated", () => {
  const o = resolveRoundOutcome({ A: "rock", B: "scissors" });
  assert.equal(o.replay, false);
  assert.equal(o.winningChoice, "rock");
  assert.deepEqual(o.continued, ["A"]);
  assert.deepEqual(o.eliminated, ["B"]);
});

test("2 players, same choice -> draw, replay", () => {
  const o = resolveRoundOutcome({ A: "rock", B: "rock" });
  assert.equal(o.replay, true);
  assert.deepEqual(o.eliminated, []);
});

test("3 players, two choices -> winning side continues", () => {
  const o = resolveRoundOutcome({ A: "rock", B: "rock", C: "scissors" });
  assert.equal(o.winningChoice, "rock");
  assert.deepEqual(o.continued.sort(), ["A", "B"]);
  assert.deepEqual(o.eliminated, ["C"]);
});

test("3 players, rock-paper-scissors cycle -> points: the most beaten choice is out", () => {
  // rock beats scissors, scissors beat paper, paper beats rock -> 0 / 0 / 0 -> replay
  const o = resolveRoundOutcome({ A: "rock", B: "paper", C: "scissors" });
  assert.equal(o.replay, true);
  assert.deepEqual(o.scores, { rock: 0, paper: 0, scissors: 0 });
  assert.deepEqual(o.eliminated, []);
});

test("4 players, two choices -> paper beats rock", () => {
  const o = resolveRoundOutcome({ A: "rock", B: "rock", C: "paper", D: "paper" });
  assert.equal(o.winningChoice, "paper");
  assert.deepEqual(o.continued.sort(), ["C", "D"]);
  assert.deepEqual(o.eliminated.sort(), ["A", "B"]);
});

test("one choice beats every other shown choice -> only it continues", () => {
  // rock beats scissors and solder
  const o = resolveRoundOutcome({ A: "rock", B: "scissors", C: "solder", D: "solder" });
  assert.equal(o.winningChoice, "rock");
  assert.deepEqual(o.continued, ["A"]);
  assert.deepEqual(o.eliminated.sort(), ["B", "C", "D"]);
});

test("cycle with uneven numbers -> lowest points are out", () => {
  // scissors x2 beat paper; paper beats rock; rock beats scissors x2
  // rock: +2 -1 = 1 ; scissors: +1 -1 = 0 ; paper: +1 -2 = -1
  const o = resolveRoundOutcome({ A: "rock", B: "paper", C: "scissors", D: "scissors" });
  assert.equal(o.replay, false);
  assert.deepEqual(o.scores, { rock: 1, paper: -1, scissors: 0 });
  assert.deepEqual(o.outChoices, ["paper"]);
  assert.deepEqual(o.eliminated, ["B"]);
  assert.deepEqual(o.continued.sort(), ["A", "C", "D"]);
});

test("all five shown once -> everyone level, replay", () => {
  const o = resolveRoundOutcome({ A: "rock", B: "paper", C: "scissors", D: "solder", E: "yanukovych" });
  assert.equal(o.replay, true);
  assert.deepEqual(o.eliminated, []);
});

test("every option beats exactly two and loses to two, with a verb for each win", () => {
  for (const c of rps.CHOICES) {
    assert.equal(rps.BEATS[c].length, 2);
    const losesTo = rps.CHOICES.filter((o) => rps.BEATS[o].includes(c));
    assert.equal(losesTo.length, 2, c);
    for (const v of rps.BEATS[c]) assert.ok(rps.VERBS[`${c}>${v}`], `${c}>${v}`);
  }
  assert.equal(Object.keys(rps.VERBS).length, 10);
});

test("the user's rule table", () => {
  const win = (a, b) => resolveRoundOutcome({ A: a, B: b }).winningChoice;
  assert.equal(win("scissors", "paper"), "scissors");
  assert.equal(win("paper", "rock"), "paper");
  assert.equal(win("rock", "solder"), "rock");
  assert.equal(win("solder", "yanukovych"), "solder");
  assert.equal(win("yanukovych", "scissors"), "yanukovych");
  assert.equal(win("scissors", "solder"), "scissors");
  assert.equal(win("solder", "paper"), "solder");
  assert.equal(win("paper", "yanukovych"), "paper");
  assert.equal(win("yanukovych", "rock"), "yanukovych");
  assert.equal(win("rock", "scissors"), "rock");
});

test("an 8-player contest stays short", () => {
  let total = 0;
  const games = 2000;
  for (let g = 0; g < games; g++) {
    let alive = ["A", "B", "C", "D", "E", "F", "G", "H"];
    let rounds = 0;
    while (alive.length > 1 && rounds < 50) {
      rounds++;
      const o = resolveRoundOutcome(
        Object.fromEntries(alive.map((id) => [id, rps.CHOICES[Math.floor(Math.random() * rps.CHOICES.length)]]))
      );
      if (!o.replay) alive = o.continued;
    }
    total += rounds;
  }
  assert.ok(total / games < 5, `average ${total / games} rounds`);
});

test("everyone chooses the same option -> replay", () => {
  const o = resolveRoundOutcome({ A: "rock", B: "rock", C: "rock", D: "rock" });
  assert.equal(o.replay, true);
  assert.deepEqual(o.eliminated, []);
});

test("multiple players share the winning choice -> all continue", () => {
  const o = resolveRoundOutcome({ A: "rock", B: "rock", C: "rock", D: "scissors", E: "scissors", F: "scissors" });
  assert.equal(o.winningChoice, "rock");
  assert.deepEqual(o.continued.sort(), ["A", "B", "C"]);
  assert.deepEqual(o.eliminated.sort(), ["D", "E", "F"]);
});

test("all three RPS relationships resolve correctly", () => {
  assert.equal(resolveRoundOutcome({ A: "rock", B: "scissors" }).winningChoice, "rock");
  assert.equal(resolveRoundOutcome({ A: "scissors", B: "paper" }).winningChoice, "scissors");
  assert.equal(resolveRoundOutcome({ A: "paper", B: "rock" }).winningChoice, "paper");
});

test("pickLifeLoser: single eliminated -> that player", () => {
  assert.equal(pickLifeLoser(["B"], { B: 100 }, { B: true }), "B");
});

test("pickLifeLoser: a player who did not choose (auto-picked) forfeits first", () => {
  const loser = pickLifeLoser(["B", "C"], { B: 500, C: 0 }, { B: true, C: false });
  assert.equal(loser, "C");
});

test("pickLifeLoser: both chose -> the slower one loses", () => {
  const loser = pickLifeLoser(["B", "C"], { B: 800, C: 300 }, { B: true, C: true });
  assert.equal(loser, "B");
});

// ---- full contest via the lifecycle hooks (scripted single-step timer) ----

function harness(contestantIds) {
  const mg = { contestantIds: [...contestantIds] };
  rps.onStart(mg);
  let clock = 0;
  let pending = null; // {at, fn} — at most one (setTimer replaces)
  const ctx = {
    now: () => clock,
    emitAll: () => {},
    emitPlayer: () => {},
    setTimer: (fn, ms) => {
      pending = { at: clock + ms, fn };
    },
    scheduleResolve: () => {},
    resolveNow: () => {},
  };
  // fire exactly the one pending timer (a fired timer may schedule the next one)
  const tick = () => {
    if (!pending) return;
    const { at, fn } = pending;
    pending = null;
    clock = Math.max(clock, at);
    fn();
  };
  const choose = (id, choice) =>
    rps.onClientEvent(mg, id, "rps:choose", { choice }, ctx);
  return { mg, ctx, tick, choose };
}

test("full game: everyone plays until one remains, only the last-out loses a life", () => {
  const h = harness(["A", "B", "C", "D"]);
  rps.onSync(h.mg, 0, h.ctx); // pending: startRound after PREP
  h.tick(); // -> round 1 started

  // round 1: A,B rock ; C,D scissors -> rock wins, C & D eliminated
  h.choose("A", "rock");
  h.choose("B", "rock");
  h.choose("C", "scissors");
  h.choose("D", "scissors"); // all chose -> finishChoosing (sync), schedules reveal
  h.tick(); // reveal -> startRound(round 2)

  assert.deepEqual(h.mg.rps.alive.sort(), ["A", "B"]);

  // round 2: A paper, B rock -> paper wins, B eliminated, A is the winner
  h.choose("A", "paper");
  h.choose("B", "rock");
  h.tick(); // reveal -> decisive -> resolve

  assert.equal(h.mg.rps.phase, "done");
  assert.equal(h.mg.rps.winner, "A");
  assert.deepEqual(rps.resolveLosers(h.mg), ["B"]);

  const res = rps.buildResults(h.mg);
  assert.equal(res.winnerId, "A");
  assert.equal(res.lifeLoserId, "B");
});

test("eliminated players cannot submit further choices", () => {
  const h = harness(["A", "B", "C"]);
  rps.onSync(h.mg, 0, h.ctx);
  h.tick(); // round 1

  // round 1: A,B rock ; C scissors -> C eliminated, 2 remain (not decisive)
  h.choose("A", "rock");
  h.choose("B", "rock");
  h.choose("C", "scissors");
  h.tick(); // reveal -> startRound(round 2)
  assert.deepEqual(h.mg.rps.alive.sort(), ["A", "B"]);

  // C (eliminated) tries to keep playing -> ignored
  h.choose("C", "rock");
  assert.equal(h.mg.rps.choices.C, undefined);
});

test("intermediate eliminations remove no lives (resolveLosers returns exactly one)", () => {
  const h = harness(["A", "B", "C", "D", "E", "F"]);
  rps.onSync(h.mg, 0, h.ctx);
  h.tick(); // round 1

  // rock: A B C ; scissors: D E F -> D E F out
  ["A", "B", "C"].forEach((id) => h.choose(id, "rock"));
  ["D", "E", "F"].forEach((id) => h.choose(id, "scissors"));
  h.tick(); // reveal -> round 2
  assert.deepEqual(h.mg.rps.alive.sort(), ["A", "B", "C"]);

  // rock: A ; paper: B C -> paper wins, A out
  h.choose("A", "rock");
  h.choose("B", "paper");
  h.choose("C", "paper");
  h.tick(); // reveal -> round 3
  assert.deepEqual(h.mg.rps.alive.sort(), ["B", "C"]);

  // B rock, C scissors -> B wins, C out (decisive)
  h.choose("B", "rock");
  h.choose("C", "scissors");
  h.tick(); // reveal -> resolve

  const losers = rps.resolveLosers(h.mg);
  assert.equal(losers.length, 1, "exactly one life lost");
  assert.equal(losers[0], "C");
});

test("buildContest: only quiz-failers participate, and only when 2+ failed", () => {
  const players = [
    { id: "A", hasAnswered: true, lastAnswerIndex: 0 }, // wrong
    { id: "B", hasAnswered: true, lastAnswerIndex: 0 }, // wrong
    { id: "C", hasAnswered: true, lastAnswerIndex: 2 }, // correct
    { id: "D", hasAnswered: true, lastAnswerIndex: 2 }, // correct
  ];
  const c = rps.buildContest({ players, correctIndex: 2, roundIndex: 3 });
  assert.deepEqual(c.contestantIds.sort(), ["A", "B"]);

  // only 1 failed -> null
  const players1 = [
    { id: "A", hasAnswered: true, lastAnswerIndex: 0 },
    { id: "B", hasAnswered: true, lastAnswerIndex: 2 },
    { id: "C", hasAnswered: true, lastAnswerIndex: 2 },
  ];
  assert.equal(rps.buildContest({ players: players1, correctIndex: 2, roundIndex: 3 }), null);

  // 0 failed -> null
  const players0 = [
    { id: "A", hasAnswered: true, lastAnswerIndex: 2 },
    { id: "B", hasAnswered: true, lastAnswerIndex: 2 },
  ];
  assert.equal(rps.buildContest({ players: players0, correctIndex: 2, roundIndex: 3 }), null);
});

test("timeout: a player who never chooses is auto-assigned a random option", () => {
  const h = harness(["A", "B"]);
  rps.onSync(h.mg, 0, h.ctx);
  h.tick(); // round 1 started, CHOICE deadline pending

  h.choose("A", "rock");
  // B never chooses; fire the choice-deadline timer -> auto-pick for B
  h.tick();

  assert.ok(rps.CHOICES.includes(h.mg.rps.history[0].choices.B));
});
