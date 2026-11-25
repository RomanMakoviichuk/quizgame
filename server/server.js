/**
 * Bootstrap only. Everything else:
 *   config.js      — constants + env
 *   rooms.js       — in-memory room store + wire serializers
 *   questions.js   — per-round question decks
 *   phases.js      — the round phase machine (factory, takes io)
 *   minigames/     — post-round minigame registry
 *   handlers.js    — Socket.IO event wiring
 */
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const { PORT, ADMIN_PASSWORD } = require("./config");
const registerHandlers = require("./handlers");
const exam = require("./exam");
const { requireAuth } = require("./admin/auth");
const apiRoutes = require("./admin/routes");
const media = require("./media");
const tune = require("./minigames/nameThatTune");
const shellShock = require("./minigames/shellShock");
require("./content/store"); // load / seed the question database at boot

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST", "PUT", "DELETE"] },
});

app.use(express.json({ limit: "8mb" }));
// The admin panel and game client may be served from a different origin in dev.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

registerHandlers(io);
exam.register(io); // «Перевірка знань»: /teacher + /test

// test results as CSV (Excel opens it): a live test by its code + the teacher's token,
// a saved one by id from the admin token (history on the teacher page)
const sendCsv = (res, file) => {
  if (!file) return res.status(404).json({ error: "Не знайдено." });
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${file.name}"`);
  res.send(file.body);
};
app.get("/api/exam/:code/results.csv", (req, res) => sendCsv(res, exam.csvFor({ code: req.params.code, teacherToken: String(req.query.t || "") })));
// this computer's addresses in the local network: the teacher's page shows students where to go
app.get("/api/exam/lan", (_req, res) => {
  const ips = [];
  for (const list of Object.values(require("os").networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
  // a home/school Wi-Fi (192.168.x / 10.x) first, virtual adapters (172.x of WSL/Docker) last
  ips.sort((a, b) => (/^(192\.168|10)\./.test(b) ? 1 : 0) - (/^(192\.168|10)\./.test(a) ? 1 : 0));
  res.json({ ips });
});
app.get("/api/admin/exams", requireAuth, (_req, res) => res.json({ exams: exam.listSaved() }));
app.get("/api/admin/exams/:id/results.csv", requireAuth, (req, res) => sendCsv(res, exam.csvFor({ id: req.params.id })));

app.get("/health", (_req, res) => res.json({ ok: true }));

// REST API: public /api/categories + protected /api/admin/*
app.use(apiRoutes);

// Admin panel — a self-contained static SPA (no build step). http://host:PORT/admin
const adminDir = path.join(__dirname, "admin", "public");
// Cloudflare tells browsers to keep .css/.js for 4 hours, so a phone mixed the old
// admin.css with a new admin.js. The page links them as admin.css?v=<mtime>: a new
// file is a new URL. The page itself is never cached.
function adminPage(_req, res) {
  const html = fs.readFileSync(path.join(adminDir, "index.html"), "utf8").replace(
    /(href|src)="(admin\.(?:css|js))"/g,
    (_m, attr, file) => `${attr}="${file}?v=${Math.floor(fs.statSync(path.join(adminDir, file)).mtimeMs)}"`
  );
  res.set("Cache-Control", "no-store").type("html").send(html);
}
app.get("/admin", (req, res, next) => (req.path === "/admin" ? res.redirect(301, "/admin/") : next()));
app.get(["/admin/", "/admin/index.html"], adminPage);
app.use("/admin", express.static(adminDir, { index: false }));
app.get(/^\/admin(\/.*)?$/, adminPage);

// Round videos (assets/rounds/: announcements, question backgrounds, after-round
// and result clips) are drop-in folders served straight from client/public, so
// clips added later work without rebuilding the client. See server/media.js.
app.use(media.ROUNDS_URL, express.static(media.ROUNDS_DIR));
app.get("/api/media/round-videos", (_req, res) =>
  res.json(Object.fromEntries(Object.keys(media.POOLS).map((k) => [k, media.listPool(k)])))
);
// «Не кліпай!»: the things under the cups are a drop-in folder too (see minigames/shellShock.js)
app.use(shellShock.ITEMS_URL, express.static(shellShock.ITEMS_DIR));
// what the TV downloads up front (see client/src/components/MediaPreloader.jsx)
app.get("/api/media/manifest", (_req, res) => res.set("Cache-Control", "no-store").json(media.preloadManifest()));

// «Вгадай мелодію»: clips are played from opaque per-round URLs, so the file
// name (= the answer) never reaches a phone; the song folder itself is closed.
app.get("/tune/:token", tune.serveAudio);
app.use((req, res, next) => {
  let p = req.path;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep the raw path */
  }
  // the songs are only served through /tune/<token> (background.mp3 next to them is public)
  if (p.toLowerCase().startsWith("/assets/minigames/name-that-tune/songs")) return res.sendStatus(404);
  next();
});

// the TV's media cache worker must always be the fresh one (Cloudflare caches .js for hours otherwise)
app.get("/media-sw.js", (_req, res) =>
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "..", "client", "build", "media-sw.js"))
);

// Serve the production client build when it exists. In development the CRA dev
// server on :3000 serves the app and its assets instead — this is a no-op then.
app.use(express.static(path.join(__dirname, "..", "client", "build")));
// the test pages are routes of the same client app
app.get(["/test", "/teacher"], (_req, res, next) => {
  const index = path.join(__dirname, "..", "client", "build", "index.html");
  if (!fs.existsSync(index)) return next();
  res.set("Cache-Control", "no-store").sendFile(index);
});

server.listen(PORT, () => {
  console.log(`Сервер на http://localhost:${PORT}`);
  console.log(`Адмін-панель: http://localhost:${PORT}/admin`);
  if (ADMIN_PASSWORD === "admin") {
    console.log(
      "⚠  ADMIN_PASSWORD не встановлено — використовується пароль за замовчуванням «admin». " +
        "Задайте змінну середовища ADMIN_PASSWORD перед публічним запуском."
    );
  }
});
