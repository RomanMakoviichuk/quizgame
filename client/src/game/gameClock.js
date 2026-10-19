/**
 * Client game clock — the client half of the admin pause (server/clock.js is
 * the other half).
 *
 * Game code uses these instead of Date.now / setTimeout / setInterval, so a
 * pause freezes every countdown, staged animation timer and minigame clock on
 * this device, and a resume continues them with exactly the time they had left.
 *
 *   now()                       game time (wall clock minus paused stretches)
 *   setTimeout / clearTimeout   pausable one-shots (own id space)
 *   setInterval / clearInterval ticks are skipped while paused
 *   pause() / resume() / isPaused() / subscribe(fn)
 */
let pausedAt = null;
let pausedTotal = 0;
let seq = 1;
const timers = new Map(); // id -> { fn, remaining, startedAt, native }
const listeners = new Set();

function now() {
  const wall = Date.now();
  return wall - pausedTotal - (pausedAt != null ? wall - pausedAt : 0);
}

function arm(id, t) {
  t.startedAt = Date.now();
  t.native = window.setTimeout(() => {
    timers.delete(id);
    t.fn();
  }, Math.max(0, t.remaining));
}

function setTimeout(fn, ms = 0, ...args) {
  const id = seq++;
  const t = { fn: () => fn(...args), remaining: Number(ms) || 0, startedAt: 0, native: null };
  timers.set(id, t);
  if (pausedAt == null) arm(id, t);
  return id;
}

function clearTimeout(id) {
  const t = timers.get(id);
  if (!t) return;
  if (t.native != null) window.clearTimeout(t.native);
  timers.delete(id);
}

function setInterval(fn, ms, ...args) {
  return window.setInterval(() => {
    if (pausedAt == null) fn(...args);
  }, ms);
}

function clearInterval(id) {
  window.clearInterval(id);
}

function isPaused() {
  return pausedAt != null;
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn(isPaused());
    } catch {}
  });
}

function pause() {
  if (pausedAt != null) return;
  pausedAt = Date.now();
  timers.forEach((t) => {
    if (t.native == null) return;
    window.clearTimeout(t.native);
    t.native = null;
    t.remaining = Math.max(0, t.remaining - (pausedAt - t.startedAt));
  });
  notify();
}

function resume() {
  if (pausedAt == null) return;
  pausedTotal += Date.now() - pausedAt;
  pausedAt = null;
  timers.forEach((t, id) => {
    if (t.native == null) arm(id, t);
  });
  notify();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const gameClock = { now, setTimeout, clearTimeout, setInterval, clearInterval, isPaused, pause, resume, subscribe };
export default gameClock;
