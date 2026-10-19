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
const path = require("path");
const { Server } = require("socket.io");

const { PORT, ADMIN_PASSWORD } = require("./config");
const registerHandlers = require("./handlers");
const apiRoutes = require("./admin/routes");
const media = require("./media");
const tune = require("./minigames/nameThatTune");
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

app.get("/health", (_req, res) => res.json({ ok: true }));

// REST API: public /api/categories + protected /api/admin/*
app.use(apiRoutes);

// Admin panel — a self-contained static SPA (no build step). http://host:PORT/admin
const adminDir = path.join(__dirname, "admin", "public");
app.use("/admin", express.static(adminDir));
app.get(/^\/admin(\/.*)?$/, (_req, res) =>
  res.sendFile(path.join(adminDir, "index.html"))
);

// Round video pools (drop-in folders) are served straight from client/public, so
// clips added later work without rebuilding the client. See server/media.js.
app.use(media.ROUNDS_URL, express.static(media.ROUNDS_DIR));
// "РАУНД N" announcement clips (questions/video/Round_N/) — drop-in too.
app.use(media.ANNOUNCE_URL, express.static(media.ANNOUNCE_DIR));
app.get("/api/media/round-videos", (_req, res) =>
  res.json(Object.fromEntries(Object.keys(media.POOLS).map((k) => [k, media.listPool(k)])))
);

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
  if (p.toLowerCase().startsWith("/assets/minigames/name that tune/songs")) return res.sendStatus(404);
  next();
});

// Serve the production client build when it exists. In development the CRA dev
// server on :3000 serves the app and its assets instead — this is a no-op then.
app.use(express.static(path.join(__dirname, "..", "client", "build")));

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
