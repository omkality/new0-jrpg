import test from "node:test";
import assert from "node:assert/strict";
import { FrameCostProfile, PROBE_ORDER } from "../src/frame-cost.ts";

test("device profiling retains long RAF stalls separately from bounded CPU timings", () => {
  const profile = new FrameCostProfile();
  for (let i = 0; i < 100; i++)
    profile.record(
      "forest",
      i * 17,
      {
        raf_ms: i === 50 ? 300 : 17,
        callback_cpu_ms: 2.11,
        world_cpu_ms: 1.17,
      },
      1,
      150,
      120000,
    );
  const row = profile.summary().rows[0];
  assert.equal(row.frames, 100);
  assert.equal(row.metrics.raf_ms.max_ms, 300);
  assert.ok(row.fps < 60);
  assert.ok(Math.abs(row.metrics.callback_cpu_ms.mean_ms - 2.11) < 1e-8);
  assert.equal(row.metrics.callback_cpu_ms.p95_upper_ms, 2.25);
});

test("same-view layer probe uses paired ABBA blocks and discards transition settling frames", () => {
  const profile = new FrameCostProfile();
  profile.record("crypt", 100, { raf_ms: 17 }, 0.6561, 200, 180000);
  profile.beginProbe(1000);
  for (let block = 0; block < 8; block++) {
    assert.equal(profile.mode(1000 + block * 6000), PROBE_ORDER[block]);
    profile.record(
      "crypt",
      1000 + block * 6000 + 200,
      { raf_ms: 700 },
      0.6561,
      200,
      180000,
    );
    profile.record(
      "crypt",
      1000 + block * 6000 + 501,
      { raf_ms: 17 },
      0.6561,
      200,
      180000,
    );
  }
  const probe = profile.summary().rows.filter((r) => r.phase === "probe");
  assert.equal(probe.length, 8);
  assert.ok(
    probe.every((r) => r.frames === 1 && r.metrics.raf_ms.max_ms === 17),
  );
  assert.deepEqual(
    probe.map((r) => r.mode),
    PROBE_ORDER,
  );
  assert.ok(profile.isDone(49000));
  assert.ok(!profile.summary().probe_complete);
  profile.finish();
  assert.ok(profile.summary().probe_complete);
  assert.equal(profile.mode(49000), "normal");
});

test("profiling storage stops at twelve rows and one hundred thousand samples per row", () => {
  const profile = new FrameCostProfile();
  for (let i = 0; i < 100005; i++)
    profile.record("forest", i, { raf_ms: 17, world_cpu_ms: 2 }, 1, 100, 10000);
  assert.equal(profile.summary().rows[0].frames, 100000);
  assert.equal(profile.summary().rows[0].metrics.raf_ms.samples, 100000);
});
