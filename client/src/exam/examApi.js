import { io } from "socket.io-client";

/** The game server: same origin in production, :3001 next to the CRA dev server (:3000). */
export const SERVER_URL =
  process.env.REACT_APP_SERVER_URL ||
  (window.location.port === "3000" ? `${window.location.protocol}//${window.location.hostname}:3001` : window.location.origin);

export function connectExam() {
  return io(SERVER_URL, { transports: ["websocket", "polling"] });
}

/** socket.emit with an ack and a timeout: resolves { error: "timeout" } instead of hanging. */
export function call(socket, event, data, ms = 8000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: "timeout" }), ms);
    socket.emit(event, data, (r) => {
      clearTimeout(t);
      resolve(r || {});
    });
  });
}

export const readJSON = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};
export const writeJSON = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the session just is not remembered */
  }
};

/** 12-point grade → a word teachers use. */
export function gradeLevel(g) {
  if (g >= 10) return "високий";
  if (g >= 7) return "достатній";
  if (g >= 4) return "середній";
  return "початковий";
}

export const fmtDuration = (ms) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
