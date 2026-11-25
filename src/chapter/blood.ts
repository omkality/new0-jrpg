import * as T from "three";
import type { GameEvent } from "../game.ts";

type Wound = NonNullable<GameEvent["wound"]>;
const capacity = 24;
const tones = [0x491018, 0x56151c, 0x401018, 0x531119];
const facingForward = new T.Quaternion();

// Uneven wet edges and small gaps stay legible on the chapter's pixel grid.
function fleckTexture() {
  const rows = [
    ".....1......",
    "..1..2.1....",
    "...12221.1..",
    ".1.22322....",
    "..12333321..",
    "...2333322.1",
    ".122333321..",
    "...223312...",
    ".1.1222..1..",
    "....12......",
    "..1.....1...",
    "............",
  ];
  const alpha = [0, 92, 194, 255];
  const rgba = new Uint8Array(12 * 12 * 4);
  for (const [i, dot] of [...rows.join("")].entries()) {
    rgba.fill(255, i * 4, i * 4 + 3);
    rgba[i * 4 + 3] = alpha[Number(dot) || 0];
  }
  const texture = new T.DataTexture(rgba, 12, 12);
  texture.magFilter = texture.minFilter = T.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export class Blood {
  readonly mesh = new T.InstancedMesh(
    new T.PlaneGeometry(1, 1),
    new T.MeshBasicMaterial({
      map: fleckTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
    capacity,
  );
  private drops = Array.from({ length: capacity }, () => ({
    age: -1,
    life: 0,
    x: 0,
    y: 0,
    z: 0,
    ground: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    width: 0,
    height: 0,
    angle: 0,
    tone: 0,
  }));
  private cursor = 0;
  private seed = 6311;
  private readonly pose = new T.Object3D();
  private readonly color = new T.Color();
  constructor() {
    this.mesh.name = "BloodAtContact";
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color);
    this.mesh.instanceColor!.setUsage(T.DynamicDrawUsage);
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  strike(x: number, z: number, { dx, dz, y, ground, kind, incoming }: Wound) {
    const thrust = kind === "thrust";
    // The two opponents face the pilgrim and strike across her opposite flank.
    const side = (incoming ?? (kind === "rake" || kind === "hew")) ? -1 : 1;
    // A thrust sheds drops back from the entry point on the near face of the armour.
    const entry = thrust ? 0.44 : 0.12;
    const count = 6 + Math.floor(this.random() * 4);
    for (let i = 0; i < count; i++) {
      const d = this.drops[this.cursor];
      this.cursor = (this.cursor + 1) % capacity;
      const main = i < 2;
      const forward = (thrust ? -0.9 : 0.48) * (0.55 + this.random());
      const across = side * (thrust ? 0.96 : 1.65) * (0.56 + this.random());
      const edge = side * ((thrust ? 0.13 : 0.22) + this.random() * 0.06);
      d.age = 0;
      d.life = main ? 0.23 : 0.18 + 0.13 * this.random();
      d.x = x - dx * entry - dz * edge;
      d.z = z - dz * entry + dx * edge;
      d.y = y + (this.random() - 0.5) * 0.1;
      d.ground = ground;
      d.vx = dx * forward - dz * across;
      d.vz = dz * forward + dx * across;
      d.vy = main ? 0.21 : -0.32 + this.random() * 1.45;
      d.width = main
        ? 0.22 + 0.055 * this.random()
        : 0.075 + 0.11 * this.random();
      d.height = d.width * (0.76 + 0.36 * this.random());
      d.angle = this.random() * Math.PI * 2;
      d.tone = tones[Math.floor(this.random() * tones.length)];
    }
    this.mesh.visible = true;
  }
  update(dt: number, camera = facingForward) {
    if (!this.mesh.visible) return;
    let count = 0;
    for (const d of this.drops) {
      if (d.age < 0) continue;
      const t = (d.age += dt);
      const y = d.y + (d.vy - 3.8 * t) * t;
      if (t >= d.life || y <= d.ground) {
        d.age = -1;
        continue;
      }
      const travel = t / (1 + 1.5 * t);
      const size = Math.min(1, (d.life - t) / 0.11);
      this.pose.position.set(d.x + travel * d.vx, y, d.z + travel * d.vz);
      this.pose.quaternion.copy(camera);
      this.pose.rotateZ(d.angle);
      this.pose.scale.set(d.width * size, d.height * size, 1);
      this.pose.updateMatrix();
      this.mesh.setMatrixAt(count, this.pose.matrix);
      this.mesh.setColorAt(count++, this.color.setHex(d.tone));
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }
}
