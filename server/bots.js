/**
 * TEST MODE ONLY — bots the admin adds in the lobby (config.TEST_BOTS).
 *
 * A bot is a real Socket.IO client connected to this same server, so it joins and
 * plays exactly like a phone: the quiz, every minigame and the final. Its quiz
 * accuracy follows the game difficulty (BOT_ACCURACY). Bots live only in memory:
 * a server restart drops them. Remove this file (and the "addBot"/"removeBot"
 * handlers) when the game ships.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { io: connect } = require("socket.io-client");
const { PORT } = require("./config");
const { getRoom } = require("./rooms");

/** joinRoom with this key marks the player as a bot (never admin, shown with 🤖). */
const KEY = crypto.randomBytes(16).toString("hex");

// chance to answer a quiz / final question right, by game difficulty
const BOT_ACCURACY = { easy: 0.75, medium: 0.6, hard: 0.45 };
const MIXED_BY_ROUND = (round) => (round <= 3 ? 0.75 : round <= 6 ? 0.6 : 0.45);

const NAMES = ["Оксана", "Тарас", "Марко", "Ліна", "Денис", "Ірина", "Богдан", "Соломія", "Остап", "Христя"];
let ANIMALS = [];
try {
  ANIMALS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "ukrainianAnimals.json"), "utf8")).map((e) => e.word);
} catch {
  ANIMALS = [];
}

const bots = new Map(); // playerId -> { socket, roomCode }

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function accuracy(roomCode, round) {
  const room = getRoom(roomCode);
  const d = room?.difficulty;
  return BOT_ACCURACY[d] ?? MIXED_BY_ROUND(Number(round) || room?.currentRoundIndex + 1 || 1);
}

/** Answer index: right with the difficulty's chance, otherwise a wrong one. */
function chooseAnswer(correct, chance) {
  if (Number.isInteger(correct) && correct >= 0 && Math.random() < chance) return correct;
  const wrong = [0, 1, 2, 3].filter((x) => x !== correct);
  return pick(wrong);
}

/** A bot joins the room. Resolves with its player id, or rejects with the server's error. */
function addBot(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return Promise.reject(new Error("Кімнату не знайдено"));
  const used = new Set([...room.players.values()].map((p) => p.name));
  const name = "🤖 " + (NAMES.find((n) => !used.has("🤖 " + n)) || "Бот");

  const s = connect(`http://127.0.0.1:${PORT}`, { transports: ["websocket"], forceNew: true, reconnection: false });
  const bot = { s, roomCode, id: null, inMg: false, mgId: null };
  wire(bot);
  return new Promise((resolve, reject) => {
    s.once("connect_error", (e) => reject(e));
    s.once("connect", () => {
      s.emit("joinRoom", { roomCode, playerName: name, botKey: KEY }, (d) => {
        if (!d || d.error) {
          s.disconnect();
          return reject(new Error(d?.error || "Не вдалося додати бота"));
        }
        bot.id = d.playerId;
        bots.set(bot.id, bot);
        s.on("disconnect", () => bots.delete(bot.id));
        resolve(bot.id);
      });
    });
  });
}

function removeBot(playerId) {
  const bot = bots.get(playerId);
  if (!bot) return false;
  bots.delete(playerId);
  bot.s.emit("leaveRoom");
  setTimeout(() => bot.s.disconnect(), 200);
  return true;
}

function removeAll(roomCode) {
  for (const [id, bot] of bots) if (bot.roomCode === roomCode) removeBot(id);
}

/** Plays like a phone: the same events, human-ish delays. */
function wire(bot) {
  const s = bot.s;
  const later = (ms, fn) => setTimeout(() => s.connected && fn(), Math.max(0, ms));
  const mg = (name, data) => s.emit("minigameEvent", { name, data });

  // ---------------------------------------------------------------- quiz
  s.on("answerPhase", (d) => {
    const q = d?.question;
    if (!q) return;
    const idx = chooseAnswer(q.correctIndex, accuracy(bot.roomCode, d.roundIndex));
    later(rnd(2000, 8000), () => s.emit("answer", { answerIndex: idx }));
  });

  // ---------------------------------------------------------------- minigames
  s.on("trueFalseStart", (d) => {
    bot.inMg = (d.contestantIds || []).includes(bot.id);
    bot.mgId = d.minigameId;
  });
  // Правда/Брехня: answers from 15s (12s intro + 3-2-1) for 30s, live progress to the TV
  s.on("trueFalseSync", () => {
    if (!bot.inMg || bot.mgId !== "trueFalse") return;
    let score = 0;
    let at = 15000 + rnd(500, 1500);
    while (at < 44500) {
      if (Math.random() < 0.7) {
        const sc = ++score;
        later(at, () => mg("tf:progress", { score: sc, frozen: false }));
        at += rnd(900, 2200);
      } else {
        const sc = score;
        later(at, () => mg("tf:progress", { score: sc, frozen: true }));
        later(at + 3000, () => mg("tf:progress", { score: sc, frozen: false }));
        at += 3000 + rnd(600, 1500);
      }
    }
    const finalScore = score;
    later(45500, () => s.emit("trueFalseScore", { score: finalScore }));
  });
  // Тупоматика: questions only once the round has started; ~80% right (× too)
  s.on("mathRush:go", (d) => {
    bot.mrStartIn = Math.max(0, Number(d.playStartAt) - Number(d.serverNow));
    bot.mrGoAt = Date.now();
  });
  s.on("mathRush:question", (q) => {
    if (!bot.inMg) return;
    const startsIn = bot.mrGoAt ? Math.max(0, bot.mrStartIn - (Date.now() - bot.mrGoAt)) : 0;
    const m = String(q.text).match(/(-?\d+)\s*([+\-−×])\s*(-?\d+)/);
    let idx = Math.floor(Math.random() * 4);
    if (m && Math.random() < 0.8) {
      const a = +m[1];
      const b = +m[3];
      const val = m[2] === "+" ? a + b : m[2] === "×" ? a * b : a - b;
      const k = q.options.findIndex((o) => Number(o) === val);
      if (k >= 0) idx = k;
    }
    const think = m?.[2] === "×" ? rnd(1800, 4000) : rnd(900, 2600);
    later(startsIn + think, () => mg("mathRush:answer", { seq: q.seq, choice: idx }));
  });
  s.on("rps:round", (d) => {
    if (!(d.alive || []).includes(bot.id)) return;
    later(rnd(800, 4000), () => mg("rps:choose", { choice: pick(["rock", "scissors", "paper", "solder", "yanukovych"]) }));
  });
  // Гаряча бомба: names real animals, sometimes too slowly
  s.on("hb:state", (d) => {
    if (d.phase !== "live" || d.holderId !== bot.id) return;
    const seq = d.seq;
    if (bot.hbSeq === seq && !d.awaitingTarget) return;
    bot.hbSeq = seq;
    const others = (d.activeIds || []).filter((x) => x !== bot.id);
    const to = pick(others);
    if (d.awaitingTarget) {
      later(rnd(300, 900), () => mg("hb:target", { seq, targetId: to }));
      return;
    }
    mg("hb:target", { seq, targetId: to });
    const used = new Set((d.chain || []).map((c) => c.word));
    const options = ANIMALS.filter((w) => w.replace(/ґ/g, "г")[0] === d.letter && !used.has(w));
    const think = rnd(2000, 9000);
    if (Math.random() < 0.25) later(think * 0.5, () => mg("hb:word", { seq, text: d.letter + "абвгд" }));
    if (options.length) later(think, () => mg("hb:word", { seq, text: pick(options) }));
  });
  // Перетягни канат: 6-14 taps a second, every round of the series
  let towN = 0;
  const towScheduled = new Set();
  const towRound = (d, round) => {
    if (towScheduled.has(round)) return;
    towScheduled.add(round);
    const startIn = Number(d.startAt) - Number(d.serverNow);
    const playMs = Number(d.endsAt) - Number(d.startAt);
    const rate = rnd(6, 14);
    for (let t = rnd(50, 300); t < playMs + 400; t += 1000 / rate) {
      later(startIn + t, () => mg("tow:pull", { n: ++towN }));
    }
  };
  s.on("tow:go", (d) => {
    towScheduled.clear();
    towRound(d, 1);
  });
  s.on("tow:state", (d) => {
    if (d.phase === "break") towRound(d, d.round);
  });
  // Серед нас: КРИСА — mostly honest, sometimes steals, sometimes forgets to vote
  s.on("rat:go", (d) => {
    const openIn = Number(d.voteStartAt) - Number(d.serverNow);
    const r = Math.random();
    const choice = r < 0.25 ? "steal" : r < 0.9 ? "keep" : null;
    if (choice) later(openIn + rnd(1500, 20000), () => mg("rat:vote", { choice }));
  });
  // Меморі: phones never get the answer, so the bot guesses
  s.on("mem:task", (d) => {
    later(rnd(2500, 9000), () => {
      const data =
        d.mode === "order"
          ? { order: [...d.items.map((it) => it.id)].sort(() => Math.random() - 0.5) }
          : { colors: d.items.map(() => pick(d.colors)) };
      mg("mem:answer", { ...data, final: true });
    });
  });
  // Вгадай мелодію: the bot can't hear — it guesses at a random moment
  s.on("tune:round", (d) => {
    if (Math.random() < 0.12) return;
    const wait = Number(d.startAt) - Number(d.serverNow) + rnd(900, 11000);
    later(wait, () => mg("tune:answer", { index: d.index, choice: Math.floor(Math.random() * 4) }));
  });

  // ---------------------------------------------------------------- final
  s.on("finalQuestion", (q) => {
    const room = getRoom(bot.roomCode);
    const deck = room?.finalDeck || [];
    const card = deck.length ? deck[Number(q.step) % deck.length] : null;
    const correct = card && card.text === q.text ? card.correctIndex : -1;
    const idx = chooseAnswer(correct, accuracy(bot.roomCode, 9));
    later(rnd(1500, 7000), () => s.emit("finalAnswer", { answerIndex: idx }));
  });
}

module.exports = { KEY, addBot, removeBot, removeAll, BOT_ACCURACY };
