/**
 * Small shared helpers for the content store: id/slug/date + validation-free
 * normalisers. No I/O here.
 */
const crypto = require("crypto");
const { QUESTION_DIFFICULTIES } = require("../config");

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

// Cyrillic (uk) -> latin, for readable slugs.
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
  з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", "'": "", "’": "",
};

function makeSlug(input) {
  const s = String(input || "").trim().toLowerCase();
  let out = "";
  for (const ch of s) {
    if (TRANSLIT[ch] != null) out += TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "-";
  }
  out = out.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return out || "category";
}

function normalizeDifficulty(d) {
  if (d == null || d === "") return null;
  const s = String(d).trim().toLowerCase();
  return QUESTION_DIFFICULTIES.includes(s) ? s : null;
}

/** Fisher–Yates using crypto for unbiased shuffling. */
function cryptoShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { newId, nowIso, makeSlug, normalizeDifficulty, cryptoShuffle };
