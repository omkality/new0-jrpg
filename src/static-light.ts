import * as T from "three";

export type WarmLight = {
  x: number;
  y: number;
  z: number;
  power: number;
  range: number;
};
export type WindowLight = {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  power: number;
  width: number;
  threshold?: boolean;
};

// All sources exist simultaneously. A small immutable irradiance volume gives
// walls, props and moving skinned people the same continuous local illumination.
// No per-camera light reassignment, per-fragment point/spot loops or new pass.
export class StaticLightField {
  readonly min = new T.Vector3(-12, -1, -110);
  readonly size = new T.Vector3(24, 14, 124);
  readonly dimensions = [25, 15, 125] as const;
  readonly texture: T.Data3DTexture;
  constructor(warm: readonly WarmLight[], windows: readonly WindowLight[]) {
    const [nx, ny, nz] = this.dimensions;
    const data = new Uint8Array(nx * ny * nz * 4);
    const fire = new T.Color(0xffc18b),
      cold = new T.Color(0xe7eee9);
    const beams = windows.map((a) => {
      const dx = a.tx - a.x,
        dy = a.ty - a.y,
        dz = a.tz - a.z;
      const length = Math.hypot(dx, dy, dz);
      return {
        ...a,
        dx: dx / length,
        dy: dy / length,
        dz: dz / length,
        length,
      };
    });
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const wx = this.min.x + (x * this.size.x) / (nx - 1);
          const wy = this.min.y + (y * this.size.y) / (ny - 1);
          const wz = this.min.z + (z * this.size.z) / (nz - 1);
          let r = 0,
            g = 0,
            b = 0;
          for (const a of warm) {
            const d2 = (wx - a.x) ** 2 + (wy - a.y) ** 2 + (wz - a.z) ** 2;
            if (d2 >= a.range * a.range) continue;
            const falloff = (1 - d2 / (a.range * a.range)) ** 2;
            const value = (a.power * 0.065 * falloff) / (d2 + 0.65);
            r += fire.r * value;
            g += fire.g * value;
            b += fire.b * value;
          }
          for (const a of beams) {
            const dx = wx - a.x,
              dy = wy - a.y,
              dz = wz - a.z;
            const along = dx * a.dx + dy * a.dy + dz * a.dz;
            if (along < -0.2 || along > a.length + 3) continue;
            const radial = Math.max(
              0,
              dx * dx + dy * dy + dz * dz - along * along,
            );
            const radius =
              a.width *
              (0.35 + 0.65 * T.MathUtils.clamp(along / a.length, 0, 1));
            const value =
              a.power *
              0.012 *
              Math.exp(-radial / (radius * radius)) *
              T.MathUtils.smoothstep(along, -0.2, 0.4) *
              (1 - T.MathUtils.smoothstep(along, a.length, a.length + 3)) *
              (a.threshold ? 0.3 : 1);
            r += cold.r * value;
            g += cold.g * value;
            b += cold.b * value;
          }
          const i = ((z * ny + y) * nx + x) * 4;
          data[i] = Math.round(Math.min(1, r / 3) * 255);
          data[i + 1] = Math.round(Math.min(1, g / 3) * 255);
          data[i + 2] = Math.round(Math.min(1, b / 3) * 255);
          data[i + 3] = 255;
        }
    this.texture = new T.Data3DTexture(data, nx, ny, nz);
    this.texture.format = T.RGBAFormat;
    this.texture.type = T.UnsignedByteType;
    this.texture.minFilter = this.texture.magFilter = T.LinearFilter;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }
  dispose() {
    this.texture.dispose();
  }
}
