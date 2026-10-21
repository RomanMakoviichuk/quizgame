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
 *   perfectSecond — 1+ player wrong, everyone plays (stop the clock at 10.00 s)
 *   tapeMeasure — 1+ player wrong, everyone plays (pull the tape to N cm)
 *
 * Candidates — a minigame NEVER repeats within a game: only the ones not played
 * yet, in random order. From RARE_FROM_ROUND on, a RARE minigame still unplayed
 * goes first, so a narrow trigger (e.g. «Перетягни канат» on an even count) gets
 * its chance before the game ends. If none of the unplayed ones can run this
 * round — or every one has been played — there is no minigame this round.
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
const perfectSecond = require("./perfectSecond");
const tapeMeasure = require("./tapeMeasure");

const MINIGAMES = [trueFalse, mathRush, rps, hotBomb, tugOfWar, rat, memory, tune, perfectSecond, tapeMeasure];

const REGISTRY = Object.fromEntries(MINIGAMES.map((def) => [def.ID, def]));

function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const RARE_FROM_ROUND = 5;

function selectForRound(roundIndex, history = [], rng = Math.random) {
  // Dev/demo only: MINIGAME_DEMO=rps runs that minigame after every round.
  const forced = REGISTRY[process.env.MINIGAME_DEMO];
  if (forced) return forced === mathRush ? [mathRush] : [forced, mathRush];

  const played = new Set(history);
  const fresh = shuffle(MINIGAMES.filter((def) => !played.has(def.ID)), rng);
  if ((Number(roundIndex) || 1) < RARE_FROM_ROUND) return fresh;
  return [...fresh.filter((def) => def.RARE), ...fresh.filter((def) => !def.RARE)];
}

function get(id) {
  return REGISTRY[id] || null;
}

module.exports = { REGISTRY, MINIGAMES, selectForRound, get };
