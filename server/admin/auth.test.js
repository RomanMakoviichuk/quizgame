process.env.ADMIN_PASSWORD = "s3cret-test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { login, logout, isValid, requireAuth } = require("./auth");

test("login: wrong password is rejected", () => {
  assert.equal(login("nope"), null);
  assert.equal(login(""), null);
});

test("login: correct password returns a usable token", () => {
  const res = login("s3cret-test");
  assert.ok(res && res.token);
  assert.equal(isValid(res.token), true);
  logout(res.token);
  assert.equal(isValid(res.token), false);
});

function mockReqRes(header) {
  const req = { get: (h) => (h.toLowerCase() === "authorization" ? header : undefined) };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

test("requireAuth: blocks missing / bad tokens, allows a valid one", () => {
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  let { req, res } = mockReqRes(undefined);
  requireAuth(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);

  ({ req, res } = mockReqRes("Bearer totally-made-up"));
  requireAuth(req, res, next);
  assert.equal(res.statusCode, 401);

  const { token } = login("s3cret-test");
  ({ req, res } = mockReqRes("Bearer " + token));
  requireAuth(req, res, next);
  assert.equal(nextCalled, true);
  assert.equal(req.adminToken, token);
});
