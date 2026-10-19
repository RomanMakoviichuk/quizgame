/**
 * Dead-simple admin auth: one shared password (ADMIN_PASSWORD env) exchanged
 * for a bearer token. Tokens live in memory with a TTL. Enough to keep the
 * question database off the public internet for a single-operator setup — it
 * is NOT multi-user account management.
 */
const crypto = require("crypto");
const { ADMIN_PASSWORD, ADMIN_TOKEN_TTL_MS } = require("../config");

/** token -> expiresAt (ms epoch) */
const tokens = new Map();

function sweep() {
  const now = Date.now();
  for (const [t, exp] of tokens) if (exp <= now) tokens.delete(t);
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function login(password) {
  if (!timingSafeEqual(password || "", ADMIN_PASSWORD)) return null;
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
  return { token, expiresIn: ADMIN_TOKEN_TTL_MS };
}

function logout(token) {
  tokens.delete(token);
}

function isValid(token) {
  sweep();
  const exp = tokens.get(token);
  return !!exp && exp > Date.now();
}

/** Express middleware. */
function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : null;
  if (!token || !isValid(token)) {
    return res.status(401).json({ error: "Потрібна авторизація." });
  }
  req.adminToken = token;
  next();
}

module.exports = { login, logout, isValid, requireAuth };
