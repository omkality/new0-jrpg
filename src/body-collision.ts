import type { Fighter } from "./game.ts";

export const bodyRadius = (f: Fighter) =>
  f.kind === "gaoler" ? 0.66 : f.kind === "mimic" ? 0.8 : 0.4;

// Corpses retain a low footprint. A chest remains a chest after death.
export function bodyPenetration(
  f: Fighter,
  x: number,
  z: number,
  other: Fighter,
) {
  if (Math.abs(f.y - other.y) > 0.9) return 0;
  const radius = bodyRadius(f),
    dx = x - other.x,
    dz = z - other.z;
  if (other.kind === "mimic") {
    const c = Math.cos(other.yaw),
      s = Math.sin(other.yaw);
    const u = dx * c - dz * s,
      v = dx * s + dz * c;
    const ax = Math.abs(u) - 0.79,
      az = Math.abs(v) - 0.62;
    return (
      radius -
      (Math.hypot(Math.max(0, ax), Math.max(0, az)) +
        Math.min(0, Math.max(ax, az)))
    );
  }
  if (other.hp > 0 || other.time < 0.25)
    return radius + bodyRadius(other) - Math.hypot(dx, dz);
  const progress = Math.min(1, (other.time - 0.25) / 0.7);
  const yaw =
    other.yaw +
    (other.death === "Side"
      ? -Math.PI / 2
      : other.death === "Back"
        ? Math.PI
        : 0);
  const extent = (other.kind === "gaoler" ? 1.25 : 0.95) * progress;
  const sx = Math.sin(yaw) * extent,
    sz = Math.cos(yaw) * extent;
  const t = Math.max(
    0,
    Math.min(1, (dx * sx + dz * sz) / (extent * extent || 1)),
  );
  return radius + 0.28 - Math.hypot(dx - sx * t, dz - sz * t);
}
