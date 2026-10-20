/**
 * Round video pools: folder listing, result kind, random pick without repeats.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const media = require("./media");

function tempPools(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quizgame-rounds-"));
  for (const rel of Object.values(media.POOLS)) fs.mkdirSync(path.join(dir, rel), { recursive: true });
  for (const [rel, names] of Object.entries(files)) {
    for (const n of names) fs.writeFileSync(path.join(dir, rel, n), "x");
  }
  return dir;
}

test("resultKind: all right / some right / none right", () => {
  assert.equal(media.resultKind([{ lastCorrect: true }, { lastCorrect: true }]), "allCorrect");
  assert.equal(media.resultKind([{ lastCorrect: true }, { lastCorrect: false }]), "partial");
  assert.equal(media.resultKind([{ lastCorrect: false }, { lastCorrect: false }]), "allWrong");
  assert.equal(media.resultKind([]), "allWrong");
});

test("listPool: only video files, natural order, URL-encoded", (t) => {
  const dir = tempPools({ "after-round": ["after-round_10.mp4", "after-round_2.mp4", "notes.txt", "x y.webm"] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(media.listPool("afterRound", dir), [
    "/assets/rounds/after-round/after-round_2.mp4",
    "/assets/rounds/after-round/after-round_10.mp4",
    "/assets/rounds/after-round/x%20y.webm",
  ]);
  assert.deepEqual(media.listPool("nope", dir), []);
});

test("roundVideos: right folder by result, new files picked up, no immediate repeats", (t) => {
  const dir = tempPools({
    "after-round": ["a1.mp4", "a2.mp4"],
    "results/all-correct": ["c1.mp4"],
    "results/partial": ["p1.mp4", "p2.mp4", "p3.mp4"],
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const room = {};
  const partial = [{ lastCorrect: true }, { lastCorrect: false }];

  let prev = null;
  for (let i = 0; i < 30; i++) {
    const v = media.roundVideos(room, partial, dir);
    assert.equal(v.kind, "partial");
    assert.match(v.afterResult, /results\/partial\/p\d\.mp4$/);
    assert.notEqual(v.afterResult, prev);
    prev = v.afterResult;
  }

  const all = media.roundVideos(room, [{ lastCorrect: true }], dir);
  assert.match(all.afterResult, /all-correct\/c1\.mp4$/);

  // empty folder -> old score clip; a file dropped in later is used right away
  const none = media.roundVideos(room, [{ lastCorrect: false }], dir);
  assert.equal(none.afterResult, "/assets/rounds/results/fallback/score.mp4");
  fs.writeFileSync(path.join(dir, "results/all-wrong", "w1.mp4"), "x");
  assert.match(media.roundVideos(room, [{ lastCorrect: false }], dir).afterResult, /all-wrong\/w1\.mp4$/);
});

test("dealFrom: every clip once before any repeat, no repeat across bag boundaries", () => {
  const list = ["a", "b", "c", "d", "e", "f"];
  const state = {};
  const seq = Array.from({ length: 60 }, () => media.dealFrom(state, list));
  for (let i = 0; i < 60; i += 6) {
    assert.deepEqual(seq.slice(i, i + 6).sort(), list, `bag ${i / 6} has every clip once`);
  }
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1]);
  assert.equal(media.dealFrom({}, []), null);
});

test("dealFrom: clips added or removed mid-game are respected", () => {
  const state = {};
  media.dealFrom(state, ["a", "b", "c"]);
  // "b" deleted from the folder: never dealt again
  const next = [media.dealFrom(state, ["a", "c"]), media.dealFrom(state, ["a", "c"])];
  assert.ok(!next.includes("b"));
  // a new clip shows up in the next bag
  const later = Array.from({ length: 4 }, () => media.dealFrom(state, ["a", "c", "z"]));
  assert.ok(later.includes("z"));
});

test("the real folders are in place", () => {
  for (const pool of Object.keys(media.POOLS)) {
    assert.ok(media.listPool(pool).length >= 1, `${pool} has clips`);
  }
});

test("announceVideo: per-round folder, clips in turn across games, once per room", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quizgame-announce-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "round-1"));
  for (const f of ["2.mp4", "10.mp4", "1.mp4", "notes.txt"]) fs.writeFileSync(path.join(dir, "round-1", f), "x");
  const opts = { dir, stateFile: path.join(dir, "state.json") };
  assert.deepEqual(media.listAnnounce(1, dir), ["1.mp4", "2.mp4", "10.mp4"]);

  const game = () => ({});
  const played = [1, 2, 3, 4].map(() => media.announceVideo(game(), 1, opts));
  assert.deepEqual(played, [
    "/assets/rounds/announce/round-1/1.mp4",
    "/assets/rounds/announce/round-1/2.mp4",
    "/assets/rounds/announce/round-1/10.mp4",
    "/assets/rounds/announce/round-1/1.mp4",
  ]);

  // the same game asking again (a resent announce) gets the same clip, no skip
  const room = game();
  const a = media.announceVideo(room, 1, opts);
  assert.equal(media.announceVideo(room, 1, opts), a);
  assert.equal(media.announceVideo(game(), 1, opts), "/assets/rounds/announce/round-1/10.mp4");

  // no folder for the round -> no clip
  assert.equal(media.announceVideo(game(), 7, opts), null);
});

test("questionVideo: random from question/, no repeats in a game until all played", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quizgame-questions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(media.questionVideo({}, 1, dir), null); // no folder -> none
  fs.mkdirSync(path.join(dir, "question"));
  for (const f of ["a.mp4", "b.mp4", "c.mp4", "readme.txt"]) fs.writeFileSync(path.join(dir, "question", f), "x");
  assert.equal(media.listQuestionVideos(dir).length, 3);

  const room = {};
  const firstThree = [1, 2, 3].map((r) => media.questionVideo(room, r, dir));
  assert.equal(new Set(firstThree).size, 3);
  assert.ok(firstThree.every((u) => u.startsWith("/assets/rounds/question/")));
  assert.equal(media.questionVideo(room, 2, dir), firstThree[1]); // same round asked again -> same clip
  assert.notEqual(media.questionVideo(room, 4, dir), firstThree[2]); // a new bag never repeats the last one
});
