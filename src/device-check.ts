import type { LocationId } from "./locations";

export interface StageMetrics {
  location: LocationId;
  seconds: number;
  frames: number;
  fps: number;
  p95_ms: number;
  over_25_ms: number;
  over_50_ms: number;
  completed: boolean;
  render_scale: number;
}
export interface DeviceReport {
  protocol: "device-check-1";
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

export class DeviceCheck {
  readonly locations: LocationId[] = ["chapel", "roofs", "courtyard"];
  stages: StageMetrics[] = [];
  elapsed = 0;
  index = 0;
  done = false;
  private samples = new FrameSamples();
  private begin: (location: LocationId) => void;
  constructor(begin: (location: LocationId) => void) {
    this.begin = begin;
    begin(this.locations[0]);
  }
  update(rawMs: number, completed: boolean, scale: number) {
    if (this.done) return;
    this.elapsed += rawMs / 1000;
    // Exclude first second of each location, including its initial camera placement.
    if (this.elapsed > 1) this.samples.add(rawMs);
    if ((completed && this.elapsed >= 15) || this.elapsed >= 24) {
      this.store(completed, scale);
      if (++this.index === this.locations.length) this.done = true;
      else {
        this.elapsed = 0;
        this.samples = new FrameSamples();
        this.begin(this.locations[this.index]);
      }
    }
  }
  interrupt(completed: boolean, scale: number) {
    if (this.done) return;
    this.store(completed, scale);
    this.done = true;
  }
  private store(completed: boolean, scale: number) {
    this.stages.push({
      location: this.locations[this.index],
      ...this.samples.result(),
      completed,
      render_scale: scale,
    });
  }
}
