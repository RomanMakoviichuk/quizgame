/**
 * Minigame registry.
 *
 * `selectForRound(roundIndex)` returns an ordered list of candidate minigames
 * for the round that just ended. phases.js runs the first one whose
 * `buildContest()` returns a contest (i.e. whose trigger condition is met);
 * if none match, no minigame runs that round.
 *
 * Trigger conditions:
 *   trueFalse — 2+ players wrong
 *   rps       — 2+ players wrong
 *   mathRush  — 1+ player wrong  (broad fallback: covers the "exactly 1 wrong" case)
 *
 * The primary minigame rotates round to round; mathRush is appended as the
 * fallback so a minigame always runs whenever at least one player was wrong.
 */
const trueFalse = require("./trueFalse");
const mathRush = require("./mathRush");
const rps = require("./rps");

const REGISTRY = {
  [trueFalse.ID]: trueFalse,
  [mathRush.ID]: mathRush,
  [rps.ID]: rps,
};

const ROTATION = [trueFalse, mathRush, rps];

function selectForRound(roundIndex) {
  const primary = ROTATION[(Math.max(1, roundIndex) - 1) % ROTATION.length];
  if (primary === mathRush) return [mathRush];
  return [primary, mathRush];
}

function get(id) {
  return REGISTRY[id] || null;
}

module.exports = { REGISTRY, ROTATION, selectForRound, get };
