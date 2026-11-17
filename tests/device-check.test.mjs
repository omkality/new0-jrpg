import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceCheck, FrameSamples } from "../src/device-check.ts";

test("device metrics use real frame intervals, include stalls and retain a p95", () => {
  const samples = new FrameSamples();
  for (let i = 0; i < 99; i++) samples.add(1000 / 60);
  samples.add(100);
  const r = samples.result();
  assert.equal(r.frames, 100);
  assert.ok(r.fps < 60 && r.fps > 55);
  assert.ok(Math.abs(r.p95_ms - 1000 / 60) < 0.001);
  assert.equal(r.over_50_ms, 1);
  samples.add(Number.NaN);
  assert.equal(samples.result().frames, 100);
});
const resources = {
  geometries: 120,
  textures: 55,
  programs: 18,
  models: 13,
  js_heap_mb: null,
};
test("continuous diagnostics observes four areas without issuing game commands", () => {
  const check = new DeviceCheck(),
    completed = new Set();
  const areas = ["forest", "roofs", "chapel", "crypt"];
  for (const area of areas) {
    for (let i = 0; i < 1200; i++)
      check.update(1000 / 60, area, completed, false, 1, resources);
    completed.add(area);
  }
  check.update(1000 / 60, "crypt", completed, true, 0.9, resources);
  assert.ok(check.done);
  assert.deepEqual(
    check.stages.map((s) => s.location),
    areas,
  );
  assert.ok(
    check.stages.every(
      (s) => s.completed && s.frames >= 1200 && Math.abs(s.fps - 60) < 0.001,
    ),
  );
  assert.equal(check.stages[3].render_scale, 0.9);
  assert.equal(check.stages[0].resources.js_heap_mb, null);
});
test("continuous diagnostics preserves stalls and interrupted partial runs", () => {
  const check = new DeviceCheck();
  check.update(1500, "forest", new Set(), false, 1, resources);
  check.interrupt(false, 1, resources);
  assert.equal(check.stages.length, 1);
  assert.equal(check.stages[0].over_50_ms, 1);
  assert.equal(check.stages[0].completed, false);
  assert.ok(check.done);
});
