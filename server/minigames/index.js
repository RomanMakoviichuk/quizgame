/**
 * Minigame registry.
 *
 * `selectForRound(roundIndex, history)` returns an ordered list of candidate
 * minigames for the round that just ended. phases.js runs the first one whose
 * `buildContest()` returns a contest (i.e. whose trigger condition is met) and
 * records its id in `room.minigameHistory`; if none match, no minigame runs.
 *
 * Trigger conditions:
 *   trueFalse — 2+ players wrong
 *   rps       — 2+ players wrong
 *   hotBomb   — 1+ player wrong, everyone alive plays
 *   tugOfWar  — 2/4/6/8 players wrong (two equal teams)          RARE
 *   rat       — 2+ players wrong (secret vote among them)
 *   memory    — 2+ players wrong (remember the coloured row)
 *   tune      — 1+ player wrong, every living player plays (5 song rounds)
 *   mathRush  — 1+ player wrong
 *
 * Candidates — a minigame NEVER repeats while there are unplayed ones:
 *   1. RARE minigames not played yet — a narrow trigger gets its chance the
 *      first time it holds (e.g. «Перетягни канат» on an even count);
 *   2. every other minigame not played yet, in random order.
 * If none of the unplayed ones can run this round, there is no minigame this
 * round (rather than a repeat). Only once every minigame has been played does
 * a new cycle start (random, never the previous round's minigame).
 *
 * Adding a minigame: require it and put it in MINIGAMES. Export `RARE = true`
 * when its trigger is narrow and it should jump the queue while unplayed.
 */
const trueFalse = require("./trueFalse");
const mathRush = require("./mathRush");
const rps = require("./rps");
const hotBomb = require("./hotBomb");
const tugOfWar = require("./tugOfWar");
const rat = require("./rat");
const memory = require("./memory");
const tune = require("./nameThatTune");

const MINIGAMES = [trueFalse, mathRush, rps, hotBomb, tugOfWar, rat, memory, tune];

const REGISTRY = Object.fromEntries(MINIGAMES.map((def) => [def.ID, def]));

function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function selectForRound(roundIndex, history = [], rng = Math.random) {
  // Dev/demo only: MINIGAME_DEMO=rps runs that minigame after every round.
  const forced = REGISTRY[process.env.MINIGAME_DEMO];
  if (forced) return forced === mathRush ? [mathRush] : [forced, mathRush];

  // the current cycle: what has been played since the last time all of them ran
  const cycle = history.slice(Math.floor(history.length / MINIGAMES.length) * MINIGAMES.length);
  const inCycle = new Set(cycle);
  const fresh = MINIGAMES.filter((def) => !inCycle.has(def.ID));
  if (fresh.length === MINIGAMES.length && history.length) {
    // a new cycle: everything again in random order, except the previous round's minigame
    const last = history[history.length - 1];
    return shuffle(MINIGAMES.filter((d) => d.ID !== last), rng);
  }
  const rare = fresh.filter((def) => def.RARE);
  const rest = shuffle(fresh.filter((def) => !def.RARE), rng);
  return [...shuffle(rare, rng), ...rest];
}

function get(id) {
  return REGISTRY[id] || null;
}

module.exports = { REGISTRY, MINIGAMES, selectForRound, get };
