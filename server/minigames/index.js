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
 * Order of the candidates (no repeats until every minigame has been played):
 *   1. RARE minigames not played yet — a narrow trigger gets its chance the
 *      first time it holds (e.g. «Перетягни канат» on an even count);
 *   2. every other minigame not played yet, in random order;
 *   3. the played ones, least recently played first, the previous round's
 *      minigame last — only reached when nothing new can run (more rounds than
 *      minigames, or the unplayed ones need more wrong players).
 * Every minigame is always in the list, so one runs whenever any can.
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

  const lastPlayed = new Map(); // id -> position of its latest run in history
  history.forEach((id, i) => lastPlayed.set(id, i));

  const fresh = MINIGAMES.filter((def) => !lastPlayed.has(def.ID));
  const rare = fresh.filter((def) => def.RARE);
  const rest = shuffle(fresh.filter((def) => !def.RARE), rng);
  const played = MINIGAMES.filter((def) => lastPlayed.has(def.ID)).sort(
    (a, b) => lastPlayed.get(a.ID) - lastPlayed.get(b.ID)
  );
  return [...shuffle(rare, rng), ...rest, ...played];
}

function get(id) {
  return REGISTRY[id] || null;
}

module.exports = { REGISTRY, MINIGAMES, selectForRound, get };
