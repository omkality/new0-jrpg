import * as T from "three";
import { prop } from "../asset-store";
import { flaskModel, FLASK_COLORS, lootGlow } from "../gear-visuals";
import { box, mesh, turn, beam, batch, v, type Mat } from "./scenery-mesh";
import { OssuaryScenery } from "./ossuary-scenery";
import {
  BELL,
  RELIQUARY,
  CAIRN,
  VOTIVE,
  CHOIR_PORTAL,
  REAR_PORTAL,
  MORTUARY_EXIT,
  SIGNS,
  INSCRIPTION,
  STRIKES,
  type Sign,
} from "./bell-quest";
import type { ForestChapter } from "./forest";

function surface(
  base: number,
  grain: string,
  metalness: number,
  grainWidth: number,
) {
  const image = document.createElement("canvas");
  image.width = image.height = 96;
  const ctx = image.getContext("2d")!;
  ctx.fillStyle = new T.Color(base).getStyle();
  ctx.fillRect(0, 0, 96, 96);
  let seed = 73519;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 1700; i++) {
    ctx.globalAlpha = 0.08 + 0.23 * rnd();
    ctx.fillStyle = i % 3 ? grain : "#261f22";
    ctx.fillRect(rnd() * 96, rnd() * 96, 1 + rnd() * grainWidth, 1 + rnd() * 2);
  }
  const t = new T.CanvasTexture(image);
  t.colorSpace = T.SRGBColorSpace;
  t.wrapS = t.wrapT = T.RepeatWrapping;
  return new T.MeshStandardMaterial({ map: t, metalness, roughness: 0.82 });
}
function engraved(signs: readonly Sign[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 64 * signs.length;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#353c37";
  ctx.fillRect(0, 0, canvas.width, 64);
  ctx.strokeStyle = "#baa476";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, canvas.width - 4, 60);
  for (const [i, id] of signs.entries()) {
    ctx.save();
    ctx.translate(64 * i + 10, 10);
    ctx.scale(1.85, 1.85);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.9;
    ctx.strokeStyle = "#eddda4";
    ctx.stroke(new Path2D(SIGNS[id].path));
    ctx.restore();
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return new T.MeshStandardMaterial({
    map,
    emissiveMap: map,
    emissive: 0x615e47,
    roughness: 0.83,
  });
}

function bellTongue(group: T.Group, metal: Mat, cord: Mat) {
  turn(
    group,
    metal,
    [
      [0, -1.13],
      [0.054, -1.09],
      [0.09, -1.03],
      [0.135, -0.94],
      [0.13, -0.87],
      [0.052, -0.78],
      [0.033, -0.16],
      [0.067, -0.12],
      [0.057, -0.08],
      [0, -0.075],
    ],
    0,
    0,
    0,
    20,
  );
  const eye = mesh(
    group,
    new T.TorusGeometry(0.068, 0.021, 5, 14),
    metal,
    0,
    -0.055,
    0,
  );
  eye.rotation.y = 0.2;
  for (const y of [-0.28, -0.25, -0.22])
    turn(
      group,
      cord,
      [
        [0.044, 0],
        [0.047, 0.025],
      ],
      0,
      y,
      0,
      12,
    );
}

export class CourtScenery {
  readonly root = new T.Group();
  private bronze = surface(0x746640, "#73918a", 0.36, 4);
  private rim = surface(0x928058, "#d9ca91", 0.46, 5);
  private iron = surface(0x4c5053, "#89968b", 0.29, 3);
  private timber = surface(0x514235, "#ae9774", 0.03, 18);
  private wax = new T.MeshStandardMaterial({
    color: 0xbab097,
    roughness: 0.99,
  });
  private velvet = surface(0x653938, "#885453", 0, 3);
  private bell = new T.Group();
  private clapper = new T.Group();
  private lid = new T.Group();
  private tongue = new T.Group();
  private grate = new T.Group();
  private stations = new T.Group();
  private shrine = new T.Group();
  private lamps: T.Group[] = [];
  private keys = new Map<Sign, T.Group>();
  private grave = new T.Group();
  private slab = new T.Group();
  private pike: T.Object3D = new T.Group();
  private votive = new T.Group();
  private regenBottle = flaskModel(FLASK_COLORS.regeneration);
  private ember = new T.Group();
  private fourth = new T.Group();
  private rearGrate = new T.Group();
  private ossuary: OssuaryScenery;
  private lastPress = 0;
  private push = 0;
  constructor() {
    this.root.name = "BellChapterFurnishings";
    this.buildBell();
    this.buildShrine();
    this.buildSecrets();
    this.buildGrate(CHOIR_PORTAL, this.grate, true);
    this.buildGrate(REAR_PORTAL, this.rearGrate, true);
    this.buildGrate(MORTUARY_EXIT, new T.Group(), false);
    this.ossuary = new OssuaryScenery(
      {
        bronze: this.bronze,
        iron: this.iron,
        rim: this.rim,
        timber: this.timber,
        velvet: this.velvet,
        wax: this.wax,
      },
      this.lamps[0],
    );
    this.root.add(this.ossuary.root);
  }
  private buildGrate(
    portal: typeof CHOIR_PORTAL | typeof REAR_PORTAL | typeof MORTUARY_EXIT,
    bars: T.Group,
    moving: boolean,
  ) {
    const { z, base, radius } = portal;
    bars.position.set(0, base, z);
    this.root.add(bars);
    const span = radius - 0.11;
    for (let i = -5; i <= 5; i++) {
      const x = (i * span) / 5;
      const top =
        portal.stem + Math.sqrt(Math.max(0, radius * radius - x * x)) - 0.12;
      box(bars, this.iron, x, (top + 0.18) / 2, 0, 0.095, top - 0.18, 0.105);
      const foot = mesh(
        bars,
        new T.ConeGeometry(0.082, 0.23, 4),
        this.rim,
        x,
        0.1,
        0,
      );
      foot.rotation.x = Math.PI;
    }
    for (const y of [0.5, 1.65, 2.52])
      box(bars, this.iron, 0, y, 0.015, span * 2 + 0.15, 0.104, 0.15);
    batch(bars);
    if (moving) {
      const guides = new T.Group();
      guides.position.set(0, base, z);
      this.root.add(guides);
      for (const x of [-span, span]) {
        box(guides, this.iron, x, 1.6, 0.1, 0.15, 3.2, 0.11);
        for (const y of [0.55, 2.45])
          box(guides, this.rim, x, y, 0.17, 0.23, 0.13, 0.12);
      }
      batch(guides);
    }
  }
  private buildBell() {
    const g = this.stations;
    g.position.set(BELL.x, BELL.y, BELL.z);
    this.root.add(g);
    for (const side of [-1, 1]) {
      const x = side * 1.07;
      box(g, this.timber, x, 1.62, 0, 0.21, 2.13, 0.23);
      box(g, this.iron, x, 0.66, 0, 0.27, 0.2, 0.33);
      beam(g, this.timber, v(x, 1.98, 0), v(side * 0.5, 2.53, 0), 0.135, 0.15);
      box(g, this.iron, x, 2.52, 0, 0.27, 0.18, 0.29);
    }
    box(g, this.timber, 0, 2.64, 0, 2.5, 0.21, 0.27);
    box(g, this.iron, 0, 2.48, 0, 1.93, 0.09, 0.11);
    this.bell.position.set(0, 2.48, 0);
    g.add(this.bell);
    box(this.bell, this.timber, 0, -0.09, 0, 1.29, 0.18, 0.23);
    turn(
      this.bell,
      this.bronze,
      [
        [0.09, -0.08],
        [0.26, -0.18],
        [0.32, -0.32],
        [0.37, -0.71],
        [0.45, -0.91],
        [0.58, -1.06],
        [0.57, -1.14],
        [0.48, -1.14],
        [0.36, -0.93],
        [0.25, -0.49],
        [0.16, -0.29],
        [0, -0.27],
      ].reverse(),
      0,
      0,
      0,
      32,
    );
    for (const [y, r] of [
      [-1.06, 0.56],
      [-0.88, 0.44],
      [-0.33, 0.325],
    ]) {
      const band = mesh(
        this.bell,
        new T.TorusGeometry(r, 0.021, 5, 32),
        this.rim,
        0,
        y,
        0,
      );
      band.rotation.x = Math.PI / 2;
    }
    this.clapper.position.y = -0.29;
    this.bell.add(this.clapper);
    bellTongue(this.clapper, this.rim, this.velvet);
    const rope = mesh(
      g,
      new T.CylinderGeometry(0.022, 0.026, 1.29, 7),
      this.timber,
      0.82,
      1.76,
      0.09,
    );
    rope.rotation.z = -0.065;
    const pull = mesh(
      g,
      new T.TorusGeometry(0.091, 0.028, 5, 14),
      this.iron,
      0.77,
      1.05,
      0.09,
    );
    pull.rotation.y = 0.1;
    // All three lamps rest on a single votive shelf, on the stone plinth.
    box(g, this.timber, 0, 0.655, 0.12, 1.86, 0.2, 0.92);
    const light = document.createElement("canvas");
    light.width = light.height = 32;
    const ctx = light.getContext("2d")!,
      halo = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    halo.addColorStop(0, "rgba(255,219,152,0.75)");
    halo.addColorStop(0.3, "rgba(253,173,82,0.32)");
    halo.addColorStop(1, "rgba(234,150,69,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 32, 32);
    const glowMap = new T.CanvasTexture(light);
    glowMap.colorSpace = T.SRGBColorSpace;
    const glow = new T.MeshBasicMaterial({
      map: glowMap,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const fire = new T.MeshBasicMaterial({ color: 0xffdfa2 });
    for (const x of [-0.7, -0.24, 0.65]) {
      turn(
        g,
        this.bronze,
        [
          [0, 0],
          [0.12, 0],
          [0.11, 0.05],
          [0.15, 0.09],
          [0.15, 0.13],
          [0.095, 0.11],
        ],
        x,
        0.755,
        0.34,
        14,
      );
      turn(
        g,
        this.wax,
        [
          [0.066, 0],
          [0.067, 0.11],
          [0.052, 0.119],
          [0, 0.103],
        ],
        x,
        0.857,
        0.34,
        12,
      );
      box(g, this.iron, x, 0.984, 0.34, 0.016, 0.048, 0.016);
      const flame = new T.Group();
      flame.position.set(x, 0.999, 0.34);
      const core = new T.Mesh(
        new T.LatheGeometry(
          [
            new T.Vector2(0, 0),
            new T.Vector2(0.032, 0.038),
            new T.Vector2(0.026, 0.086),
            new T.Vector2(0, 0.16),
          ],
          8,
        ),
        fire,
      );
      core.rotation.z = 0.08;
      flame.add(core);
      const veil = new T.Mesh(new T.PlaneGeometry(0.41, 0.37), glow);
      veil.position.set(0, 0.066, 0.035);
      flame.add(veil);
      flame.visible = false;
      this.lamps.push(flame);
    }
    box(g, this.rim, 0, 0.64, 0.578, 1.1, 0.26, 0.045);
    mesh(
      g,
      new T.PlaneGeometry(1.05, 0.23),
      engraved(INSCRIPTION),
      0,
      0.64,
      0.604,
    );
    batch(this.clapper);
    batch(this.bell);
    batch(g);
    g.add(...this.lamps);
  }
  private buildShrine() {
    const g = this.shrine;
    g.position.set(RELIQUARY.x, RELIQUARY.y, RELIQUARY.z);
    this.root.add(g);
    for (const x of [-0.48, 0.48])
      for (const z of [-0.26, 0.26]) {
        box(g, this.timber, x, 0.32, z, 0.13, 0.64, 0.13);
        box(g, this.iron, x, 0.085, z, 0.17, 0.17, 0.17);
      }
    box(g, this.timber, 0, 0.61, 0, 1.35, 0.15, 0.85);
    box(g, this.velvet, 0, 0.76, 0, 1.03, 0.15, 0.5);
    for (const x of [-0.56, 0.56])
      box(g, this.bronze, x, 0.83, 0, 0.13, 0.34, 0.7);
    for (const z of [-0.31, 0.31])
      box(g, this.bronze, 0, 0.83, z, 1.17, 0.34, 0.09);
    this.lid.position.set(0, 1.0, -0.34);
    g.add(this.lid);
    box(this.lid, this.timber, 0, 0.055, 0.34, 1.24, 0.12, 0.7);
    for (const x of [-0.51, 0, 0.51])
      box(this.lid, this.rim, x, 0.12, 0.34, 0.055, 0.035, 0.71);
    box(this.lid, this.velvet, 0, -0.007, 0.34, 1.02, 0.025, 0.54);
    this.tongue.position.set(0.49, 0.935, -0.08);
    this.tongue.rotation.set(0, -0.17, -Math.PI / 2 + 0.04);
    g.add(this.tongue);
    bellTongue(this.tongue, this.rim, this.velvet);
    const order: Sign[] = ["thorn", "sun", "wave"];
    for (const [i, id] of order.entries()) {
      const key = new T.Group();
      key.position.set((i - 1) * 0.37, 0.835, 0.38);
      g.add(key);
      box(key, this.rim, 0, 0, 0, 0.32, 0.3, 0.1);
      mesh(key, new T.PlaneGeometry(0.263, 0.253), engraved([id]), 0, 0, 0.053);
      batch(key);
      this.keys.set(id, key);
    }
    batch(this.lid);
    batch(this.tongue);
    batch(g);
  }
  private buildSecrets() {
    const stone = surface(0x58646c, "#abb3ad", 0.06, 12),
      chalk = surface(0xacb8ba, "#cdd0c7", 0.04, 4);
    const g = this.grave;
    g.position.set(CAIRN.x, CAIRN.y, CAIRN.z);
    this.root.add(g, this.votive);
    box(g, stone, 0, 0.12, 0, 1.1, 0.24, 2.24);
    box(g, this.velvet, 0, 0.37, 0, 0.83, 0.13, 1.97);
    for (const side of [-1, 1]) {
      box(g, stone, side * 0.49, 0.37, 0, 0.13, 0.35, 2.11);
      box(g, stone, 0, 0.37, side * 1, 0.91, 0.35, 0.13);
    }
    this.slab.position.set(-0.55, 0.56, 0);
    box(this.slab, stone, 0.55, 0.065, 0, 1.12, 0.13, 2.16);
    for (const x of [0.39, 0.55, 0.71])
      beam(
        this.slab,
        chalk,
        v(x - 0.026, 0.139, 0.71),
        v(x + 0.039, 0.139, 0.93),
        0.03,
        0.014,
      );
    // Inlaid willow twig splits into the same three strokes seen on the lid edge.
    beam(
      this.slab,
      this.rim,
      v(0.39, 0.141, -0.59),
      v(0.649, 0.141, 0.4),
      0.022,
      0.012,
    );
    for (let i = 0; i < 5; i++) {
      const h = -0.43 + i * 0.15,
        x = 0.44 + i * 0.037;
      beam(
        this.slab,
        this.rim,
        v(x, 0.141, h),
        v(x - 0.107, 0.141, h + 0.124),
        0.017,
        0.012,
      );
      beam(
        this.slab,
        this.rim,
        v(x, 0.141, h + 0.045),
        v(x + 0.09, 0.141, h + 0.13),
        0.016,
        0.012,
      );
    }
    this.pike = prop("weapon-spear");
    const bounds = new T.Box3().setFromObject(this.pike),
      length = bounds.max.y - bounds.min.y;
    const scale = 1.89 / length;
    this.pike.scale.setScalar(scale);
    this.pike.rotation.x = Math.PI / 2;
    this.pike.position.set(
      0,
      0.446,
      -(bounds.max.y + bounds.min.y) * scale * 0.5,
    );
    batch(this.slab);
    batch(g);
    g.add(this.slab, this.pike);
    const a = this.votive;
    a.position.set(VOTIVE.x, VOTIVE.y, VOTIVE.z);
    box(a, stone, 0, 0.1, 0, 0.78, 0.2, 0.63);
    turn(
      a,
      stone,
      [
        [0.28, 0.14],
        [0.23, 0.22],
        [0.165, 0.32],
        [0.13, 0.57],
        [0.21, 0.67],
        [0.28, 0.7],
      ],
      0,
      0,
      0,
      12,
    );
    turn(
      a,
      this.iron,
      [
        [0.24, 0.69],
        [0.28, 0.72],
        [0.25, 0.76],
      ],
      0,
      0,
      0,
      20,
    );
    for (const angle of [0, 0.48, 0.96, 1.44, 1.92, 2.4, 2.88]) {
      const x = 0.21 * Math.cos(angle),
        z = -0.2 * Math.sin(angle);
      beam(
        a,
        this.iron,
        v(x, 0.73, z),
        v(x * 0.94, 0.91, z * 0.95),
        0.022,
        0.02,
      );
    }
    turn(
      a,
      this.wax,
      [
        [0.055, 0.73],
        [0.052, 0.795],
        [0.047, 0.806],
      ],
      0,
      0,
      0,
      12,
    );
    const flame = new T.MeshStandardMaterial({
      color: 0xffedbc,
      emissive: 0xffcd87,
      emissiveIntensity: 2.3,
    });
    turn(
      this.ember,
      flame,
      [
        [0.001, 0],
        [0.023, 0.029],
        [0.016, 0.067],
        [0.001, 0.124],
      ],
      0,
      0,
      0,
      9,
    );
    this.ember.position.y = 0.808;
    this.ember.rotation.z = 0.5;
    batch(a);
    batch(this.ember);
    a.add(this.ember);
    this.regenBottle.scale.setScalar(0.86);
    this.regenBottle.position.set(0.24, 0.2, 0.18);
    const glint = lootGlow(0x8ab7a1);
    glint.position.y = 0.19;
    glint.scale.setScalar(0.46);
    glint.material.opacity = 0.32;
    this.regenBottle.add(glint);
    a.add(this.regenBottle);
    const taper = new T.Group();
    taper.position.set(-1.03, 0.665, 0.47);
    turn(
      taper,
      this.iron,
      [
        [0.1, 0],
        [0.07, 0.055],
        [0.085, 0.09],
      ],
      0,
      0,
      0,
      12,
    );
    turn(
      taper,
      this.wax,
      [
        [0.044, 0.07],
        [0.04, 0.175],
      ],
      0,
      0,
      0,
      12,
    );
    this.fourth = this.ember.clone(true);
    this.fourth.position.set(0, 0.177, 0);
    batch(taper);
    taper.add(this.fourth);
    this.stations.add(taper);
  }
  update(dt: number, game: ForestChapter) {
    const near = game.player.z < -10;
    this.root.visible = near;
    if (!near) return;
    this.rearGrate.position.y = T.MathUtils.damp(
      this.rearGrate.position.y,
      REAR_PORTAL.base + (game.openDoors.has("ossuary") ? 3.4 : 0),
      3.7,
      dt,
    );
    this.ossuary.update(dt, game);
    this.stations.visible = Math.abs(game.player.z - BELL.z) < 37;
    this.grave.visible = Math.abs(game.player.z - CAIRN.z) < 30;
    this.votive.visible = Math.abs(game.player.z - VOTIVE.z) < 28;
    this.slab.rotation.z = T.MathUtils.damp(
      this.slab.rotation.z,
      game.cairnOpen ? 1.83 : 0,
      4.6,
      dt,
    );
    this.pike.visible = !game.foundPike;
    this.regenBottle.visible = !game.foundRegen;
    this.ember.scale.setScalar(
      game.sheltered ? 1 : 0.42 + 0.1 * Math.sin(game.elapsed * 6),
    );
    this.ember.rotation.z = game.sheltered ? 0.04 : 0.62;
    this.fourth.visible = game.sheltered && game.ringTime > 0.65;
    this.shrine.visible = Math.abs(game.player.z - RELIQUARY.z) < 25;
    this.grate.position.y = T.MathUtils.damp(
      this.grate.position.y,
      CHOIR_PORTAL.base + (game.guardianOutcome ? 3.4 : 0),
      3.7,
      dt,
    );
    this.lid.rotation.x = T.MathUtils.damp(
      this.lid.rotation.x,
      game.hasClapper ? -1.61 : 0,
      5.5,
      dt,
    );
    this.tongue.visible = !game.hasClapper || game.screen === "relic";
    if (game.presses !== this.lastPress) {
      this.lastPress = game.presses;
      this.push = 1;
    }
    this.push = Math.max(0, this.push - 3 * dt);
    for (const [id, key] of this.keys) {
      const latched = INSCRIPTION.indexOf(id) < game.marks;
      key.position.z =
        0.38 -
        (latched ? 0.035 : 0) -
        (id === game.lastMark ? this.push * 0.027 : 0);
      key.position.y = 0.835 - (latched ? 0.034 : 0);
    }
    this.clapper.visible = game.clapperMounted;
    let sway = 0,
      lit = 0;
    if (game.vow)
      for (const strike of STRIKES[game.vow]) {
        const d = game.ringTime - strike;
        if (d >= 0) {
          sway += 0.31 * Math.exp(-d * 1.5) * Math.sin(d * 8.5);
          if (d > 0.23) lit++;
        }
      }
    this.bell.rotation.x = sway;
    this.clapper.rotation.x = -1.55 * sway;
    this.lamps[1].visible = lit > 0;
    this.lamps[0].visible = lit > 1;
    this.lamps[2].visible = lit > 2;
  }
}
