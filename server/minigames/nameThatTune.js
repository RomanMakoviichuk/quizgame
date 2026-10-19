/**
 * «Вгадай мелодію» (id: tune) — 5 rounds of "name the song", speed scoring.
 *
 * Trigger: at least one player got the quiz question wrong; every living
 * player plays (it's a speed contest, the bottom of the table loses lives).
 *
 * Catalogue: every .mp3/.ogg/.wav/.m4a in client/public/assets/minigames/
 * Name That Tune/songs, read when a game starts (drop a file in — no restart).
 * Titles come from server/data/tunes.json when the file is listed there,
 * otherwise from the file name "Artist - Title.ext". Fewer than 5 songs or
 * fewer than 4 different titles -> the game doesn't start (logged).
 *
 * Fairness / anti-cheat:
 *   - the song set, the 4 options of each round (same order for everybody) and
 *     the right answer are decided on the server once, in onStart;
 *   - the audio is played by the TV only, from /tune/<random token>: the URL
 *     says nothing about the song (the original folder isn't served at all);
 *   - phones get the options without the answer; the answer is revealed only
 *     when the round is closed;
 *   - one answer per player per round, accepted only between the round's
 *     startAt and endAt on the server clock; the order of right answers is the
 *     order the server received them (ties: arrival sequence).
 *
 * Round: ANNOUNCE (3-2-1) -> PLAY (15 s: the TV plays, phones answer) ->
 * RESULT (the answer, who was right, points). Everybody answered -> results
 * early. The TV can't play a clip -> the round is replayed with a spare song
 * (nobody is punished for it); no spare left -> the round is void (0 for all).
 *
 * Points per right answer by its rank: POINTS (100, 80, 60, 50, 40, 30, 20,
 * then 10). Wrong / no answer = 0.
 * Lives after 5 rounds: 4+ players -> the 3 lowest totals; 3 -> the lowest; 2
 * -> the lowest. Everybody equal -> nobody. Ties on the border all go down
 * together (TIE_SHARE_LAST) — the results say so. The single best total gets
 * the usual minigame bonus.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ID = "tune";
const AUDIO_DIR = path.join(__dirname, "..", "..", "client", "public", "assets", "minigames", "Name That Tune", "songs");
const AUDIO_URL_PREFIX = "/assets/minigames/Name%20That%20Tune"; // blocked in server.js
const CATALOG_FILE = path.join(__dirname, "..", "data", "tunes.json");
const AUDIO_EXT = /\.(mp3|ogg|wav|m4a)$/i;
const MIME = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4" };

const CONFIG = {
  ROUNDS: 5,
  OPTIONS: 4,
  SPARE_SONGS: 2, // replacements for a clip the TV can't play
  INTRO_MS: Number(process.env.TUNE_INTRO_MS) || 12000, // title + rules (+ the TV loads the songs)
  READY_TIMEOUT_MS: 8000, // max extra wait for the TV to load the songs
  ANNOUNCE_MS: Number(process.env.TUNE_ANNOUNCE_MS) || 3000,
  PLAY_MS: Number(process.env.TUNE_PLAY_MS) || 15000,
  RESULT_MS: Number(process.env.TUNE_RESULT_MS) || 4500,
  POINTS: [100, 80, 60, 50, 40, 30, 20, 10], // by rank among the right answers; the last value repeats
  TIE_SHARE_LAST: true, // ties on the losing border all lose a life (may be more than 3)
};
const ROUND_MS = () => CONFIG.ANNOUNCE_MS + CONFIG.PLAY_MS + CONFIG.RESULT_MS;
const TOTAL_DURATION_MS =
  CONFIG.INTRO_MS + CONFIG.READY_TIMEOUT_MS + (CONFIG.ROUNDS + CONFIG.SPARE_SONGS) * (CONFIG.ANNOUNCE_MS + CONFIG.PLAY_MS + CONFIG.RESULT_MS) + 15000;

const pointsFor = (rank) => CONFIG.POINTS[Math.min(rank, CONFIG.POINTS.length) - 1] ?? 0;
/** How many players lose a life for `n` players. */
const losersFor = (n) => (n >= 4 ? 3 : n >= 2 ? 1 : 0);

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- catalogue

/** "Artist - Title.mp3" -> { artist, title } (also "—" / "–"); no separator -> title only. */
function parseFileName(file) {
  const base = file.replace(AUDIO_EXT, "").trim();
  const m = base.match(/^(.+?)\s+[-—–]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: "", title: base };
}

/** Every playable song: [{ id, file, path, title, artist, start }]. */
function loadCatalog(dir = AUDIO_DIR, catalogFile = CATALOG_FILE) {
  let overrides = {};
  try {
    overrides = JSON.parse(fs.readFileSync(catalogFile, "utf8")).files || {};
  } catch {
    /* no overrides file: names come from the files */
  }
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => AUDIO_EXT.test(f));
  } catch (e) {
    console.error(`[tune] cannot read ${dir}: ${e.message}`);
  }
  return files
    .map((file) => {
      const o = overrides[file] || {};
      if (o.skip) return null;
      const parsed = parseFileName(file);
      const title = String(o.title || parsed.title).trim();
      if (!title) return null;
      return {
        id: crypto.createHash("sha1").update(file).digest("hex").slice(0, 12),
        file,
        path: path.join(dir, file),
        title,
        artist: String(o.artist ?? parsed.artist).trim(),
        start: Number(o.start) > 0 ? Number(o.start) : 0,
      };
    })
    .filter(Boolean);
}

const titleKey = (s) => s.title.toLocaleLowerCase("uk").replace(/[^\p{L}\p{N}]+/gu, "");

/** Is there enough to play? -> null or a message for the organiser. */
function catalogProblem(catalog) {
  if (catalog.length < CONFIG.ROUNDS) return `потрібно щонайменше ${CONFIG.ROUNDS} пісень, знайдено ${catalog.length}`;
  if (new Set(catalog.map(titleKey)).size < CONFIG.OPTIONS) return `потрібно щонайменше ${CONFIG.OPTIONS} різні назви пісень`;
  return null;
}

/** 4 options: the song + 3 other songs with different titles, shuffled. */
function makeOptions(song, catalog) {
  const used = new Set([titleKey(song)]);
  const wrong = [];
  for (const s of shuffle(catalog)) {
    if (wrong.length >= CONFIG.OPTIONS - 1) break;
    if (used.has(titleKey(s))) continue;
    used.add(titleKey(s));
    wrong.push(s);
  }
  const options = shuffle([song, ...wrong]).map((s) => ({ title: s.title, artist: s.artist, songId: s.id }));
  return { options, correctIndex: options.findIndex((o) => o.songId === song.id) };
}

// ---------------------------------------------------------------- opaque audio URLs

const audioTokens = new Map(); // token -> { path, expires }
const TOKEN_TTL_MS = 30 * 60 * 1000;
function audioUrlFor(song) {
  const token = crypto.randomBytes(12).toString("hex");
  audioTokens.set(token, { path: song.path, expires: Date.now() + TOKEN_TTL_MS });
  for (const [t, v] of audioTokens) if (v.expires < Date.now()) audioTokens.delete(t);
  return `/tune/${token}`;
}

/** Express handler for GET /tune/:token — streams the clip without revealing its name. */
function serveAudio(req, res) {
  const entry = audioTokens.get(String(req.params.token || ""));
  if (!entry || entry.expires < Date.now()) return res.sendStatus(404);
  const ext = (entry.path.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  res.set("Cache-Control", "no-store");
  res.type(MIME[ext] || "application/octet-stream");
  res.sendFile(entry.path, { dotfiles: "allow" }, (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
}

// ---------------------------------------------------------------- contest

function buildContest({ players, correctIndex, roundIndex }) {
  if (players.length < 2) return null;
  const anyWrong = players.some((p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex));
  if (!anyWrong) return null;
  const problem = catalogProblem(loadCatalog());
  if (problem) {
    console.error(`[tune] «Вгадай мелодію» не запускається: ${problem} (${AUDIO_DIR})`);
    return null;
  }
  return {
    minigameId: ID,
    mode: "rounds_speed",
    roundIndex,
    contestantIds: players.map((p) => p.id),
  };
}

function roundFor(song, catalog) {
  return { song, ...makeOptions(song, catalog), url: audioUrlFor(song), status: "pending", answers: {}, announceAt: 0, startAt: 0, endAt: 0, ranking: [] };
}

function onStart(mg) {
  const catalog = loadCatalog();
  const picked = shuffle(catalog).slice(0, CONFIG.ROUNDS + CONFIG.SPARE_SONGS);
  mg.tune = {
    catalog,
    rounds: picked.slice(0, CONFIG.ROUNDS).map((s) => roundFor(s, catalog)),
    spares: picked.slice(CONFIG.ROUNDS),
    index: -1,
    phase: "intro", // intro | announce | live | result | done
    introEndsAt: 0,
    displayReady: false,
    totals: Object.fromEntries(mg.contestantIds.map((id) => [id, 0])),
    correct: Object.fromEntries(mg.contestantIds.map((id) => [id, 0])),
    fastMs: Object.fromEntries(mg.contestantIds.map((id) => [id, 0])), // summed reaction time of right answers
    seq: 0,
    outcome: null,
  };
}

// what the clients may see -------------------------------------------------

const publicRound = (mg, i) => {
  const r = mg.tune.rounds[i];
  return {
    index: i,
    total: mg.tune.rounds.length,
    announceAt: r.announceAt,
    startAt: r.startAt,
    endAt: r.endAt,
    options: r.options.map((o) => ({ title: o.title, artist: o.artist })), // no song ids, no answer
    status: r.status,
  };
};
const progressPayload = (mg, i) => ({ index: i, answered: Object.keys(mg.tune.rounds[i]?.answers || {}).length, total: mg.contestantIds.length });

function roundResult(mg, i) {
  const r = mg.tune.rounds[i];
  return {
    index: i,
    total: mg.tune.rounds.length,
    void: r.status === "void",
    correctIndex: r.status === "void" ? null : r.correctIndex,
    song: { title: r.song.title, artist: r.song.artist },
    players: mg.contestantIds.map((id) => {
      const a = r.answers[id];
      const rank = r.ranking.indexOf(id);
      return {
        id,
        choice: a ? a.choice : null,
        correct: !!a && a.choice === r.correctIndex,
        rank: rank >= 0 ? rank + 1 : null,
        points: rank >= 0 ? pointsFor(rank + 1) : 0,
        ms: a ? a.at - r.startAt : null,
      };
    }),
    totals: { ...mg.tune.totals },
  };
}

// timeline -----------------------------------------------------------------

function onSync(mg, nowTs, ctx) {
  const t = mg.tune;
  t.introEndsAt = nowTs + CONFIG.INTRO_MS;
  ctx.emitAll("tune:go", { rounds: t.rounds.length, introEndsAt: t.introEndsAt, serverNow: nowTs, points: CONFIG.POINTS, losers: losersFor(mg.contestantIds.length) });
  // the TV loads every clip now (the spares only if needed later)
  ctx.emitDisplay?.("tune:preload", { urls: t.rounds.map((r) => r.url) });
  ctx.setTimer(() => afterIntro(mg, ctx), CONFIG.INTRO_MS);
}

function afterIntro(mg, ctx) {
  const t = mg.tune;
  if (t.phase !== "intro") return;
  if (t.displayReady || ctx.now() >= t.introEndsAt + CONFIG.READY_TIMEOUT_MS) return startRound(mg, 0, ctx);
  ctx.setTimer(() => afterIntro(mg, ctx), 500); // wait a little for the songs, never forever
}

function startRound(mg, i, ctx) {
  const t = mg.tune;
  if (i >= t.rounds.length) return finishGame(mg, ctx);
  const now = ctx.now();
  const r = t.rounds[i];
  t.index = i;
  t.phase = "announce";
  r.status = "announce";
  r.announceAt = now;
  r.startAt = now + CONFIG.ANNOUNCE_MS;
  r.endAt = r.startAt + CONFIG.PLAY_MS;
  ctx.emitAll("tune:round", { ...publicRound(mg, i), serverNow: now });
  ctx.emitDisplay?.("tune:play", { index: i, url: r.url, startAt: r.startAt, serverNow: now, start: r.song.start });
  ctx.emitAll("tune:progress", progressPayload(mg, i));
  ctx.setTimer(() => {
    if (t.index !== i || r.status !== "announce") return;
    t.phase = "live";
    r.status = "live";
    ctx.setTimer(() => closeRound(mg, i, ctx), Math.max(0, r.endAt - ctx.now()));
  }, CONFIG.ANNOUNCE_MS);
}

/** Close the round: rank the right answers, add the points (once). */
function closeRound(mg, i, ctx) {
  const t = mg.tune;
  const r = t.rounds[i];
  if (!r || (r.status !== "live" && r.status !== "announce")) return;
  r.status = "done";
  t.phase = "result";
  r.ranking = Object.entries(r.answers)
    .filter(([, a]) => a.choice === r.correctIndex)
    .sort(([, a], [, b]) => a.at - b.at || a.seq - b.seq)
    .map(([id]) => id);
  r.ranking.forEach((id, k) => {
    t.totals[id] += pointsFor(k + 1);
    t.correct[id] += 1;
    t.fastMs[id] += r.answers[id].at - r.startAt;
  });
  ctx.emitAll("tune:result", { ...roundResult(mg, i), serverNow: ctx.now(), nextAt: ctx.now() + CONFIG.RESULT_MS });
  ctx.setTimer(() => startRound(mg, i + 1, ctx), CONFIG.RESULT_MS);
}

function finishGame(mg, ctx) {
  mg.tune.phase = "done";
  ctx.resolveNow();
}

// events -------------------------------------------------------------------

function onClientEvent(mg, playerId, name, data, ctx) {
  const t = mg.tune;
  if (!t) return;
  const now = ctx.now();
  if (name === "tune:hello") {
    // a phone (re)opened the page: the game clock, the current round, its own answer
    ctx.emitPlayer(playerId, "tune:go", { rounds: t.rounds.length, introEndsAt: t.introEndsAt, serverNow: now, points: CONFIG.POINTS, losers: losersFor(mg.contestantIds.length) });
    const i = t.index;
    if (i >= 0) {
      ctx.emitPlayer(playerId, "tune:round", { ...publicRound(mg, i), serverNow: now });
      const a = t.rounds[i].answers[playerId];
      if (a) ctx.emitPlayer(playerId, "tune:ack", { index: i, choice: a.choice });
      if (t.rounds[i].status === "done" || t.rounds[i].status === "void") ctx.emitPlayer(playerId, "tune:result", { ...roundResult(mg, i), serverNow: now });
    }
    return;
  }
  if (name !== "tune:answer") return;
  const i = t.index;
  const r = t.rounds[i];
  if (!r || r.status !== "live" || now < r.startAt || now >= r.endAt) return; // not open / too late
  if (Number(data?.index) !== i) return; // an answer for another round
  if (r.answers[playerId]) return; // one answer, locked
  const choice = Number(data?.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= r.options.length) return;
  r.answers[playerId] = { choice, at: now, seq: ++t.seq };
  ctx.emitPlayer(playerId, "tune:ack", { index: i, choice });
  ctx.emitAll("tune:progress", progressPayload(mg, i));
  // everybody still here has answered -> results now
  const present = new Set(ctx.players().map((p) => p.id));
  const waiting = mg.contestantIds.filter((id) => present.has(id) && !r.answers[id]);
  if (waiting.length === 0) closeRound(mg, i, ctx);
}

/** The TV: "tune:ready" (clips loaded) or "tune:audioFail" { index } (can't play this round). */
function onDisplayEvent(mg, name, data, ctx) {
  const t = mg.tune;
  if (!t) return;
  if (name === "tune:ready") {
    t.displayReady = true;
    return;
  }
  if (name !== "tune:audioFail") return;
  const i = Number(data?.index);
  const r = t.rounds[i];
  if (i !== t.index || !r || (r.status !== "announce" && r.status !== "live")) return;
  // nobody is punished for a broken clip: replay the round with a spare song, or void it
  const spare = t.spares.shift();
  if (spare) {
    t.rounds[i] = roundFor(spare, t.catalog);
    ctx.emitAll("tune:retry", { index: i, message: "Пісня не завантажилась — грає інша!", serverNow: ctx.now() });
    ctx.setTimer(() => startRound(mg, i, ctx), 1500);
    return;
  }
  r.status = "void";
  r.answers = {};
  r.ranking = [];
  t.phase = "result";
  ctx.emitAll("tune:result", { ...roundResult(mg, i), serverNow: ctx.now(), nextAt: ctx.now() + CONFIG.RESULT_MS });
  ctx.setTimer(() => startRound(mg, i + 1, ctx), CONFIG.RESULT_MS);
}

// ---------------------------------------------------------------- final

/** Pure: who loses a life for these totals (see the header). */
function decideLosers(ids, totals, { correct = {}, fastMs = {}, shareLast = CONFIG.TIE_SHARE_LAST } = {}) {
  const k = losersFor(ids.length);
  if (!k) return { loserIds: [], tie: false };
  const scores = ids.map((id) => totals[id] || 0);
  if (Math.min(...scores) === Math.max(...scores)) return { loserIds: [], tie: false, allEqual: true };
  // weakest first: fewer points, then fewer right answers, then slower right answers, then id
  const order = [...ids].sort(
    (a, b) => (totals[a] || 0) - (totals[b] || 0) || (correct[a] || 0) - (correct[b] || 0) || (fastMs[b] || 0) - (fastMs[a] || 0) || (a < b ? -1 : 1)
  );
  const border = totals[order[k - 1]] || 0;
  if (!shareLast) return { loserIds: order.slice(0, k), tie: false };
  const loserIds = order.filter((id) => (totals[id] || 0) <= border);
  return { loserIds, tie: loserIds.length > k };
}

function outcomeOf(mg) {
  const t = mg.tune;
  if (t.outcome) return t.outcome;
  const ids = mg.contestantIds;
  const { loserIds, tie, allEqual } = decideLosers(ids, t.totals, { correct: t.correct, fastMs: t.fastMs });
  const ranked = [...ids].sort((a, b) => t.totals[b] - t.totals[a] || t.correct[b] - t.correct[a] || t.fastMs[a] - t.fastMs[b] || (a < b ? -1 : 1));
  const best = Math.max(...ids.map((id) => t.totals[id]));
  const top = ids.filter((id) => t.totals[id] === best);
  t.outcome = {
    loserIds,
    tie: !!tie,
    allEqual: !!allEqual,
    ranked,
    winnerId: best > 0 && top.length === 1 ? top[0] : null,
    topIds: best > 0 ? top : [],
  };
  return t.outcome;
}

function resolveLosers(mg) {
  return [...outcomeOf(mg).loserIds];
}

function resolveWinner(mg) {
  return outcomeOf(mg).winnerId;
}

function buildResults(mg) {
  const t = mg.tune;
  const o = outcomeOf(mg);
  return {
    minigameScores: { ...t.totals },
    tune: {
      totals: { ...t.totals },
      correct: { ...t.correct },
      ranked: [...o.ranked],
      topIds: [...o.topIds],
      tie: o.tie,
      allEqual: o.allEqual,
      plannedLosers: losersFor(mg.contestantIds.length),
      rounds: t.rounds.map((r) => ({ title: r.song.title, artist: r.song.artist, void: r.status === "void", played: r.status === "done" })),
    },
  };
}

module.exports = {
  ID,
  CONFIG,
  TOTAL_DURATION_MS,
  AUDIO_URL_PREFIX,
  pointsFor,
  losersFor,
  parseFileName,
  loadCatalog,
  catalogProblem,
  makeOptions,
  serveAudio,
  decideLosers,
  buildContest,
  onStart,
  onSync,
  onClientEvent,
  onDisplayEvent,
  resolveLosers,
  resolveWinner,
  buildResults,
  ROUND_MS,
};
