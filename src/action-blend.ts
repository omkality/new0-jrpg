import type { AnimationAction } from "three";

// Retarget a transition from the weights currently on screen. Three's fadeOut
// starts its envelope at one, which revives a partially faded action when a
// third action interrupts it. Keep one partition of unity instead.
export class ActionBlend {
  private weights = new Map<AnimationAction, { from: number; to: number }>();
  private elapsed = 0;
  private duration = 0;
  private current?: AnimationAction;

  reset() {
    this.weights.clear();
    this.current = undefined;
    this.elapsed = 0;
  }

  select(action: AnimationAction, duration: number) {
    const existing = this.weights.has(action);
    for (const [a, w] of this.weights) {
      a.stopFading();
      w.from = a.getEffectiveWeight();
      w.to = a === action ? 1 : 0;
    }
    if (!existing) {
      action.stopFading();
      action.setEffectiveWeight(this.current ? 0 : 1);
      this.weights.set(action, { from: this.current ? 0 : 1, to: 1 });
    }
    this.current = action;
    this.duration = Math.max(0.001, duration);
    this.elapsed = 0;
  }

  update(dt: number) {
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    const t = this.elapsed / this.duration;
    const u = t * t * (3 - 2 * t);
    for (const [action, w] of this.weights) {
      action.setEffectiveWeight(w.from + (w.to - w.from) * u);
      if (t === 1 && w.to === 0) {
        action.stop();
        this.weights.delete(action);
      }
    }
  }
}

export function locomotionName(speed: number, previous: string) {
  if (previous === "Run")
    return speed > 1.35 ? "Run" : speed > 0.07 ? "Walk" : "Idle";
  if (previous === "Walk")
    return speed > 1.9 ? "Run" : speed > 0.07 ? "Walk" : "Idle";
  return speed > 1.9 ? "Run" : speed > 0.28 ? "Walk" : "Idle";
}
