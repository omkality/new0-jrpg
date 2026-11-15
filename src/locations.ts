import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assetUrl } from "./assets";

export const LOCATIONS = {
  chapel: {
    name: "Малахитовый неф",
    fog: 0x162c2b,
    density: 0.062,
    sky: 0x142524,
    ambient: 0x9bbcb0,
    ground: 0x18191b,
    fill: 0x92b2a4,
    sun: 0xc2c7ae,
    sunPower: 0.7,
    torch: 7,
  },
  roofs: {
    name: "Багровые крыши",
    fog: 0x443440,
    density: 0.026,
    sky: 0x66515d,
    ambient: 0xb4a0b6,
    ground: 0x242027,
    fill: 0xb6a4ad,
    sun: 0xf0baa4,
    sunPower: 0.82,
    torch: 5,
  },
  courtyard: {
    name: "Двор забвения",
    fog: 0x54604b,
    density: 0.042,
    sky: 0x818873,
    ambient: 0xb6c2a1,
    ground: 0x1b2018,
    fill: 0xb8c0a0,
    sun: 0xd3d6b8,
    sunPower: 0.72,
    torch: 4,
  },
} as const;
export type LocationId = keyof typeof LOCATIONS;
export const LOCATION_IDS = Object.keys(LOCATIONS) as LocationId[];
export const isLocation = (id: string | null): id is LocationId =>
  !!id && Object.hasOwn(LOCATIONS, id);

// A visual stage only. All three use the same combat rules and walkable bounds.
export class LocationStage {
  group = new THREE.Group();
  gate = new THREE.Group();
  obstacles: { x: number; z: number; hx: number; hz: number }[] = [];
  background: THREE.Color | THREE.Texture;
  private batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private flickerLights: THREE.PointLight[] = [];
  private flames: THREE.Mesh[] = [];
  private beamMaterials: THREE.MeshBasicMaterial[] = [];
  private wall: THREE.MeshStandardMaterial;
  private stone: THREE.MeshStandardMaterial;
  private column: THREE.MeshStandardMaterial;
  private floor: THREE.MeshStandardMaterial;
  private metal: THREE.MeshStandardMaterial;
  private dark: THREE.MeshStandardMaterial;
  private bark?: THREE.MeshStandardMaterial;
  private leaves?: THREE.MeshStandardMaterial;
  constructor(
    public id: LocationId,
    loader: THREE.TextureLoader,
    anisotropy: number,
  ) {
    const spec = LOCATIONS[id];
    this.background =
      id === "chapel" ? new THREE.Color(spec.sky) : this.skyTexture(id);
    const material = (name: string, rx: number, ry: number, tint: number) => {
      const map = loader.load(assetUrl(`/assets/dungeon/${name}.png`));
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(rx, ry);
      map.anisotropy = Math.min(4, anisotropy);
      return new THREE.MeshStandardMaterial({
        map,
        color: tint,
        roughness: 1,
        metalness: 0,
        vertexColors: true,
      });
    };
    const chapel = id === "chapel",
      garden = id === "courtyard";
    this.wall = material(
      "TEX_Wall_03",
      4,
      2,
      chapel ? 0x8fa59c : garden ? 0x909778 : 0xa69599,
    );
    this.stone = material(
      "TEX_Arch_02",
      1,
      1,
      chapel ? 0xb4c4ad : garden ? 0xb4b293 : 0xb9aaa2,
    );
    this.column = material(
      "TEX_Pillar_01",
      1,
      2,
      chapel ? 0x9baf9f : garden ? 0xa3ac8d : 0xaa969c,
    );
    this.floor = material(
      "TEX_Ground_04",
      12,
      20,
      chapel ? 0x829e94 : garden ? 0x969c75 : 0x8d7f8c,
    );
    this.floor.bumpMap = this.floor.map;
    this.floor.bumpScale = 0.028;
    this.metal = new THREE.MeshStandardMaterial({
      color: 0x353b3b,
      roughness: 0.92,
      metalness: 0.22,
      vertexColors: true,
    });
    this.dark = new THREE.MeshStandardMaterial({
      color: chapel ? 0x313b36 : 0x3e3540,
      roughness: 1,
      vertexColors: true,
    });
    this.group.add(new THREE.HemisphereLight(spec.ambient, spec.ground, 0.42));
    const sun = new THREE.DirectionalLight(spec.sun, spec.sunPower);
    sun.position.set(-5, 10, -4);
    this.group.add(sun);
    const bounce = new THREE.DirectionalLight(spec.fill, 0.18);
    bounce.position.set(5, 4, 8);
    this.group.add(bounce);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12.8, 28, 30, 60),
      this.floor,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -3;
    this.part(floor);
    if (chapel) this.chapel();
    else if (garden) this.courtyard();
    else this.roofs();
    this.relics();
    this.exit();
    this.rubble();
    this.flush();
  }
  update(time: number, dt: number, opened: boolean) {
    for (let i = 0; i < this.beamMaterials.length; i++)
      this.beamMaterials[i].opacity = 0.06 + Math.sin(time * 0.55 + i) * 0.008;
    for (let i = 0; i < this.flickerLights.length; i++)
      this.flickerLights[i].intensity =
        LOCATIONS[this.id].torch +
        Math.sin(time * 12 + i * 3) * 0.35 +
        Math.sin(time * 19 + i) * 0.18;
    for (let i = 0; i < this.flames.length; i++) {
      this.flames[i].scale.set(
        1 + Math.sin(time * 14 + i) * 0.07,
        1 + Math.sin(time * 11 + i * 4) * 0.12,
        1,
      );
      this.flames[i].rotation.z = Math.sin(time * 7 + i) * 0.07;
    }
    this.gate.position.y = THREE.MathUtils.damp(
      this.gate.position.y,
      opened ? 4.4 : 0,
      2,
      dt,
    );
  }
  private chapel() {
    const { wall, stone, column, dark } = this;
    for (const x of [-6.25, 6.25]) this.box(0.5, 10, 20, x, 5, 0, wall);
    this.box(12.8, 0.4, 20, 0, 9.6, 0, dark);
    for (const z of [-7, 0, 6.7]) {
      for (const x of [-4.2, 4.2]) {
        this.cylinder(0.28, 0.34, 5.2, 20, x, 2.6, z, column);
        this.cylinder(0.5, 0.56, 0.2, 20, x, 0.1, z, stone);
        this.cylinder(0.5, 0.4, 0.22, 20, x, 5.2, z, stone);
        this.obstacles.push({ x, z, hx: 0.38, hz: 0.38 });
      }
      this.arch(4.22, 5.3, 0.26, z, stone);
      this.arch(4.36, 5.3, 0.08, z + 0.18, stone);
    }
    const glass = new THREE.MeshBasicMaterial({
      map: this.pattern("glass"),
      color: 0x829a83,
      toneMapped: false,
    });
    for (const sign of [-1, 1])
      for (const z of [-3.5, 3.4]) {
        for (const off of [-0.77, 0, 0.77]) {
          const shape = new THREE.Shape();
          shape.moveTo(-0.3, 0);
          shape.lineTo(-0.3, 3.6);
          shape.quadraticCurveTo(-0.3, 4.1, 0, 4.6);
          shape.quadraticCurveTo(0.3, 4.1, 0.3, 3.6);
          shape.lineTo(0.3, 0);
          shape.closePath();
          const w = new THREE.Mesh(new THREE.ShapeGeometry(shape), glass);
          w.position.set(sign * 5.96, 2.1, z + off);
          w.rotation.y = sign < 0 ? Math.PI / 2 : -Math.PI / 2;
          this.part(w);
          this.box(0.22, 4.2, 0.12, sign * 5.87, 4, z + off - 0.38, stone);
          this.box(0.22, 4.2, 0.12, sign * 5.87, 4, z + off + 0.38, stone);
        }
        this.box(0.3, 0.22, 2.9, sign * 5.88, 2.0, z, stone);
        this.beam(sign, z);
      }
    const cloth = new THREE.MeshStandardMaterial({
      map: this.pattern("cloth"),
      color: 0x63383e,
      roughness: 1,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 13), cloth);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.009, -0.6);
    this.part(rug);
    for (const sign of [-1, 1])
      for (const z of [-6, 5.8]) {
        const banner = new THREE.Mesh(
          new THREE.PlaneGeometry(0.86, 2.1, 2, 6),
          cloth,
        );
        banner.position.set(sign * 4.2, 4, z + 0.1);
        this.part(banner);
      }
    for (const sign of [-1, 1])
      for (const z of [-5.9, 2]) this.torch(sign * 5.6, z, this.metal);
    this.box(12.8, 9.6, 0.4, 0, 4.8, 9, wall);
    this.box(3.6, 1.0, 1.7, 0, 0.5, -11, stone);
  }
  private roofs() {
    const { stone, metal, wall, dark } = this;
    for (const sign of [-1, 1]) {
      this.box(0.42, 0.65, 22, sign * 5.9, 0.325, -1.2, stone);
      this.box(0.62, 0.12, 22, sign * 5.9, 0.72, -1.2, stone);
      for (let z = -8; z < 9; z += 0.7) {
        this.cylinder(0.022, 0.029, 1.08, 6, sign * 5.91, 1.2, z, metal);
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.055, 0.16, 5),
          metal,
        );
        spike.position.set(sign * 5.91, 1.82, z);
        this.part(spike);
      }
      this.box(0.04, 0.04, 19, sign * 5.91, 1.48, 0, metal);
      this.box(0.04, 0.04, 19, sign * 5.91, 1.08, 0, metal);
      for (const z of [-6.8, 6.4]) this.turret(sign * 7.1, z, 1.45, 4.6, stone);
      for (const z of [-5.9, 2])
        this.box(0.48, 2.7, 0.5, sign * 6.08, 1.35, z, wall);
      this.torch(sign * 5.6, 2, metal);
    }
    // Receding castle masses remain outside the playable terrace.
    for (let i = 0; i < 11; i++) {
      const x = (i % 2 ? -1 : 1) * (13 + (i % 4) * 6),
        z = -15 - ((i * 7) % 29),
        h = 5 + ((i * 11) % 13);
      this.box(5.3, h, 5.3, x, h / 2 - 3, z, wall);
      this.facade(x, z + 2.69, 4.7, h - 3, wall);
      this.turret(x + 2, z - 1, 1.25, h + 1, dark);
      for (let c = 0; c < 4; c++)
        this.box(0.55, 0.85, 0.7, x - 2 + c * 1.33, h - 2.7, z + 2.5, stone);
    }
    this.facade(0, -25, 24, 15, wall);
    this.turret(-11, -23, 2.1, 17, stone);
    this.turret(11, -23, 2.1, 20, stone);
    for (const sign of [-1, 1]) {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, 0.22, 20),
        this.floor,
      );
      roof.rotation.z = sign * 0.42;
      roof.position.set(sign * 8.4, -0.4, 0);
      this.part(roof);
    }
  }
  private courtyard() {
    const { stone, wall, column } = this;
    for (const sign of [-1, 1]) {
      this.box(0.55, 1.5, 20, sign * 6.2, 0.75, 0, wall);
      for (const z of [-6.7, 0.1, 6.4]) {
        this.cylinder(
          0.31,
          0.39,
          z === 0.1 ? 3.6 : 5.2,
          18,
          sign * 4.5,
          z === 0.1 ? 1.8 : 2.6,
          z,
          column,
        );
        this.cylinder(0.54, 0.61, 0.22, 18, sign * 4.5, 0.11, z, stone);
        this.obstacles.push({ x: sign * 4.5, z, hx: 0.4, hz: 0.4 });
      }
      for (const z of [-5.8, 3.8]) this.tree(sign * (7.7 + (z > 0 ? 1 : 0)), z);
    }
    this.arch(4.52, 5.3, 0.32, -6.7, stone);
    // Broken, lower arches and empty upper window bays.
    this.arch(4.52, 5.3, 0.23, 6.4, stone);
    for (const sign of [-1, 1])
      for (const z of [-7.2, 5.8]) {
        this.box(0.6, 8, 2.7, sign * 7.3, 4, z, wall);
        this.box(0.7, 0.28, 10, sign * 7.3, 6.4, 0, stone);
      }
    this.vegetation();
    this.facade(0, -16, 21, 11, wall);
    this.facade(-12, -5, 7, 10, wall);
    this.facade(12, -7, 7, 13, wall);
    for (const x of [-10, -6, 6, 10]) this.tree(x, -12 - (Math.abs(x) % 3));
    for (const sign of [-1, 1]) {
      this.box(0.55, 2.8, 0.6, sign * 6.1, 1.4, 2, wall);
      this.torch(sign * 5.6, 2, this.metal);
    }
    this.beam(-1, -4);
  }
  private turret(
    x: number,
    z: number,
    r: number,
    h: number,
    m: THREE.Material,
  ) {
    this.cylinder(r, r * 1.09, h, 20, x, h / 2 - 1.1, z, m);
    this.cylinder(r * 1.16, r * 1.06, 0.2, 20, x, h - 1.1, z, this.stone);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(r * 1.22, r * 2.6, 20),
      this.dark,
    );
    roof.position.set(x, h - 1.0 + r * 1.3, z);
    this.part(roof);
  }
  private tree(x: number, z: number) {
    const bark = (this.bark ??= new THREE.MeshStandardMaterial({
      map: this.pattern("bark"),
      color: 0x5a5947,
      roughness: 1,
      vertexColors: true,
    }));
    this.cylinder(0.18, 0.48, 8, 12, x, 4, z, bark);
    for (let i = 0; i < 5; i++) {
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.13, 3, 8),
        bark,
      );
      branch.position.set(
        x + Math.sin(i * 4) * 0.6,
        5 + i * 0.45,
        z + Math.cos(i * 4) * 0.6,
      );
      branch.rotation.set(Math.cos(i * 4) * 0.8, 0, Math.sin(i * 4) * 0.8);
      this.part(branch);
    }
    const leaves = (this.leaves ??= new THREE.MeshStandardMaterial({
      map: this.pattern("leaves"),
      color: 0x718354,
      roughness: 1,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      vertexColors: true,
    }));
    for (let i = 0; i < 26; i++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.8), leaves);
      leaf.position.set(
        x + Math.sin(i * 2.4) * (1 + (i % 3) * 0.7),
        6.6 + (i % 4) * 0.5,
        z + Math.cos(i * 2.4) * (1 + (i % 3) * 0.7),
      );
      leaf.rotation.set((i % 3) * 0.7, i * 0.9, (i % 2) * 0.25);
      this.part(leaf);
    }
  }
  private vegetation() {
    const grass = new THREE.MeshStandardMaterial({
      map: this.pattern("grass"),
      color: 0x748254,
      roughness: 1,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    for (let i = 0; i < 72; i++) {
      const sign = i % 2 ? 1 : -1,
        x = sign * (3.7 + (i % 5) * 0.43),
        z = -7.5 + ((i * 73) % 160) / 10;
      for (let j = 0; j < 2; j++) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.7, 0.35 + (i % 3) * 0.1),
          grass,
        );
        m.position.set(x, 0.19, z);
        m.rotation.y = i * 1.3 + (j * Math.PI) / 2;
        this.part(m);
      }
    }
    const moss = new THREE.MeshStandardMaterial({
      map: this.pattern("leaves"),
      color: 0x7b8659,
      roughness: 1,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    for (const sign of [-1, 1])
      for (const z of [-5, -0.5, 4.5]) {
        const patch = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.8), moss);
        patch.rotation.x = -Math.PI / 2;
        patch.rotation.z = sign * z * 0.2;
        patch.position.set(sign * 4.1, 0.013, z);
        this.part(patch);
      }
  }
  private facade(
    x: number,
    z: number,
    width: number,
    height: number,
    m: THREE.Material,
  ) {
    this.box(width, height, 0.6, x, height / 2, z - 0.35, m);
    for (let y = 2.2; y < height - 1.7; y += 3.6) {
      this.box(width + 0.3, 0.18, 0.9, x, y - 0.6, z, this.stone);
      for (let dx = -width / 2 + 1; dx < width / 2 - 0.7; dx += 2.3)
        this.lancet(x + dx, y, z + 0.02, 0.8, 2.2);
    }
    for (let dx = -width / 2 + 0.3; dx < width / 2; dx += 1.4)
      this.box(0.65, 0.8, 0.9, x + dx, height + 0.4, z, this.stone);
    for (let dx = -width / 2; dx <= width / 2; dx += 4.6)
      this.box(0.35, height + 0.2, 1.05, x + dx, height / 2, z, this.stone);
  }
  private lancet(x: number, y: number, z: number, w: number, h: number) {
    const pointed = (s: THREE.Shape | THREE.Path, ww: number, hh: number) => {
      s.moveTo(-ww / 2, 0);
      s.lineTo(-ww / 2, hh * 0.68);
      s.quadraticCurveTo(-ww / 2, hh * 0.84, 0, hh);
      s.quadraticCurveTo(ww / 2, hh * 0.84, ww / 2, hh * 0.68);
      s.lineTo(ww / 2, 0);
      s.closePath();
    };
    const pane = new THREE.Shape();
    pointed(pane, w, h);
    const inset = new THREE.Mesh(new THREE.ShapeGeometry(pane), this.dark);
    inset.position.set(x, y, z + 0.02);
    this.part(inset);
    const frame = new THREE.Shape();
    pointed(frame, w + 0.2, h + 0.16);
    const hole = new THREE.Path();
    pointed(hole, w, h);
    frame.holes.push(hole);
    const border = new THREE.Mesh(
      new THREE.ExtrudeGeometry(frame, {
        depth: 0.1,
        bevelEnabled: false,
        curveSegments: 8,
      }),
      this.stone,
    );
    border.position.set(x, y, z + 0.03);
    this.part(border);
    this.box(0.045, h * 0.75, 0.09, x, y + h * 0.38, z + 0.16, this.stone);
  }
  private exit() {
    const { wall, stone, metal } = this;
    const height =
      this.id === "roofs" ? 2.7 : this.id === "courtyard" ? 3.8 : 6.8;
    for (const sign of [-1, 1]) {
      this.box(3.8, height, 0.6, sign * 4.4, height / 2, -8.5, wall);
      this.box(4.0, 0.18, 0.82, sign * 4.4, height, -8.5, stone);
      if (this.id !== "chapel")
        for (let i = 0; i < 3; i++)
          this.box(
            0.65,
            0.55 + (this.id === "courtyard" ? i * 0.2 : 0),
            0.78,
            sign * (3.0 + i * 1.1),
            height + 0.36,
            -8.5,
            stone,
          );
      if (this.id === "chapel") this.lancet(sign * 4.3, 3.2, -8.15, 1.2, 2.7);
    }
    this.arch(2.35, 2.6, 0.32, -8.3, stone);
    for (const sign of [-1, 1])
      this.box(0.3, 3, 0.5, sign * 2.15, 1.5, -8.3, stone);
    for (let x = -1.9; x < 2; x += 0.25) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.032, 4.8, 6),
        metal,
      );
      bar.position.set(x, 2.4, 0);
      this.gate.add(bar);
    }
    for (const y of [0.7, 2.2, 3.8]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(4.1, 0.07, 0.08),
        metal,
      );
      rail.position.y = y;
      this.gate.add(rail);
    }
    this.gate.position.z = -8.2;
    this.group.add(this.gate);
  }
  private relics() {
    this.box(1.5, 0.9, 0.85, -4.1, 0.45, 0.4, this.stone);
    this.box(1.7, 0.14, 1, -4.1, 0.96, 0.4, this.stone);
    this.box(0.9, 0.6, 0.9, 4.3, 0.3, -4.8, this.stone);
    this.cylinder(0.23, 0.34, 0.55, 18, 4.3, 0.85, -4.8, this.metal);
    this.obstacles.push(
      { x: -4.1, z: 0.4, hx: 0.85, hz: 0.58 },
      { x: 4.3, z: -4.8, hx: 0.5, hz: 0.5 },
    );
  }
  private rubble() {
    for (let i = 0; i < 26; i++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.11 + (i % 3) * 0.07),
        this.stone,
      );
      rock.position.set(
        (i % 2 ? 1 : -1) * (4.9 + Math.sin(i * 9) * 0.45),
        0.09,
        -7 + ((i * 13) % 150) / 10,
      );
      rock.scale.y = 0.6;
      rock.rotation.set(0.1, i, 0.2);
      this.part(rock);
    }
  }
  private skyTexture(id: LocationId) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d")!,
      img = ctx.createImageData(512, 256);
    const top = new THREE.Color(id === "roofs" ? 0x292c3c : 0x424e46),
      horizon = new THREE.Color(id === "roofs" ? 0x8b6675 : 0x889483);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 512; x++) {
        const t = Math.pow(Math.max(0, 1 - Math.abs(y - 128) / 128), 1.9),
          color = top.clone().lerp(horizon, t);
        const wave =
          Math.sin(x * 0.031 + Math.sin(y * 0.06) * 2.6) +
          Math.sin(x * 0.065 - y * 0.085) * 0.7 +
          Math.sin(x * 0.12 + y * 0.045) * 0.3;
        color.multiplyScalar(0.65 + Math.max(-0.4, Math.min(0.3, wave * 0.28)));
        // Canvas pixels are sRGB, THREE.Color components above are linear.
        color.convertLinearToSRGB();
        img.data.set(
          [color.r * 255, color.g * 255, color.b * 255, 255],
          (y * 512 + x) * 4,
        );
      }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  }
  private pattern(kind: "glass" | "cloth" | "bark" | "leaves" | "grass") {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const rand = (n: number) => {
      const v = Math.sin(n * 127.1 + 19.4) * 43758.5453;
      return v - Math.floor(v);
    };
    if (kind === "leaves" || kind === "grass") {
      ctx.clearRect(0, 0, 128, 128);
      for (let i = 0; i < (kind === "leaves" ? 85 : 28); i++) {
        ctx.fillStyle =
          i % 4 === 0 ? "#a0a27a" : i % 3 === 0 ? "#687b4d" : "#829565";
        if (kind === "leaves") {
          ctx.beginPath();
          ctx.ellipse(
            rand(i) * 128,
            rand(i + 8) * 128,
            4 + rand(i + 1) * 6,
            2 + rand(i + 2) * 4,
            rand(i + 3) * 6,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else {
          const x = rand(i) * 128;
          ctx.beginPath();
          ctx.moveTo(x, 128);
          ctx.quadraticCurveTo(
            x + rand(i + 2) * 24 - 12,
            55,
            x + rand(i + 1) * 35 - 17,
            8 + rand(i + 3) * 55,
          );
          ctx.lineTo(x + 4, 128);
          ctx.fill();
        }
      }
    } else {
      ctx.fillStyle =
        kind === "cloth" ? "#56584a" : kind === "glass" ? "#abb2a0" : "#85836c";
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 1600; i++) {
        ctx.fillStyle = `rgba(18,22,19,${rand(i + 3) * 0.22})`;
        ctx.fillRect(
          rand(i) * 128,
          rand(i + 1) * 128,
          kind === "bark" ? 2 : 1,
          kind === "bark" ? 8 + rand(i) * 22 : 1,
        );
      }
      ctx.strokeStyle = kind === "cloth" ? "#a49971" : "#47594f";
      ctx.lineWidth = kind === "glass" ? 2 : 1;
      if (kind !== "bark")
        for (let x = -128; x < 256; x += kind === "glass" ? 24 : 32) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + 128, 128);
          ctx.moveTo(x, 0);
          ctx.lineTo(x - 128, 128);
          ctx.stroke();
        }
      if (kind === "cloth") {
        ctx.lineWidth = 4;
        ctx.strokeRect(7, 3, 114, 122);
        ctx.lineWidth = 1;
        ctx.strokeRect(13, 3, 102, 122);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  private part(mesh: THREE.Mesh) {
    mesh.updateMatrix();
    let g = mesh.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(mesh.matrix);
    const pos = g.getAttribute("position"),
      norm = g.getAttribute("normal"),
      colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i),
        x = pos.getX(i),
        z = pos.getZ(i);
      let shade = Math.max(
        0.42,
        0.83 +
          norm.getY(i) * 0.09 +
          norm.getX(i) * 0.05 -
          Math.exp(-Math.max(0, y) * 1.8) * 0.15,
      );
      if (y < 0.03 && norm.getY(i) > 0.9) {
        shade = 0.7 - 0.33 * Math.pow(Math.min(1, Math.abs(x) / 6.2), 3);
        for (const cx of [-4.2, 4.2])
          for (const cz of [-7, 0, 6.7])
            shade -= 0.2 * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) * 1.5);
        shade += 0.2 * Math.exp(-((x + 1.6) ** 2 + (z - 3.7) ** 2) / 8);
      }
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const m = mesh.material as THREE.Material;
    const list = this.batches.get(m) ?? [];
    list.push(g);
    this.batches.set(m, list);
  }
  private flush() {
    for (const [mat, geos] of this.batches) {
      const g = mergeGeometries(geos);
      if (g) this.group.add(new THREE.Mesh(g, mat));
      for (const old of geos) old.dispose();
    }
    this.batches.clear();
  }
  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    this.part(mesh);
  }
  private cylinder(
    rt: number,
    rb: number,
    h: number,
    n: number,
    x: number,
    y: number,
    z: number,
    m: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, n), m);
    mesh.position.set(x, y, z);
    this.part(mesh);
  }
  private arch(
    r: number,
    stem: number,
    width: number,
    z: number,
    m: THREE.Material,
  ) {
    const s = new THREE.Shape(),
      inner = r - width;
    s.moveTo(-r, 0);
    s.lineTo(-r, stem);
    s.absarc(0, stem, r, Math.PI, 0, true);
    s.lineTo(r, 0);
    s.lineTo(inner, 0);
    s.lineTo(inner, stem);
    s.absarc(0, stem, inner, 0, Math.PI, false);
    s.lineTo(-inner, 0);
    s.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(s, {
        depth: 0.35,
        bevelEnabled: true,
        bevelSize: 0.035,
        bevelThickness: 0.035,
        bevelSegments: 2,
        curveSegments: 28,
      }),
      m,
    );
    mesh.position.z = z;
    this.part(mesh);
  }
  private radial(color: string, alpha: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!,
      g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    x.globalAlpha = alpha;
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return c;
  }
  private beam(sign: number, z: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          sign * 5.8,
          5.6,
          z - 1,
          sign * 5.8,
          3.2,
          z + 1,
          sign * 0.4,
          0.05,
          z + 3.8,
          sign * 5.8,
          5.6,
          z - 1,
          sign * 0.4,
          0.05,
          z + 3.8,
          sign * 2,
          0.05,
          z + 1.5,
        ],
        3,
      ),
    );
    g.computeVertexNormals();
    g.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0], 2),
    );
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!,
      pixels = ctx.createImageData(64, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 64; x++) {
        const u = (x + 0.5) / 64,
          v = 1 - y / 128,
          a =
            Math.pow(Math.sin(u * Math.PI), 2) *
            Math.sin(v * Math.PI * 0.9) *
            0.85;
        pixels.data.set([255, 255, 255, Math.round(a * 255)], (y * 64 + x) * 4);
      }
    ctx.putImageData(pixels, 0, 0);
    const material = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      color: this.id === "chapel" ? 0x9bc5b0 : 0xc4c6a1,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.beamMaterials.push(material);
    this.group.add(new THREE.Mesh(g, material));
  }
  private torch(x: number, z: number, m: THREE.Material) {
    const sign = Math.sign(x),
      wallX = sign * 5.98,
      tipX = sign * 5.42;
    const iron = new THREE.MeshStandardMaterial({
      color: 0x282d2e,
      roughness: 0.94,
      metalness: 0.3,
      vertexColors: true,
    });
    const wood = new THREE.MeshStandardMaterial({
      color: 0x48382c,
      roughness: 1,
      vertexColors: true,
    });
    const rod = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      r: number,
      mat: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10),
        mat,
      );
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        b.clone().sub(a).normalize(),
      );
      this.part(mesh);
    };
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.035, 16),
      iron,
    );
    plate.position.set(wallX, 1.85, z);
    plate.rotation.z = Math.PI / 2;
    plate.scale.z = 1.45;
    this.part(plate);
    rod(
      new THREE.Vector3(wallX, 1.87, z),
      new THREE.Vector3(sign * 5.57, 1.8, z),
      0.035,
      iron,
    );
    rod(
      new THREE.Vector3(wallX, 1.58, z),
      new THREE.Vector3(sign * 5.57, 1.8, z),
      0.023,
      iron,
    );
    rod(
      new THREE.Vector3(sign * 5.64, 1.55, z),
      new THREE.Vector3(tipX, 2.23, z),
      0.049,
      wood,
    );
    this.cylinder(0.13, 0.085, 0.18, 14, tipX, 2.23, z, iron);
    for (const dy of [-0.07, 0.07]) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.124, 0.018, 5, 16),
        iron,
      );
      band.position.set(tipX, 2.23 + dy, z);
      band.rotation.x = Math.PI / 2;
      this.part(band);
    }
    for (const side of [-1, 1])
      rod(
        new THREE.Vector3(tipX + side * 0.09, 2.17, z),
        new THREE.Vector3(tipX + side * 0.14, 2.43, z),
        0.015,
        iron,
      );
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.38, 12),
      new THREE.MeshBasicMaterial({
        color: 0xf2a056,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    flame.position.set(tipX, 2.47, z);
    this.group.add(flame);
    this.flames.push(flame);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffdba1, toneMapped: false }),
    );
    core.position.set(tipX, 2.35, z);
    core.scale.y = 2;
    this.group.add(core);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(this.radial("#ffd59f", 0.7)),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.copy(flame.position);
    glow.scale.setScalar(1.1);
    this.group.add(glow);
    {
      const light = new THREE.PointLight(
        0xf6b57b,
        LOCATIONS[this.id].torch,
        5.6,
        2,
      );
      light.position.set(tipX * 0.96, 2.46, z);
      this.group.add(light);
      this.flickerLights.push(light);
    }
  }
}
