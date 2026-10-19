process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const words = require("./hotBombWords");
const hotBomb = require("./hotBomb");

const D = (list) =>
  words.buildDictionary(list.map((w) => ({ word: w, category: "тест", accepted: true })));
const dict = D(["тигр", "рись", "сова", "антилопа", "кіт", "тюлень", "сом", "миша", "ґедзь", "лев", "вовк", "кит", "так", "рак", "коза", "аксолотль", "лелека", "єнот"]);

// ---------------------------------------------------------------- words

test("normalize: case, spaces, apostrophes, ґ, look-alike latin letters", () => {
  assert.equal(words.normalize("  КіТ  "), "кіт");
  assert.equal(words.normalize("в’юн"), "в'юн");
  assert.equal(words.normalize("ҐЕДЗЬ"), "гедзь");
  assert.equal(words.normalize("kit"), "кіт"); // latin k-i-t typed on the wrong layout
  assert.equal(words.normalize("рись!"), "рись");
});

test("validateAnimalWord: right word, wrong letter, repeat, empty, junk, unknown", () => {
  const used = new Set(["тигр"]);
  assert.equal(words.validateAnimalWord("Рись", "р", used, dict).ok, true);
  assert.equal(words.validateAnimalWord("  рись ", "Р", used, dict).ok, true);
  assert.equal(words.validateAnimalWord("сова", "р", used, dict).reason, "letter");
  assert.equal(words.validateAnimalWord("тигр", "т", used, dict).reason, "used");
  assert.equal(words.validateAnimalWord("", "р", used, dict).reason, "empty");
  assert.equal(words.validateAnimalWord("   ", "р", used, dict).reason, "empty");
  assert.equal(words.validateAnimalWord("123", "р", used, dict).reason, "chars");
  assert.equal(words.validateAnimalWord("р@сь", "р", used, dict).reason, "chars");
  assert.equal(words.validateAnimalWord("ракета", "р", used, dict).reason, "unknown");
  // ґ and г are the same letter for the chain and the lookup
  assert.equal(words.validateAnimalWord("гедзь", "ґ", used, dict).ok, true);
});

test("chainLetter: Ь, Й, И, apostrophe are skipped; rescue when a letter has nothing left", () => {
  assert.equal(words.chainLetter("рись", new Set(), dict), "с"); // Ь -> С
  assert.equal(words.chainLetter("аксолотль", new Set(), dict), "л"); // Ь -> Л
  assert.equal(words.chainLetter("тигр", new Set(), dict), "р");
  assert.equal(words.chainLetter("сова", new Set(), dict), "а");
  // nothing on «н» in this dictionary -> walk back: тюлень -> е (none) -> л
  assert.equal(words.chainLetter("тюлень", new Set(), dict), "л");
  // every «р» word used -> fall back past it
  assert.equal(words.chainLetter("тигр", new Set(["рись", "рак"]), dict), "г"); // р used up -> г (ґедзь)
});

test("chainLetter: a word with no usable letter gets a random letter that still has words", () => {
  const tiny = D(["аа", "бб"]);
  const l = words.chainLetter("ьй", new Set(), tiny, () => 0);
  assert.ok(["а", "б"].includes(l));
  assert.equal(words.chainLetter("аа", new Set(["аа", "бб"]), tiny), null);
});

test("the real dictionary is big, clean and has words for common letters", () => {
  words.setDictionary(null); // load the shipped files
  const real = words.dictionary();
  assert.ok(real.byKey.size >= 500, `only ${real.byKey.size} animals`);
  for (const key of real.byKey.keys()) {
    assert.match(key, /^[абвгдеєжзиіїйклмнопрстуфхцчшщьюя'-]+$/, key);
  }
  for (const l of "абвгджзклмнопрстфхчш") {
    assert.ok(words.availableCount(l, new Set(), real) > 0, `no animals on «${l}»`);
  }
  assert.equal(words.validateAnimalWord("рись", "р", new Set(), real).ok, true);
  assert.equal(words.validateAnimalWord("кіт", "к", new Set(), real).ok, true);
});

// ---------------------------------------------------------------- the game

function harness(ids, opts = {}) {
  words.setDictionary(null);
  const mg = { contestantIds: [...ids] };
  hotBomb.onStart(mg);
  let clock = 0;
  let pending = null;
  const sent = [];
  const toPlayer = [];
  let resolved = 0;
  const ctx = {
    now: () => clock,
    emitAll: (ev, d) => sent.push([ev, d]),
    emitPlayer: (id, ev, d) => toPlayer.push([id, ev, d]),
    setTimer: (fn, ms) => {
      pending = { at: clock + ms, fn };
    },
    resolveNow: () => {
      resolved += 1;
    },
  };
  const advance = (ms) => {
    const until = clock + ms;
    while (pending && pending.at <= until) {
      const p = pending;
      pending = null;
      clock = Math.max(clock, p.at);
      p.fn();
    }
    clock = until;
  };
  const s = () => mg.hb;
  const word = (id, text, seq = s().seq) => hotBomb.onClientEvent(mg, id, "hb:word", { seq, text }, ctx);
  const target = (id, targetId, seq = s().seq) => hotBomb.onClientEvent(mg, id, "hb:target", { seq, targetId }, ctx);
  hotBomb.onSync(mg, 0, ctx);
  if (!opts.noStart) advance(hotBomb.CONFIG.PREP_MS);
  return { mg, ctx, advance, s, word, target, sent, toPlayer, get resolved() { return resolved; }, now: () => clock };
}

/** An animal that is valid right now (not used, right letter). */
function validWord(h) {
  const real = words.dictionary();
  const list = real.byFirst.get(h.s().letter) || [];
  return list.find((k) => !h.s().used.has(k));
}

test("buildContest: all living players play when someone was wrong; nobody wrong -> no game", () => {
  const players = [
    { id: "A", hasAnswered: true, lastAnswerIndex: 1 },
    { id: "B", hasAnswered: true, lastAnswerIndex: 2 },
    { id: "C", hasAnswered: false },
  ];
  assert.deepEqual(hotBomb.buildContest({ players, correctIndex: 2, roundIndex: 4 }).contestantIds, ["A", "B", "C"]);
  const allRight = players.map((p) => ({ ...p, hasAnswered: true, lastAnswerIndex: 2 }));
  assert.equal(hotBomb.buildContest({ players: allRight, correctIndex: 2, roundIndex: 4 }), null);
});

test("no moves count during the countdown", () => {
  const h = harness(["A", "B", "C"], { noStart: true });
  assert.equal(h.s().phase, "prep");
  h.word("A", "кіт", 0);
  assert.equal(h.s().chain.length, 0);
  h.advance(hotBomb.CONFIG.PREP_MS);
  assert.equal(h.s().phase, "live");
  assert.ok(h.s().holder);
  assert.equal(h.s().chain.length, 1); // the start word
});

test("a right word passes the bomb at once to the next player round the circle, re-rolls fuse and letter", () => {
  const h = harness(["A", "B", "C"]);
  const ring = ["A", "B", "C"];
  const holder = h.s().holder;
  const next = ring[(ring.indexOf(holder) + 1) % ring.length];
  const seq = h.s().seq;
  const w = validWord(h);
  h.word(holder, w.toUpperCase() + "  ");
  assert.equal(h.s().holder, next, "no waiting for a pick");
  assert.equal(h.s().seq, seq + 1);
  assert.equal(h.s().awaitingTarget, false);
  assert.ok(h.s().used.has(w));
  assert.ok(h.s().fuseEndsAt - h.now() >= hotBomb.CONFIG.FUSE_MIN_MS);
  assert.ok(h.s().fuseEndsAt - h.now() <= hotBomb.CONFIG.FUSE_MAX_MS);
});

test("a pre-picked target gets the bomb straight after a right word", () => {
  const h = harness(["A", "B", "C"]);
  const holder = h.s().holder;
  const other = ["A", "B", "C"].find((x) => x !== holder);
  h.target(holder, other);
  h.word(holder, validWord(h));
  assert.equal(h.s().holder, other);
});

test("a player waiting for the bomb can pick the next target in advance", () => {
  const h = harness(["A", "B", "C"]);
  const holder = h.s().holder;
  const [next, third] = ["A", "B", "C"].filter((x) => x !== holder);
  h.target(next, third); // not holding yet: remembered
  h.target(holder, next);
  h.word(holder, validWord(h)); // -> next gets the bomb
  assert.equal(h.s().holder, next);
  h.word(next, validWord(h)); // the remembered pick passes it straight on
  assert.equal(h.s().holder, third);
  assert.equal(h.s().target[next], undefined); // used once
});

test("wrong / repeated / foreign words keep the bomb, the fuse keeps burning", () => {
  const h = harness(["A", "B"]);
  const holder = h.s().holder;
  const fuse = h.s().fuseEndsAt;
  h.word(holder, `${h.s().letter}ракадабра`); // right letter, not an animal
  h.advance(400);
  const taken = validWord(h);
  h.s().used.add(taken); // as if someone already said it
  h.word(holder, taken);
  h.advance(400);
  h.word(holder, "");
  assert.equal(h.s().holder, holder);
  assert.equal(h.s().fuseEndsAt, fuse);
  const rejects = h.toPlayer.filter(([, ev]) => ev === "hb:reject").map(([, , d]) => d.reason);
  assert.deepEqual(rejects, ["unknown", "used", "empty"]);
});

test("flood guard: attempts closer than MIN_WORD_GAP_MS are ignored", () => {
  const h = harness(["A", "B"]);
  const holder = h.s().holder;
  h.word(holder, "ззз");
  h.word(holder, "ззз");
  h.word(holder, "ззз");
  assert.equal(h.toPlayer.filter(([, ev]) => ev === "hb:reject").length, 1);
});

test("only the holder may answer; a pick of yourself / an unknown player is ignored", () => {
  const h = harness(["A", "B", "C"]);
  const ring = ["A", "B", "C"];
  const holder = h.s().holder;
  const others = ring.filter((x) => x !== holder);
  h.word(others[0], validWord(h));
  assert.equal(h.s().chain.length, 1);
  h.target(holder, holder);
  h.target(holder, "ZZZ");
  const far = ring[(ring.indexOf(holder) + 2) % ring.length]; // not the next one
  h.target(holder, far);
  h.word(holder, validWord(h));
  assert.equal(h.s().holder, far, "the pick wins over the circle order");
});

test("explosion: holder loses exactly one life, is out, the bomb restarts elsewhere", () => {
  const h = harness(["A", "B", "C"]);
  const victim = h.s().holder;
  h.advance(h.s().fuseEndsAt - h.now() + 1); // right after the fuse burns out
  assert.equal(h.s().phase, "boom");
  assert.deepEqual(h.s().out, [victim]);
  h.advance(hotBomb.CONFIG.BOOM_PAUSE_MS + 1);
  assert.equal(h.s().phase, "live");
  assert.notEqual(h.s().holder, victim);
  assert.deepEqual(hotBomb.resolveLosers(h.mg), [victim]);
});

test("a word arriving for an exploded bomb (stale seq) is ignored; repeated events can't act twice", () => {
  const h = harness(["A", "B", "C"]);
  const victim = h.s().holder;
  const seq = h.s().seq;
  const w = validWord(h);
  h.advance(h.s().fuseEndsAt - h.now() + 1); // boom
  h.word(victim, w, seq);
  assert.ok(!h.s().used.has(w));
  h.advance(hotBomb.CONFIG.BOOM_PAUSE_MS + 1);
  const holder = h.s().holder;
  const other = ["A", "B", "C"].find((x) => x !== holder && x !== victim);
  const w2 = validWord(h);
  const s2 = h.s().seq;
  h.word(holder, w2, s2);
  h.target(holder, other, s2);
  h.target(holder, other, s2); // resent
  assert.equal(h.s().holder, other);
  assert.equal(h.s().seq, s2 + 1);
  assert.equal(h.s().out.length, 1);
});

test("with two players the first explosion ends the round", () => {
  const h = harness(["A", "B"]);
  h.advance(h.s().fuseEndsAt - h.now() + 1);
  h.advance(hotBomb.CONFIG.BOOM_PAUSE_MS + 1);
  assert.equal(h.s().phase, "done");
  assert.equal(h.resolved, 1);
  assert.equal(hotBomb.resolveLosers(h.mg).length, 1);
});

test("round clock: nobody blew up -> the bomb goes off in the holder's hands at the end", () => {
  const h = harness(["A", "B", "C", "D"]);
  // keep passing fast so the fuse never blows
  const until = hotBomb.CONFIG.PLAY_MS + 2000;
  for (let t = 0; t < until && h.s().phase === "live"; t += 1000) {
    const holder = h.s().holder;
    const next = h.s().contestantIds?.[0];
    void next;
    const w = validWord(h);
    if (w) {
      h.word(holder, w);
      const to = ["A", "B", "C", "D"].find((x) => x !== holder);
      h.target(holder, to);
    }
    h.advance(1000);
  }
  // the round-end explosion plays its scene first, then the round resolves
  for (let k = 0; k < 10 && h.s().phase !== "done"; k++) h.advance(1000);
  assert.equal(h.s().phase, "done");
  assert.equal(h.resolved, 1);
  assert.equal(h.s().explosions.length, 1);
  assert.deepEqual(hotBomb.resolveLosers(h.mg), [h.s().explosions[0].id]);
  h.advance(60000);
  assert.equal(h.resolved, 1);
});

test("round clock: after an earlier explosion the round just ends, no extra one", () => {
  const h = harness(["A", "B", "C", "D"]);
  h.advance(hotBomb.CONFIG.FUSE_MAX_MS + 10); // first holder never answers -> boom
  assert.equal(h.s().explosions.length, 1);
  const until = hotBomb.CONFIG.PLAY_MS + 2000;
  for (let t = 0; t < until && h.s().phase !== "done"; t += 1000) {
    if (h.s().phase === "live") {
      const holder = h.s().holder;
      const w = validWord(h);
      if (w) {
        h.word(holder, w);
        h.target(holder, ["A", "B", "C", "D"].find((x) => x !== holder && !h.s().out.includes(x)));
      }
    }
    h.advance(1000);
  }
  assert.equal(h.s().phase, "done");
  assert.equal(h.resolved, 1);
  assert.equal(h.s().explosions.length, 1);
});

test("the holder leaving hands the bomb on, no life lost; fewer than 2 left ends the round", () => {
  const h = harness(["A", "B", "C"]);
  const holder = h.s().holder;
  hotBomb.onPlayerLeft(h.mg, holder, h.ctx);
  assert.notEqual(h.s().holder, holder);
  assert.equal(h.s().phase, "live");
  assert.deepEqual(hotBomb.resolveLosers(h.mg), []);
  const next = h.s().holder;
  hotBomb.onPlayerLeft(h.mg, next, h.ctx);
  assert.equal(h.s().phase, "done");
  assert.equal(h.resolved, 1);
});

test("the fuse moment is never sent to the clients", () => {
  const h = harness(["A", "B"]);
  for (const [, d] of h.sent) assert.equal(d?.fuseEndsAt, undefined);
});
