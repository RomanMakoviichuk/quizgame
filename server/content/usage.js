/**
 * "Already played" log — so quiz questions, «Правда/Брехня» statements and
 * «Вгадай мелодію» songs don't repeat between games.
 *
 * Every kind of content ("trueFalse", "tune", "quiz:<category>:<difficulty>")
 * keeps the ids it has used in the current cycle. New games draw unused ids
 * first; once every id of a kind has been used, its cycle starts over (logged).
 * Stored in server/content/usage.json (runtime state, survives restarts).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// under `node --test` nothing is read or written, and nothing is logged
const IN_TESTS = !!process.env.NODE_TEST_CONTEXT;
const FILE = IN_TESTS ? null : process.env.USAGE_FILE || path.join(__dirname, "usage.json");

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createUsage(file = FILE, { log = IN_TESTS ? () => {} : console.log } = {}) {
  let data = null;

  function load() {
    if (data) return data;
    try {
      data = file ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    } catch {
      data = {};
    }
    return data;
  }

  function save() {
    if (!file) return;
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tmp, file);
    } catch (e) {
      log(`[usage] could not save ${file}: ${e.message}`);
    }
  }

  function entry(kind) {
    const d = load();
    if (!d[kind]) d[kind] = { cycle: 1, used: [] };
    return d[kind];
  }

  /** Ids of `kind` already used in its current cycle. */
  function usedSet(kind) {
    return new Set(entry(kind).used);
  }

  /**
   * Record ids as used. `allIds` is the whole current set of that kind: when
   * all of them are used, the cycle starts over.
   */
  function mark(kind, ids, allIds) {
    const e = entry(kind);
    const used = new Set(e.used);
    for (const id of ids) used.add(id);
    const all = new Set(allIds);
    const left = [...all].filter((id) => !used.has(id)).length;
    if (all.size > 0 && left === 0) {
      e.cycle += 1;
      // the ones just played open the new cycle as used, so the next game doesn't replay them
      e.used = all.size > ids.length ? ids.filter((id) => all.has(id)) : [];
      log(`[usage] ${kind}: all ${all.size} played — cycle ${e.cycle} starts over`);
    } else {
      e.used = [...used].filter((id) => all.has(id)); // forget ids that no longer exist
      log(`[usage] ${kind}: +${ids.length}, ${left} of ${all.size} still new (cycle ${e.cycle})`);
    }
    e.updatedAt = new Date().toISOString();
    save();
  }

  /**
   * `count` items, unused ones first (random order). If fewer unused remain,
   * they all go first and the rest is filled from the used ones.
   * With `record` (default) the picked ids are marked as used.
   */
  function draw(kind, items, count, { idOf = (x) => x.id, record = true } = {}) {
    const used = usedSet(kind);
    const fresh = shuffle(items.filter((x) => !used.has(idOf(x))));
    const old = shuffle(items.filter((x) => used.has(idOf(x))));
    const picked = [...fresh, ...old].slice(0, count);
    if (record) {
      const allIds = items.map(idOf);
      const takenFresh = picked.filter((x) => !used.has(idOf(x))).map(idOf);
      const takenOld = picked.filter((x) => used.has(idOf(x))).map(idOf);
      // the last new ones close the cycle; the repeats then count for the next one
      mark(kind, takenFresh, allIds);
      if (takenOld.length) mark(kind, takenOld, allIds);
    }
    return picked;
  }

  return { draw, mark, usedSet, shuffle, file };
}

const defaultUsage = createUsage();
module.exports = defaultUsage;
module.exports.createUsage = createUsage;
