import type { AreaId } from "./world-layout.ts";

export const COST_KEYS = [
  "raf_ms",
  "callback_cpu_ms",
  "simulation_cpu_ms",
  "world_cpu_ms",
  "environment_cpu_ms",
  "player_cpu_ms",
  "props_cpu_ms",
  "camera_cpu_ms",
  "npc_cpu_ms",
  "render_submit_cpu_ms",
  "hud_cpu_ms",
  "grain_cpu_ms",
] as const;
export type CostKey = (typeof COST_KEYS)[number];
export type FrameCosts = Partial<Record<CostKey, number>>;
export type LayerMode = "normal" | "no-grain" | "no-hud" | "world-only";
export const PROBE_ORDER: readonly LayerMode[] = [
  "normal",
  "no-grain",
  "no-grain",
  "normal",
  "no-hud",
  "world-only",
  "world-only",
  "no-hud",
];
const BLOCK_MS = 6000,
  SETTLE_MS = 500,
  BIN_MS = 0.25,
  BINS = 2048;

// Fixed memory histogram. p95 is the upper edge of a 0.25ms bin, or the
// observed maximum when the overflow bucket contains the quantile.
class CostMetric {
  private histogram = new Uint32Array(BINS + 1);
  samples = 0;
  sum = 0;
  maximum = 0;
  add(value: number) {
    if (!Number.isFinite(value) || value < 0 || this.samples >= 100000) return;
    this.samples++;
    this.sum += value;
    this.maximum = Math.max(this.maximum, value);
    this.histogram[Math.min(BINS, Math.floor(value / BIN_MS))]++;
  }
  summary() {
    let n = 0,
      p95 = 0;
    for (let i = 0; i <= BINS; i++) {
      n += this.histogram[i];
      if (n >= Math.ceil(this.samples * 0.95)) {
        p95 = i === BINS ? this.maximum : (i + 1) * BIN_MS;
        break;
      }
    }
    return {
      samples: this.samples,
      mean_ms: this.samples ? this.sum / this.samples : 0,
      p95_upper_ms: p95,
      max_ms: this.maximum,
    };
  }
}
class CostRow {
  metrics = new Map<CostKey, CostMetric>();
  frames = 0;
  rafTotal = 0;
  calls = 0;
  triangles = 0;
  phase: "route" | "probe";
  area: AreaId;
  mode: LayerMode;
  block: number;
  resolution: number;
  constructor(
    phase: "route" | "probe",
    area: AreaId,
    mode: LayerMode,
    block: number,
    resolution: number,
  ) {
    this.phase = phase;
    this.area = area;
    this.mode = mode;
    this.block = block;
    this.resolution = resolution;
  }
  add(cost: FrameCosts, calls: number, triangles: number) {
    if (this.frames >= 100000) return;
    this.frames++;
    this.rafTotal += cost.raf_ms ?? 0;
    this.calls += calls;
    this.triangles += triangles;
    for (const key of COST_KEYS) {
      if (cost[key] === undefined) continue;
      let metric = this.metrics.get(key);
      if (!metric) {
        metric = new CostMetric();
        this.metrics.set(key, metric);
      }
      metric.add(cost[key]!);
    }
  }
  summary() {
    return {
      phase: this.phase,
      area: this.area,
      mode: this.mode,
      block: this.block,
      resolution: this.resolution,
      frames: this.frames,
      fps: this.rafTotal ? (this.frames * 1000) / this.rafTotal : 0,
      calls_mean: this.frames ? this.calls / this.frames : 0,
      triangles_mean: this.frames ? this.triangles / this.frames : 0,
      metrics: Object.fromEntries(
        [...this.metrics].map(([key, value]) => [key, value.summary()]),
      ),
    };
  }
}

// Opt-in device diagnosis. The route is untouched. The paired layer probe runs
// only after the genuine four-area finish at the same camera and resolution.
export class FrameCostProfile {
  private rows = new Map<string, CostRow>();
  private probeStart: number | null = null;
  private probeFinished = false;
  get inProbe() {
    return this.probeStart !== null && !this.probeFinished;
  }
  beginProbe(now: number) {
    if (this.probeStart === null) this.probeStart = now;
  }
  mode(now: number): LayerMode {
    return this.probeStart === null || this.probeFinished
      ? "normal"
      : PROBE_ORDER[
          Math.min(7, Math.floor(Math.max(0, now - this.probeStart) / BLOCK_MS))
        ];
  }
  isDone(now: number) {
    return (
      this.probeStart !== null &&
      now - this.probeStart >= BLOCK_MS * PROBE_ORDER.length
    );
  }
  finish() {
    this.probeFinished = true;
  }
  record(
    area: AreaId,
    now: number,
    cost: FrameCosts,
    resolution: number,
    calls: number,
    triangles: number,
  ) {
    if (this.probeFinished) return;
    const elapsed = this.probeStart === null ? 0 : now - this.probeStart;
    if (
      this.probeStart !== null &&
      (this.isDone(now) || elapsed % BLOCK_MS < SETTLE_MS)
    )
      return;
    const phase = this.probeStart === null ? "route" : "probe";
    const block = phase === "route" ? 0 : Math.floor(elapsed / BLOCK_MS);
    const mode = this.mode(now),
      key = `${phase}/${area}/${block}`;
    let row = this.rows.get(key);
    if (!row) {
      if (this.rows.size >= 12) return;
      row = new CostRow(phase, area, mode, block, resolution);
      this.rows.set(key, row);
    }
    row.add(cost, calls, triangles);
  }
  summary() {
    return {
      protocol: "frame-cost-1" as const,
      cpu_bin_ms: BIN_MS,
      probe_block_ms: BLOCK_MS,
      probe_settle_ms: SETTLE_MS,
      probe_complete: this.probeFinished,
      rows: [...this.rows.values()].map((r) => r.summary()),
    };
  }
}
export type FrameCostReport = ReturnType<FrameCostProfile["summary"]>;
