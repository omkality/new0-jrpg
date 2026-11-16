// The decorative outer terrain and its trees must use the same support surface.
// Traversable forest ground remains flat inside the shared playable bounds.
export function terrainHeight(x: number, z: number) {
  const outside = Math.max(0, Math.min(1, (Math.abs(x) - 8) / 13));
  const hills =
    (Math.sin(x * 0.14 + z * 0.065) * 2.2 +
      Math.cos(z * 0.12 - x * 0.03) * 2.8 -
      1.4) *
    outside;
  return -0.12 + hills + (z < -18 ? Math.min(2, (-18 - z) * 0.08) : 0);
}

export function forestSupportHeight(x: number, z: number) {
  const sx = 170 / 46,
    sz = 230 / 64;
  const ix = Math.max(0, Math.min(45, Math.floor((x + 85) / sx))),
    iz = Math.max(0, Math.min(63, Math.floor((z + 163) / sz)));
  const x0 = -85 + ix * sx,
    z0 = -163 + iz * sz;
  const u = Math.max(0, Math.min(1, (x - x0) / sx)),
    v = Math.max(0, Math.min(1, (z - z0) / sz));
  const a = terrainHeight(x0, z0),
    b = terrainHeight(x0, z0 + sz),
    c = terrainHeight(x0 + sx, z0 + sz),
    d = terrainHeight(x0 + sx, z0);
  const surface =
    u + v <= 1
      ? a + (d - a) * u + (b - a) * v
      : c + (b - c) * (1 - u) + (d - c) * (1 - v);
  return Math.abs(x) <= 9 && z >= -17 && z <= 14
    ? Math.max(0.01, surface)
    : surface;
}
