import { AREA_ORDER, type AreaId } from "./world-layout.ts";

export interface ResourceMetrics {
  geometries: number;
  textures: number;
  programs: number;
  models: number;
  js_heap_mb: number | null;
}

export interface StageMetrics {
  location: AreaId;
  seconds: number;
  frames: number;
  fps: number;
  p95_ms: number;
  over_25_ms: number;
  over_50_ms: number;
  completed: boolean;
  render_scale: number;
  resources: ResourceMetrics;
}
export interface DeviceReport {
  protocol: "device-check-2";
  platform: string;
  telegram_version: string;
  viewport_width: number;
  viewport_height: number;
  touch_points: number;
  controls_fit: boolean;
  errors: number;
  context_losses: number;
  interrupted: boolean;
  stages: StageMetrics[];
}

// Wall-clock RAF intervals, independent of simulation time and review recording.
export class FrameSamples {
  intervals: number[] = [];
  add(milliseconds: number) {
    if (
      Number.isFinite(milliseconds) &&
      milliseconds > 0 &&
      this.intervals.length < 100000
    )
      this.intervals.push(milliseconds);
  }
  result() {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const milliseconds = this.intervals.reduce((a, b) => a + b, 0);
    return {
      seconds: milliseconds / 1000,
      frames: sorted.length,
      fps: milliseconds ? (sorted.length * 1000) / milliseconds : 0,
      p95_ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : 0,
      over_25_ms: sorted.filter((n) => n > 25).length,
      over_50_ms: sorted.filter((n) => n > 50).length,
    };
  }
}

// Observes one continuous run without resetting or teleporting the player.
export class DeviceCheck {
  stages: StageMetrics[] = [];
  elapsed = 0;
  index = 0;
  done = false;
  private location: AreaId = "forest";
  private samples = new FrameSamples();
  update(
    rawMs: number,
    location: AreaId,
    completed: ReadonlySet<AreaId>,
    finished: boolean,
    scale: number,
    resources: ResourceMetrics,
  ) {
    if (this.done) return;
    if (location !== this.location) {
      this.store(completed.has(this.location), scale, resources);
      this.location = location;
      this.index = AREA_ORDER.indexOf(location);
      this.samples = new FrameSamples();
    }
    this.elapsed += rawMs / 1000;
    this.samples.add(rawMs);
    if (finished || this.elapsed >= 175) {
      this.store(finished && completed.has(location), scale, resources);
      this.done = true;
    }
  }
  interrupt(completed: boolean, scale: number, resources: ResourceMetrics) {
    if (this.done) return;
    this.store(completed, scale, resources);
    this.done = true;
  }
  private store(completed: boolean, scale: number, resources: ResourceMetrics) {
    if (this.stages.length >= 4) return;
    this.stages.push({
      location: this.location,
      ...this.samples.result(),
      completed,
      render_scale: scale,
      resources,
    });
  }
}
