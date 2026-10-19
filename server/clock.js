/**
 * Per-room game clock + pausable timers (the admin can pause the game at any
 * moment).
 *
 *   now(room)              game time: wall clock minus every paused stretch.
 *                          Everything sent to clients as a timestamp uses it.
 *   schedule(room, fn, ms) like setTimeout, but frozen while the room is paused
 *   cancel(timer)          like clearTimeout (null-safe)
 *   pause(room) / resume(room)
 *
 * While paused no timer fires and `now()` stands still, so deadlines
 * (answer windows, minigame clocks, the final race) simply continue where they
 * stopped when the game resumes.
 */

function now(room) {
  const wall = Date.now();
  if (!room) return wall;
  return wall - (room.pausedTotalMs || 0) - (room.pausedAt != null ? wall - room.pausedAt : 0);
}

function arm(t) {
  t.startedAt = Date.now();
  t.native = setTimeout(() => {
    t.native = null;
    t.done = true;
    t.room.timers?.delete(t);
    t.fn();
  }, Math.max(0, t.remaining));
}

function schedule(room, fn, ms) {
  const t = { room, fn, remaining: Math.max(0, Number(ms) || 0), startedAt: 0, native: null, done: false };
  if (!room.timers) room.timers = new Set();
  room.timers.add(t);
  if (room.pausedAt == null) arm(t);
  return t;
}

function cancel(t) {
  if (!t || t.done) return;
  if (t.native) clearTimeout(t.native);
  t.native = null;
  t.done = true;
  t.room?.timers?.delete(t);
}

function isPaused(room) {
  return room?.pausedAt != null;
}

/** Freeze every pending timer of the room. Returns false if already paused. */
function pause(room) {
  if (!room || room.pausedAt != null) return false;
  room.pausedAt = Date.now();
  for (const t of room.timers || []) {
    if (!t.native) continue;
    clearTimeout(t.native);
    t.native = null;
    t.remaining = Math.max(0, t.remaining - (room.pausedAt - t.startedAt));
  }
  return true;
}

/** Re-arm the frozen timers with what they had left. Returns the paused ms (0 if not paused). */
function resume(room) {
  if (!room || room.pausedAt == null) return 0;
  const pausedMs = Date.now() - room.pausedAt;
  room.pausedTotalMs = (room.pausedTotalMs || 0) + pausedMs;
  room.pausedAt = null;
  for (const t of room.timers || []) if (!t.done && !t.native) arm(t);
  return pausedMs;
}

/** Drop every timer of the room (teardown). */
function cancelAll(room) {
  for (const t of [...(room?.timers || [])]) cancel(t);
}

module.exports = { now, schedule, cancel, isPaused, pause, resume, cancelAll };
