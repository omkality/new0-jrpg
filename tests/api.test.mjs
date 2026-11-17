import { test } from "node:test";
import assert from "node:assert/strict";
import { API, APIError } from "../src/api.ts";

const config = {
  allow_guest: true,
  competition_open: false,
  version: "test",
  title: "test",
  attempt_limit: 0,
  bot_username: "test_bot",
  shop_url: "https://example.org",
  drop_url: "https://example.org",
};
test("bootstrap recovers from a timed-out response without downgrading Telegram identity", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (calls.length === 1)
      throw new DOMException("Fetch is aborted", "TimeoutError");
    if (url === "/api/config") return Response.json(config);
    return Response.json({
      token: "test-session",
      user: { name: "test", is_guest: false },
    });
  });
  const api = new API({ delayMs: 0 });
  await api.connect("signed-init-data");
  assert.deepEqual(calls, ["/api/config", "/api/config", "/api/auth/telegram"]);
  assert.equal(api.user.is_guest, false);
});
test("an interrupted successful JSON body is retried during bootstrap, authorization rejection is not", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++count === 1)
      return {
        ok: true,
        json: async () => {
          throw new DOMException("aborted", "AbortError");
        },
      };
    if (count === 2) return Response.json(config);
    return Response.json({ detail: "Invalid signature" }, { status: 401 });
  });
  const api = new API({ delayMs: 0 });
  await assert.rejects(
    api.connect("invalid-data"),
    (e) => e instanceof APIError && e.status === 401,
  );
  assert.equal(count, 3);
});
test("normal gameplay POST is never automatically replayed after a network failure", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    throw new DOMException("aborted", "AbortError");
  });
  await assert.rejects(
    new API({ delayMs: 0 }).request("/runs", {}),
    (e) => e.status === 0,
  );
  assert.equal(count, 1);
});
