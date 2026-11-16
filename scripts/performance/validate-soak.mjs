// Offline validation. Exit 0 means the observed warmed resource series is bounded,
// not that all possible leaks are absent and not that a physical phone reaches 60fps.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export function validateSoak(r) {
  const failures = [],
    notes = [];
  const assert = (ok, message) => {
    if (!ok) failures.push(message);
  };
  const runs = r.completed_runs ?? [];
  assert(r.protocol === "fixes2-world-lab-2", "Unsupported report protocol");
  assert(
    r.fixture === "tracked-browser-resource-lab",
    "Expected the tracked whole-World fixture",
  );
  assert(
    r.physical_iphone_benchmark === false,
    "A software resource test cannot claim a physical iPhone benchmark",
  );
  assert(
    r.simulation_input_hz === 120,
    "Expected ordinary input-driven 120 Hz physics",
  );
  assert(
    r.diagnostics?.total_errors === 0 && r.diagnostics?.errors?.length === 0,
    "JavaScript or unhandled runtime errors were reported",
  );
  assert(
    r.diagnostics?.webgl_context_losses === 0,
    "WebGL context loss was reported",
  );
  if (r.page_observations) {
    for (const key of [
      "javascript_errors",
      "console_errors",
      "request_failures",
      "http_errors",
    ])
      assert(
        r.page_observations[key]?.length === 0,
        `${key} were reported by the browser`,
      );
    assert(r.page_observations.page_crashes === 0, "The browser page crashed");
  }
  assert(
    runs.length >= 6,
    `Expected at least 6 completed journeys, got ${runs.length}`,
  );
  assert(r.current_run === null, "A run is still active");
  const areas = ["forest", "roofs", "chapel", "crypt"];
  for (const [index, run] of runs.entries()) {
    assert(
      run.run === index + 1,
      `Run numbering is not sequential at ${index + 1}`,
    );
    assert(
      run.warmup === (index === 0),
      `Run ${run.run} has an incorrect warmup flag`,
    );
    assert(run.game_phase === "finished", `Run ${run.run} did not finish`);
    assert(
      areas.every((a) => run.completed_areas?.includes(a)),
      `Run ${run.run} did not complete all four areas`,
    );
    assert(
      !run.flags.current_area_only &&
        !run.flags.freeze_npc &&
        !run.flags.no_local_lights &&
        !run.flags.matrix_counting &&
        !run.flags.previous_actor_radius,
      `Run ${run.run} used a diagnostic workload toggle`,
    );
    assert(
      areas.every((area) =>
        run.stages?.some(
          (stage) =>
            stage.area === area &&
            stage.counters?.world_total_cpu_ms?.samples > 0,
        ),
      ),
      `Run ${run.run} did not render every area`,
    );
    assert(
      JSON.stringify(run.flags) === JSON.stringify(runs[0]?.flags),
      `Run ${run.run} used different flags`,
    );
  }
  const measured = runs.slice(1),
    series = {};
  for (const key of ["geometries", "textures", "programs", "models"]) {
    const values = measured.map((run) => run.resources?.[key]);
    assert(
      values.every((v) => Number.isFinite(v)),
      `${key}: missing resource count`,
    );
    const valid = values.filter(Number.isFinite);
    series[key] = values;
    assert(
      valid.length > 0 && Math.max(...valid) === Math.min(...valid),
      `${key}: warmed counts changed across runs 2–6 (${values.join(", ")})`,
    );
  }
  const heaps = measured.map((run) => run.resources?.js_heap_mb);
  if (r.forced_gc_available && heaps.every(Number.isFinite)) {
    const growth = heaps.at(-1) - heaps[0],
      span = Math.max(...heaps) - Math.min(...heaps);
    series.post_gc_js_heap_mb = heaps;
    // This is a useful retention alarm, not a byte-exact browser memory proof.
    assert(
      growth <= 8 && span <= 12,
      `Post-GC JS heap grew by ${growth.toFixed(2)} MB, span ${span.toFixed(2)} MB`,
    );
    notes.push(
      "Post-GC JS heap bounded within the configured 8 MB end-growth / 12 MB span alarm.",
    );
  } else
    notes.push(
      "No forced-GC JS heap series. GPU/resource counts alone cannot exclude a JS or driver memory leak.",
    );
  notes.push(
    "Run 1 is warmup. Resource counts measure registered Three resources, not total GPU/driver memory.",
  );
  if (r.page_observations?.cancelled_requests?.length)
    notes.push(
      `${r.page_observations.cancelled_requests.length} browser fetch cancellations were retained separately. Essential asset load, HTTP failure and completed-route gates still apply.`,
    );
  notes.push("This report is not a physical iPhone FPS benchmark.");
  return {
    passed: failures.length === 0,
    runs: runs.length,
    series,
    failures,
    notes,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const input = process.argv[2];
  if (!input)
    throw new Error(
      "Usage: node scripts/performance/validate-soak.mjs report.json",
    );
  const result = validateSoak(JSON.parse(await readFile(input, "utf8")));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
