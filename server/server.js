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

const { PORT } = require("./config");
const registerHandlers = require("./handlers");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
});

registerHandlers(io);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Serve the production client build when it exists. In development the CRA dev
// server on :3000 serves the app and its assets instead — this is a no-op then.
app.use(express.static(path.join(__dirname, "..", "client", "build")));

server.listen(PORT, () => {
  console.log(`Сервер на http://localhost:${PORT}`);
});
