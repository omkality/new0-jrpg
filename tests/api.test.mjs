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

function guestStorage(t, token = "saved-guest-session") {
  const original = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    ),
    values = new Map([["new0-guest-session", token]]);
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else delete globalThis.sessionStorage;
  });
  return values;
}

test("cached guest lookup retries a transient server error without creating another guest", async (t) => {
  const storage = guestStorage(t),
    calls = [],
    user = { name: "existing guest", is_guest: true };
  let lookups = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    if (url === "/api/config") return Response.json(config);
    if (url === "/api/me") {
      assert.equal(options.headers.Authorization, "Bearer saved-guest-session");
      if (++lookups === 1)
        return Response.json({ detail: "Temporary outage" }, { status: 503 });
      return Response.json(user);
    }
    return Response.json({
      token: "replacement-session",
      user: { name: "unexpected replacement", is_guest: true },
    });
  });
  const api = new API({ delayMs: 0 });
  await api.connect("");
  assert.deepEqual(calls, ["/api/config", "/api/me", "/api/me"]);
  assert.deepEqual(api.user, user);
  assert.equal(storage.get("new0-guest-session"), "saved-guest-session");
});

test("exhausted guest lookup timeouts preserve the saved session for a later retry", async (t) => {
  const storage = guestStorage(t),
    calls = [];
  let recovering = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url === "/api/config") return Response.json(config);
    if (url === "/api/me") {
      if (!recovering) throw new DOMException("Timed out", "TimeoutError");
      return Response.json({ name: "existing guest", is_guest: true });
    }
    return Response.json({
      token: "replacement-session",
      user: { name: "unexpected replacement", is_guest: true },
    });
  });
  const api = new API({ delayMs: 0, attempts: 2 });
  await assert.rejects(
    api.connect(""),
    (error) => error instanceof APIError && error.status === 0,
  );
  assert.deepEqual(calls, ["/api/config", "/api/me", "/api/me"]);
  assert.equal(storage.get("new0-guest-session"), "saved-guest-session");
  recovering = true;
  await api.connect("");
  assert.equal(api.user.name, "existing guest");
  assert.deepEqual(calls.slice(3), ["/api/config", "/api/me"]);
});

test("a non-authentication rejection does not silently replace a cached guest", async (t) => {
  const storage = guestStorage(t),
    calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url === "/api/config") return Response.json(config);
    if (url === "/api/me")
      return Response.json(
        { detail: "Unavailable to this account" },
        { status: 403 },
      );
    return Response.json({
      token: "replacement-session",
      user: { name: "unexpected replacement", is_guest: true },
    });
  });
  await assert.rejects(
    new API({ delayMs: 0 }).connect(""),
    (error) => error instanceof APIError && error.status === 403,
  );
  assert.deepEqual(calls, ["/api/config", "/api/me"]);
  assert.equal(storage.get("new0-guest-session"), "saved-guest-session");
});

test("an expired guest session is replaced once without sending the rejected bearer", async (t) => {
  const storage = guestStorage(t),
    calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    if (url === "/api/config") return Response.json(config);
    if (url === "/api/me")
      return Response.json({ detail: "Session expired" }, { status: 401 });
    assert.equal(url, "/api/auth/guest");
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({
      token: "fresh-guest-session",
      user: { name: "new guest", is_guest: true },
    });
  });
  const api = new API({ delayMs: 0 });
  await api.connect("");
  assert.deepEqual(calls, ["/api/config", "/api/me", "/api/auth/guest"]);
  assert.equal(storage.get("new0-guest-session"), "fresh-guest-session");
  assert.equal(api.user.name, "new guest");
});

test("guest authentication still works when browser storage is unavailable", async (t) => {
  guestStorage(t);
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("Storage denied", "SecurityError");
    },
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url === "/api/config") return Response.json(config);
    return Response.json({
      token: "fresh-guest-session",
      user: { name: "new guest", is_guest: true },
    });
  });
  const api = new API({ delayMs: 0 });
  await api.connect("");
  assert.equal(api.user.is_guest, true);
  assert.deepEqual(calls, ["/api/config", "/api/auth/guest"]);
});
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
