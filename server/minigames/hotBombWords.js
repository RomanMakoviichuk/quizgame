/**
 * «Гаряча бомба» — the animal-word chain rules (pure, unit-tested).
 *
 * Dictionary: server/data/ukrainianAnimals.json (checked list, see the
 * README in that folder) + optional server/data/ukrainianAnimals.custom.json
 * for words an admin adds later. Unknown words players type are never
 * accepted; they are collected (see `noteUnknown`) so they can be reviewed.
 *
 * Chain letter rule (`chainLetter`): the next word starts with the LAST
 * SIGNIFICANT letter of the previous one, scanning from the end and skipping
 *   - Ь and the apostrophe (no sound of their own):      рись -> С
 *   - Й, И (no Ukrainian animal names start with them):  кий -> К, гупі -> І
 *   - any letter that has no unused animal left (rescue rule, so a round
 *     never stalls):                                   ...ґ -> previous letter
 * If no letter of the word has words left, a random letter that still has
 * unused words is chosen.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const MAIN_FILE = path.join(DATA_DIR, "ukrainianAnimals.json");
const CUSTOM_FILE = path.join(DATA_DIR, "ukrainianAnimals.custom.json");
const SUGGESTIONS_FILE = path.join(DATA_DIR, "animal-suggestions.txt");

const SKIP_LETTERS = new Set(["ь", "'", "й", "и", "ъ"]);
const UA_LETTERS = /^[абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'-]+$/;
// Latin / Russian look-alikes typed on the wrong keyboard layout
const LOOKALIKE = {
  a: "а", e: "е", i: "і", o: "о", p: "р", c: "с", x: "х", y: "у", k: "к", m: "м", t: "т", h: "н", b: "в",
  ё: "е", ы: "и", э: "е",
};

/**
 * Canonical form used for comparisons: lower case, trimmed, one apostrophe
 * kind, look-alike letters fixed, ґ folded into г (so «гедзь» = «ґедзь»).
 */
function normalize(raw) {
  let s = String(raw ?? "")
    .toLowerCase()
    .normalize("NFC")
    .trim()
    .replace(/[’ʼ`´‘ʹ]/g, "'")
    .replace(/\s+/g, " ");
  s = s.replace(/[a-zёыэ]/g, (ch) => LOOKALIKE[ch] ?? ch);
  return s.replace(/ґ/g, "г").replace(/[.!?,;:]+$/g, "");
}

function loadList(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Build the lookup from entries [{ word, category, accepted }]. */
function buildDictionary(entries) {
  const byKey = new Map(); // normalized -> { word, category }
  for (const e of entries) {
    if (!e || e.accepted === false) continue;
    const key = normalize(e.word);
    if (!key || !UA_LETTERS.test(key) || byKey.has(key)) continue;
    byKey.set(key, { word: String(e.word).toLowerCase(), category: e.category || "тварина" });
  }
  const byFirst = new Map(); // first letter -> [keys]
  for (const key of byKey.keys()) {
    const f = key[0];
    if (!byFirst.has(f)) byFirst.set(f, []);
    byFirst.get(f).push(key);
  }
  return { byKey, byFirst };
}

let DICT = null;
function dictionary() {
  if (!DICT) DICT = buildDictionary([...loadList(MAIN_FILE), ...loadList(CUSTOM_FILE)]);
  return DICT;
}
/** Tests / admin reload. */
function setDictionary(entries) {
  DICT = entries ? buildDictionary(entries) : null;
}

const usedHas = (used, key) => (used instanceof Set ? used.has(key) : (used || []).includes(key));

/** How many unused animals start with this letter. */
function availableCount(letter, used, dict = dictionary()) {
  const list = dict.byFirst.get(normalize(letter)) || [];
  let n = 0;
  for (const k of list) if (!usedHas(used, k)) n += 1;
  return n;
}

/** The letter the next word must start with (see the header). */
function chainLetter(word, used = new Set(), dict = dictionary(), rand = Math.random) {
  const key = normalize(word);
  for (let i = key.length - 1; i >= 0; i--) {
    const ch = key[i];
    if (SKIP_LETTERS.has(ch) || ch === "-" || ch === " ") continue;
    if (availableCount(ch, used, dict) > 0) return ch;
  }
  const letters = [...dict.byFirst.keys()].filter((l) => availableCount(l, used, dict) > 0);
  if (!letters.length) return null;
  return letters[Math.floor(rand() * letters.length)];
}

/**
 * validateAnimalWord(word, requiredLetter, usedWords)
 *   -> { ok: true, key, word, category }
 *   -> { ok: false, reason, message }
 * reason: empty | chars | letter | used | unknown
 */
function validateAnimalWord(word, requiredLetter, usedWords, dict = dictionary()) {
  const key = normalize(word);
  if (!key) return { ok: false, reason: "empty", message: "Напиши назву тварини" };
  if (!UA_LETTERS.test(key) || key.length < 2) {
    return { ok: false, reason: "chars", message: "Тільки українські літери" };
  }
  const need = normalize(requiredLetter);
  if (need && key[0] !== need) {
    return { ok: false, reason: "letter", message: `Треба на літеру «${need.toUpperCase()}»` };
  }
  if (usedHas(usedWords, key)) return { ok: false, reason: "used", message: "Це слово вже було" };
  const entry = dict.byKey.get(key);
  if (!entry) return { ok: false, reason: "unknown", message: "Такої тварини немає в словнику" };
  return { ok: true, key, word: entry.word, category: entry.category };
}

/** A random start word whose chain letter still has plenty of options. */
function randomStartWord(used = new Set(), dict = dictionary(), rand = Math.random) {
  const keys = [...dict.byKey.keys()].filter((k) => !usedHas(used, k));
  if (!keys.length) return null;
  for (let tries = 0; tries < 40; tries++) {
    const k = keys[Math.floor(rand() * keys.length)];
    const l = chainLetter(k, new Set([...(used instanceof Set ? used : used || []), k]), dict, rand);
    if (l && availableCount(l, used, dict) >= 5) return { key: k, word: dict.byKey.get(k).word };
  }
  const k = keys[Math.floor(rand() * keys.length)];
  return { key: k, word: dict.byKey.get(k).word };
}

// Unknown words typed by players — written once per word for a human to review.
const noted = new Set();
function noteUnknown(word) {
  const key = normalize(word);
  if (!key || noted.has(key) || !UA_LETTERS.test(key) || key.length < 3 || noted.size > 2000) return;
  noted.add(key);
  if (process.env.NODE_ENV === "test") return;
  fs.appendFile(SUGGESTIONS_FILE, `${key}\n`, () => {});
}

module.exports = {
  normalize,
  buildDictionary,
  setDictionary,
  dictionary,
  availableCount,
  chainLetter,
  validateAnimalWord,
  randomStartWord,
  noteUnknown,
  SKIP_LETTERS,
};
