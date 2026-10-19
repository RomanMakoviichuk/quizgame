/**
 * Pausable room clock (admin pause). Timers and Date are mocked.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const clock = require("./clock");

const mkRoom = () => ({ pausedAt: null, pausedTotalMs: 0, timers: new Set() });

test("a scheduled timer fires normally when nothing is paused", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const room = mkRoom();
  let fired = 0;
  clock.schedule(room, () => fired++, 1000);
  t.mock.timers.tick(999);
  assert.equal(fired, 0);
  t.mock.timers.tick(1);
  assert.equal(fired, 1);
  assert.equal(room.timers.size, 0);
});

test("pause freezes timers and game time; resume continues with what was left", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const room = mkRoom();
  let fired = 0;
  clock.schedule(room, () => fired++, 1000);

  t.mock.timers.tick(400);
  assert.equal(clock.pause(room), true);
  assert.equal(clock.pause(room), false); // already paused
  const frozenAt = clock.now(room);

  t.mock.timers.tick(60_000); // a long pause
  assert.equal(fired, 0);
  assert.equal(clock.now(room), frozenAt);

  assert.equal(clock.resume(room), 60_000);
  assert.equal(clock.now(room), frozenAt); // game time picks up where it stopped
  t.mock.timers.tick(599);
  assert.equal(fired, 0);
  t.mock.timers.tick(1); // 400 + 600 = the original 1000ms of game time
  assert.equal(fired, 1);
});

test("timers scheduled during a pause start only after resume", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const room = mkRoom();
  let fired = 0;
  clock.pause(room);
  clock.schedule(room, () => fired++, 500);
  t.mock.timers.tick(10_000);
  assert.equal(fired, 0);
  clock.resume(room);
  t.mock.timers.tick(500);
  assert.equal(fired, 1);
});

test("cancel works before, during and after a pause; cancelAll clears the room", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const room = mkRoom();
  let fired = 0;
  const a = clock.schedule(room, () => fired++, 100);
  const b = clock.schedule(room, () => fired++, 100);
  clock.schedule(room, () => fired++, 100);
  clock.cancel(a);
  clock.pause(room);
  clock.cancel(b);
  clock.resume(room);
  clock.cancelAll(room);
  t.mock.timers.tick(1000);
  assert.equal(fired, 0);
  clock.cancel(null); // null-safe
});

test("resume without a pause is a no-op", () => {
  const room = mkRoom();
  assert.equal(clock.resume(room), 0);
  assert.equal(clock.isPaused(room), false);
});
