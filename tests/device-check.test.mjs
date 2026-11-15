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
test("device check runs all three locations on wall time and keeps incomplete/interrupted results", () => {
  const begun = [];
  const check = new DeviceCheck((id) => begun.push(id));
  for (let i = 0; i < 60 * 46 && !check.done; i++)
    check.update(1000 / 60, true, 0.9);
  assert.deepEqual(begun, ["chapel", "roofs", "courtyard"]);
  assert.equal(check.stages.length, 3);
  assert.ok(check.done);
  assert.ok(
    check.stages.every(
      (s) => s.completed && s.frames > 800 && Math.abs(s.fps - 60) < 0.001,
    ),
  );
  const interrupted = new DeviceCheck(() => {});
  interrupted.update(1500, false, 1);
  interrupted.interrupt(false, 1);
  assert.equal(interrupted.stages.length, 1);
  assert.equal(interrupted.stages[0].completed, false);
  assert.equal(interrupted.done, true);
});
