import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assetUrl } from "./assets";
import {
  areaAt,
  TREES,
  WALLS,
  DRESSING,
  COURT_COLUMNS,
  CRYPT_BAYS,
  type AreaId,
} from "./world-layout";

export const LOCATIONS = {
  forest: { name: "Лес у Чёрных ворот", fog: 0xb8bebc, density: 0.027 },
  roofs: { name: "Воротный двор", fog: 0xaeb7b7, density: 0.028 },
  chapel: { name: "Собор и верхняя галерея", fog: 0x879392, density: 0.037 },
  crypt: { name: "Зал погребённых", fog: 0x626d6d, density: 0.046 },
  courtyard: { name: "Лес у Чёрных ворот", fog: 0x526166, density: 0.018 },
} as const;
export type LocationId = keyof typeof LOCATIONS;
export const LOCATION_IDS = Object.keys(LOCATIONS) as LocationId[];
export const isLocation = (s: string | null): s is LocationId =>
  !!s && Object.hasOwn(LOCATIONS, s);
type Sector = AreaId | "world";
const CENTERS: Record<AreaId, number> = {
  forest: -1,
  roofs: -29,
  chapel: -55,
  crypt: -88,
};
type WarmAnchor = {
  x: number;
  y: number;
  z: number;
  power: number;
  range: number;
};
type BeamAnchor = {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  power: number;
  width: number;
  area: AreaId;
};
const rand = (i: number) => {
  const n = Math.sin(i * 127.13 + 6.71) * 43758.5453;
  return n - Math.floor(n);
};

// A continuous map. Geometry, materials and light pools are allocated once.
export class ConnectedEnvironment {
  root = new THREE.Group();
  private sectors = new Map<Sector, THREE.Group>();
  private batches = new Map<
    Sector,
    Map<THREE.Material, THREE.BufferGeometry[]>
  >();
  private wall: THREE.MeshStandardMaterial;
  private stone: THREE.MeshStandardMaterial;
  private floor: THREE.MeshStandardMaterial;
  private metal: THREE.MeshStandardMaterial;
  private dark: THREE.MeshStandardMaterial;
  private bark: THREE.MeshStandardMaterial;
  private warm: WarmAnchor[] = [];
  private cool: BeamAnchor[] = [];
  private warmPool: THREE.PointLight[] = [];
  private coolPool: THREE.SpotLight[] = [];
  private chosen = new Int16Array(4);
  private chosenCool = new Int16Array(2);
  private beams: {
    material: THREE.MeshBasicMaterial;
    area: AreaId;
    phase: number;
  }[] = [];
  private flames: { x: number; y: number; z: number; scale: number }[] = [];
  private flameOuter?: THREE.InstancedMesh;
  private flameCore?: THREE.InstancedMesh;
  private fireMatrix = new THREE.Matrix4();
  private patterns = new Map<string, THREE.CanvasTexture>();
  constructor(loader: THREE.TextureLoader) {
    for (const sector of [
      "world",
      "forest",
      "roofs",
      "chapel",
      "crypt",
    ] as Sector[]) {
      const group = new THREE.Group();
      group.name = sector;
      this.sectors.set(sector, group);
      this.batches.set(sector, new Map());
      this.root.add(group);
    }
    const tiled = (file: string, tint: number) => {
      const material = new THREE.MeshStandardMaterial({
        map: loader.load(assetUrl(`/assets/dungeon/${file}.png`), (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 2;
        }),
        color: tint,
        roughness: 1,
        vertexColors: true,
      });
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <map_fragment>",
          `#ifdef USE_MAP
 vec4 stoneTexel = texture2D(map, vMapUv);
 float chalk = pow(clamp(dot(stoneTexel.rgb, vec3(0.2126,0.7152,0.0722)),0.0,1.0),0.45);
 diffuseColor.rgb *= mix(vec3(0.34,0.35,0.33),vec3(0.96,0.98,0.94),chalk);
 diffuseColor.a *= stoneTexel.a;
 #endif`,
        );
      };
      material.customProgramCacheKey = () => "new0-chalk-stone-v8";
      return material;
    };
    this.wall = tiled("TEX_Wall_03", 0xebeee8);
    this.stone = tiled("TEX_Arch_02", 0xf1f2ed);
    this.floor = tiled("TEX_Ground_04", 0xd9ddd6);
    this.metal = new THREE.MeshStandardMaterial({
      color: 0x353e48,
      roughness: 0.87,
      metalness: 0.25,
      vertexColors: true,
    });
    this.dark = new THREE.MeshStandardMaterial({
      color: 0x343840,
      roughness: 1,
      vertexColors: true,
    });
    this.bark = new THREE.MeshStandardMaterial({
      map: this.pattern("bark"),
      color: 0x89958d,
      roughness: 1,
      vertexColors: true,
    });
    this.root.add(new THREE.HemisphereLight(0xc8d1d8, 0x182029, 0.58));
    const moon = new THREE.DirectionalLight(0xe8eef3, 1.05);
    moon.position.set(-9, 18, 8);
    this.root.add(moon);
    const bounce = new THREE.DirectionalLight(0x8d9faa, 0.15);
    bounce.position.set(8, 4, -40);
    this.root.add(bounce);
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffe8d1, 0, 7, 2);
      this.warmPool.push(light);
      this.root.add(light);
    }
    for (let i = 0; i < 2; i++) {
      const light = new THREE.SpotLight(0xf4f7ff, 0, 20, 0.48, 0.7, 2);
      this.coolPool.push(light);
      this.root.add(light, light.target);
    }
    this.terrain();
    this.fortress();
    this.forest();
    this.court();
    this.cathedral();
    this.crypt();
    for (const w of WALLS)
      this.box(
        w.hx * 2,
        w.height,
        w.hz * 2,
        w.x,
        w.base + w.height / 2,
        w.z,
        w.material === "stone"
          ? this.stone
          : w.material === "dark"
            ? this.dark
            : this.wall,
        w.area,
      );
    this.dressing();
    this.buildFlames();
    this.flush();
  }
  private group(sector: Sector) {
    return this.sectors.get(sector)!;
  }
  private shade(x: number, y: number, z: number, ny: number, nx: number) {
    const area = areaAt(z),
      inside =
        (area === "chapel" && z < -43 && z > -69) ||
        (area === "crypt" && z < -78);
    let value = inside ? 0.28 : 0.68;
    value += Math.max(0, ny) * 0.13 + nx * 0.05;
    if (inside) {
      for (const w of [-47, -54, -62, -89]) {
        const band = z - (w + 1.8 + x * 0.43);
        value +=
          0.68 *
          Math.exp((-band * band) / 0.75) *
          Math.exp(-((x + 2) ** 2) / 35);
      }
      value += 0.12 * Math.exp(-((x + 2) ** 2 + (z + 54) ** 2) / 7);
    }
    if (y < 3 && ny > 0.7)
      value -= 0.16 * Math.pow(Math.min(1, Math.abs(x) / 8), 3);
    return Math.max(0.13, Math.min(1.4, value));
  }
  private part(mesh: THREE.Mesh, sector: Sector = "world", uvScale = 0.55) {
    mesh.updateMatrix();
    let geometry = mesh.geometry;
    if (geometry.index) {
      const old = geometry;
      geometry = geometry.toNonIndexed();
      old.dispose();
    }
    geometry.applyMatrix4(mesh.matrix);
    const positions = geometry.getAttribute("position"),
      normals = geometry.getAttribute("normal"),
      uv = geometry.getAttribute("uv");
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i),
        ny = normals.getY(i),
        nx = normals.getX(i);
      const shade = this.shade(x, y, z, ny, nx);
      colors.set([shade * 0.97, shade, shade * 1.025], i * 3);
      if (uv && uvScale > 0) {
        if (Math.abs(ny) > 0.6) uv.setXY(i, x * uvScale, z * uvScale);
        else if (Math.abs(nx) > 0.6) uv.setXY(i, z * uvScale, y * uvScale);
        else uv.setXY(i, x * uvScale, y * uvScale);
      }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = mesh.material as THREE.Material,
      batch = this.batches.get(sector)!;
    const list = batch.get(material) ?? [];
    list.push(geometry);
    batch.set(material, list);
  }
  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material = this.wall,
    sector: Sector = "world",
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    this.part(mesh, sector);
  }
  private cylinder(
    rt: number,
    rb: number,
    h: number,
    n: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material = this.stone,
    sector: Sector = "world",
  ) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rt, rb, h, n),
      material,
    );
    mesh.position.set(x, y, z);
    this.part(mesh, sector);
  }
  private arch(
    x: number,
    y: number,
    z: number,
    r: number,
    stem: number,
    material: THREE.Material = this.stone,
    sector: Sector = "world",
    rotation = 0,
  ) {
    const s = new THREE.Shape(),
      inner = r - 0.22;
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
        depth: 0.32,
        bevelEnabled: true,
        bevelSize: 0.025,
        bevelThickness: 0.025,
        bevelSegments: 1,
        curveSegments: 18,
      }),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    this.part(mesh, sector);
  }
  private ground(
    width: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    sector: Sector,
    material = this.floor,
  ) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(
        width,
        depth,
        Math.ceil(width * 2),
        Math.ceil(depth * 2),
      ),
      material,
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    this.part(m, sector);
  }
  private flush() {
    for (const [sector, batches] of this.batches)
      for (const [material, geometries] of batches) {
        // Persistent warm bounce remains visible when a torch is outside the
        // small dynamic light pool. Walking closer never ignites the flame.
        for (const g of geometries) {
          const p = g.getAttribute("position"),
            c = g.getAttribute("color");
          for (let i = 0; i < p.count; i++) {
            let glow = 0;
            for (const a of this.warm) {
              const d2 =
                (p.getX(i) - a.x) ** 2 +
                (p.getY(i) - a.y) ** 2 +
                (p.getZ(i) - a.z) ** 2;
              if (d2 < 24) glow += 0.22 * Math.exp(-d2 / 5.5);
            }
            c.setXYZ(
              i,
              c.getX(i) + glow,
              c.getY(i) + glow * 0.82,
              c.getZ(i) + glow * 0.65,
            );
          }
        }
        const geometry = mergeGeometries(geometries);
        if (geometry)
          this.group(sector).add(new THREE.Mesh(geometry, material));
        for (const old of geometries) old.dispose();
      }
    this.batches.clear();
  }
  private terrain() {
    const geometry = new THREE.PlaneGeometry(170, 230, 46, 64);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.12, -48);
    const p = geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i),
        outside = Math.max(0, Math.min(1, (Math.abs(x) - 8) / 13));
      const hills =
        (Math.sin(x * 0.14 + z * 0.065) * 2.2 +
          Math.cos(z * 0.12 - x * 0.03) * 2.8 -
          1.4) *
        outside;
      p.setY(i, -0.12 + hills + (z < -18 ? Math.min(2, (-18 - z) * 0.08) : 0));
    }
    geometry.computeVertexNormals();
    const terrain = new THREE.MeshStandardMaterial({
      map: this.pattern("earth"),
      color: 0x828f82,
      roughness: 1,
      vertexColors: true,
    });
    this.part(new THREE.Mesh(geometry, terrain), "world", 0.35);
    for (let i = 0; i < 32; i++) {
      const side = i % 2 ? 1 : -1,
        x = side * (17 + rand(i) * 33),
        z = 17 - rand(i + 70) * 140;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(2 + rand(i + 30) * 4),
        this.wall,
      );
      rock.position.set(x, -1 + rand(i + 12) * 2, z);
      rock.scale.set(1, 1 + rand(i) * 1.5, 0.8);
      rock.rotation.set(rand(i), i * 0.7, 0.1);
      this.part(rock, "world");
    }
  }
  private fortress() {
    for (const side of [-1, 1]) {
      this.box(3, 7.6, 88, side * 11, 1.5, -61, this.wall);
      this.box(0.65, 10.5, 85, side * 12.5, 7.5, -61, this.wall);
      for (let z = -24; z > -102; z -= 5.2) {
        this.box(1, 1.0, 1, side * 12.5, 13, z, this.stone);
        this.box(1.4, 5, 1, side * 9.5, 5, z, this.stone);
      }
      for (const z of [-22, -58, -102]) {
        const x = side * (z === -58 ? 14 : 11.5);
        this.cylinder(3.1, 3.8, 18, 20, x, 7.8, z, this.wall);
        this.cylinder(3.5, 3.4, 0.45, 20, x, 16.5, z, this.stone);
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(4.1, 7, 20),
          this.dark,
        );
        roof.position.set(x, 20.2, z);
        this.part(roof);
        for (const wy of [5, 10.5, 14])
          this.window(
            x - side * 1.1,
            wy,
            z + 3.2,
            0.65,
            1.8,
            "world",
            0,
            false,
          );
      }
    }
    this.arch(0, 0, -14.18, 1.65, 2.6, this.stone, "forest");
    for (let x = -7; x <= 7; x += 2)
      this.box(0.8, 1, 1.2, x, 8.5, -14, this.stone, "forest");
    // A supported stone bridge: arch feet meet the court, crowns meet the deck.
    this.box(28, 0.7, 2.6, 0, 7.25, -37, this.stone);
    for (const side of [-1, 1])
      this.box(1, 9.3, 2.6, side * 14, 2.25, -37, this.wall);
    for (const z of [-38.15, -35.85])
      this.box(28, 1.1, 0.3, 0, 8.15, z, this.wall);
    for (let x = -12; x <= 12; x += 4)
      this.arch(x, 2.4, -37.5, 1.9, 2.6, this.wall);
    // Beyond the last arch: another inhabited-looking volume, never a floating exit.
    this.box(24, 8, 15, 0, 4, -115, this.wall);
    this.box(25, 0.5, 16, 0, 8.3, -115, this.stone);
    for (let x = -10; x <= 10; x += 4)
      this.window(x, 3.5, -107.3, 1.3, 2.6, "world", 0, false);
  }
  private forest() {
    this.ground(16, 29, 0, 0.01, -1, "forest");
    const leafMat = new THREE.MeshStandardMaterial({
      map: this.pattern("leaves"),
      color: 0x7c9485,
      roughness: 1,
      alphaTest: 0.44,
      side: THREE.DoubleSide,
    });
    const trunkGeo = new THREE.CylinderGeometry(0.23, 0.49, 9, 9);
    trunkGeo.translate(0, 4.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, this.bark, TREES.length),
      leafGeo = new THREE.PlaneGeometry(4.8, 3.7),
      leaves = new THREE.InstancedMesh(leafGeo, leafMat, TREES.length * 9);
    const matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3(),
      position = new THREE.Vector3();
    for (let i = 0; i < TREES.length; i++) {
      const t = TREES[i],
        height = 0.8 + rand(i + 100) * 0.6;
      position.set(t.x, -0.2, t.z);
      rotation.setFromEuler(new THREE.Euler(0.02, rand(i) * 6, 0.03));
      scale.set(1, height, 1);
      matrix.compose(position, rotation, scale);
      trunks.setMatrixAt(i, matrix);
      for (let j = 0; j < 9; j++) {
        const a = rand(i * 12 + j) * Math.PI * 2,
          r = 0.9 + rand(i * 3 + j) * 1.5;
        position.set(
          t.x + Math.sin(a) * r,
          5.5 * height + (j % 3) * 1.3,
          t.z + Math.cos(a) * r,
        );
        rotation.setFromEuler(
          new THREE.Euler(-0.3 + rand(j + 2) * 1.2, a, rand(j) * 0.6 - 0.3),
        );
        scale.setScalar(0.8 + rand(i + j) * 0.6);
        matrix.compose(position, rotation, scale);
        leaves.setMatrixAt(i * 9 + j, matrix);
      }
    }
    trunks.computeBoundingSphere();
    leaves.computeBoundingSphere();
    this.group("forest").add(trunks, leaves);
    for (const side of [-1, 1]) {
      this.arch(side * 5.8, 0, -4, 1.2, 1.1, this.stone, "forest");
      for (let i = 0; i < 3; i++)
        this.box(
          0.7,
          0.45,
          1,
          side * (4.8 + i * 0.8),
          0.23,
          -11,
          this.stone,
          "forest",
        );
    }
    // Broken root/stone shelves hide the chest and the key in different compositions.
    this.box(1.2, 0.8, 0.9, -3.8, 0.4, 1.3, this.stone, "forest");
    this.box(1.5, 0.12, 1.1, -3.8, 0.85, 1.3, this.stone, "forest");
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.3, 3.3, 8),
        this.bark,
      );
      log.position.set(7.2, 0.32, 4.4 - i * 0.35);
      log.rotation.z = 1.2;
      log.rotation.y = 0.4;
      this.part(log, "forest");
    }
    this.torch(-3.3, 1.7, -13.6, "forest");
    this.torch(3.3, 1.7, -13.6, "forest");
    this.beam({
      x: -4,
      y: 14,
      z: -1,
      tx: -2.3,
      ty: 0.04,
      tz: -0.5,
      power: 52,
      width: 2.1,
      area: "forest",
    });
  }
  private court() {
    this.ground(15.5, 20, 0, 2.4, -32, "roofs");
    for (let i = 1; i <= 18; i++) {
      const h = (i / 18) * 2.4;
      this.box(
        5,
        h,
        0.34,
        0,
        h / 2,
        -16 - ((i - 0.5) * 6) / 18,
        this.stone,
        "roofs",
      );
    }
    for (const side of [-1, 1]) {
      this.box(0.45, 1.1, 22, side * 7.6, 2.95, -31, this.wall, "roofs");
      this.ironFence(side * 7.4, -31, 23, Math.PI / 2, "roofs", 3.5);
    }
    for (const { x, z } of COURT_COLUMNS)
      this.cylinder(0.28, 0.43, 4.5, 14, x, 4.65, z, this.stone, "roofs");
    this.arch(-4.5, 2.4, -26.2, 1.4, 2.1, this.stone, "roofs");
    this.box(2.8, 0.55, 1, -4.6, 2.68, -27.5, this.wall, "roofs");
    this.torch(-6.6, 4.3, -23.4, "roofs");
    this.torch(6.6, 4.3, -35, "roofs");
    this.beam({
      x: -4,
      y: 15,
      z: -27,
      tx: -2,
      ty: 2.43,
      tz: -30,
      power: 36,
      width: 2.8,
      area: "roofs",
    });
  }
  private cathedral() {
    const sector: Sector = "chapel",
      base = 2.4;
    this.ground(15.6, 29, 0, base, -55.5, sector);
    // Side walls are built around actual bright apertures rather than a sky image.
    for (const side of [-1, 1]) {
      this.box(0.45, 2.2, 28, side * 7.7, base + 1.1, -55.6, this.wall, sector);
      this.box(
        0.45,
        2.1,
        28,
        side * 7.7,
        base + 7.35,
        -55.6,
        this.wall,
        sector,
      );
      for (const z of [-42.5, -50.5, -58.5, -66.5])
        this.box(0.5, 4.3, 2, side * 7.7, base + 4.35, z, this.wall, sector);
      for (const z of [-46.5, -54.5, -62.5]) {
        this.window(
          side * 7.43,
          base + 2.2,
          z,
          1.8,
          4.4,
          sector,
          side < 0 ? Math.PI / 2 : -Math.PI / 2,
          true,
        );
        if (side < 0)
          this.beam({
            x: -7.3,
            y: base + 6.1,
            z,
            tx: -1.4,
            ty: base + 0.04,
            tz: z + 2.5,
            power: 54,
            width: 1.1,
            area: "chapel",
          });
      }
    }
    for (const z of [-43, -51, -58, -67]) {
      this.arch(-1.825, base, z, 4.675, 3.7, this.stone, sector);
      for (const x of [-6.5, 2.85]) {
        this.cylinder(
          0.26,
          0.41,
          3.7,
          16,
          x,
          base + 1.85,
          z,
          this.stone,
          sector,
        );
        this.cylinder(
          0.49,
          0.55,
          0.2,
          16,
          x,
          base + 0.1,
          z,
          this.stone,
          sector,
        );
      }
    }
    this.box(15.6, 0.35, 29, 0, base + 8.4, -55.5, this.dark, sector);
    for (const z of [-42.3, -69.4]) {
      for (const side of [-1, 1])
        this.box(5.7, 8.4, 0.5, side * 5, base + 4.2, z, this.wall, sector);
      this.arch(0, base, z, 2.3, 2.6, this.stone, sector);
    }
    const rug = new THREE.MeshStandardMaterial({
      map: this.pattern("cloth"),
      color: 0x59323e,
      roughness: 1,
      vertexColors: true,
    });
    this.ground(2.9, 20, -0.4, base + 0.012, -55, sector, rug);
    // A real alcove and lectern, not a gem floating over the arena floor.
    this.box(0.3, 2.8, 1.8, -3.3, base + 1.4, -43.9, this.wall, sector);
    this.box(0.3, 2.8, 1.6, -3.3, base + 1.4, -47.3, this.wall, sector);
    this.box(2.8, 2.8, 0.3, -5.4, base + 1.4, -48.1, this.wall, sector);
    this.box(1.1, 0.9, 0.9, -4.5, base + 0.45, -46, this.stone, sector);
    this.box(1.35, 0.12, 1.1, -4.5, base + 0.96, -46, this.stone, sector);
    this.torch(-7.3, base + 2, -46, "chapel");
    this.torch(-7.3, base + 2, -61, "chapel");
    this.chandelier(-0.3, base + 5.1, -51.5, "chapel");
    // One entrance to a locked vestry. Loot requires returning by the same stairs.
    for (let i = 1; i <= 20; i++) {
      const h = (i / 20) * 2.8;
      this.box(
        3.1,
        h,
        0.5,
        5,
        base + h / 2,
        -49 - (i - 0.5) * 0.5,
        this.stone,
        sector,
      );
    }
    this.box(3.35, 0.3, 9, 5, 5.05, -63.5, this.stone, sector);
    this.ironFence(3.35, -63.5, 8.7, Math.PI / 2, sector, 5.2);
    this.ironFence(6.65, -63.5, 9, Math.PI / 2, sector, 5.2);
    this.arch(5, 5.2, -60.4, 1.14, 1.9, this.stone, sector);
    this.box(3.6, 0.3, 8, 5, 9, -64, this.dark, sector);
    this.window(6.43, 6.1, -65, 1.3, 2.1, sector, -Math.PI / 2, true);
    this.chandelier(5, 8.35, -61.9, "chapel");
    this.torch(6.5, 6.5, -61.5, "chapel");
  }
  private crypt() {
    const s: Sector = "crypt",
      b = 2.4;
    this.ground(15.5, 27, 0, b, -89.5, s);
    for (const side of [-1, 1]) {
      this.box(0.5, 4.4, 26, side * 7.7, b + 2.2, -89.5, this.wall, s);
    }
    for (const { x, z } of CRYPT_BAYS) {
      this.cylinder(
        0.28,
        0.38,
        3.6,
        12,
        x + Math.sign(x) * 0.1,
        b + 1.8,
        z,
        this.stone,
        s,
      );
      this.arch(x, b + 0.2, z, 1.05, 1.5, this.stone, s);
      this.box(1.6, 0.26, 1.1, x, b + 0.28, z, this.stone, s);
      this.ironFence(x, z + 0.3, 1.6, 0, s, b + 0.4);
    }
    // Four slabs leave a real break in the ceiling above the encounter.
    this.box(5.3, 0.35, 27, -5.15, b + 4.4, -89.5, this.dark, s);
    this.box(8.6, 0.35, 27, 3.5, b + 4.4, -89.5, this.dark, s);
    this.box(1.7, 0.35, 7.4, -1.65, b + 4.4, -79.7, this.dark, s);
    this.box(1.7, 0.35, 16.4, -1.65, b + 4.4, -94.8, this.dark, s);
    const opening = new THREE.Mesh(
      new THREE.PlaneGeometry(1.65, 3),
      new THREE.MeshBasicMaterial({
        color: 0xf5f8ff,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    opening.rotation.x = Math.PI / 2;
    opening.position.set(-1.65, b + 4.7, -85);
    this.part(opening, s, 0);
    for (const z of [-83.6, -84.5, -85.4, -86.3])
      this.box(2, 0.09, 0.065, -1.65, b + 4.65, z, this.metal, s);
    for (const z of [-77.6, -103]) {
      for (const side of [-1, 1])
        this.box(5.6, 4.4, 0.5, side * 5.1, b + 2.2, z, this.wall, s);
      this.arch(0, b, z, 2.5, 1.7, this.stone, s);
    }
    for (const z of [-80.4, -88, -96]) {
      this.torch(-7.3, b + 1.9, z, s);
      this.torch(7.3, b + 1.9, z + 1, s);
    }
    this.chandelier(0, b + 2.7, -87, s);
    this.window(0, b + 1, -103.2, 3, 3, s, 0, true);
    this.beam({
      x: -1.65,
      y: b + 4.6,
      z: -84.8,
      tx: -0.4,
      ty: b + 0.02,
      tz: -86.4,
      power: 64,
      width: 1.2,
      area: "crypt",
    });
    this.box(1.1, 0.5, 1.2, 3.8, b + 0.25, -81, this.stone, s);
  }
  private dressing() {
    for (const d of DRESSING) {
      if (d.kind === "tomb") {
        const turned = d.yaw !== 0;
        this.box(
          turned ? 1.8 : 0.8,
          0.65,
          turned ? 0.8 : 1.8,
          d.x,
          d.y + 0.325,
          d.z,
          this.wall,
          d.area,
        );
        this.box(
          turned ? 1.95 : 0.95,
          0.12,
          turned ? 0.95 : 1.95,
          d.x,
          d.y + 0.71,
          d.z,
          this.stone,
          d.area,
        );
        this.box(0.06, 0.025, 0.45, d.x, d.y + 0.785, d.z, this.dark, d.area);
        this.box(
          0.28,
          0.025,
          0.06,
          d.x,
          d.y + 0.785,
          d.z - 0.07,
          this.dark,
          d.area,
        );
      } else if (d.kind === "bench") {
        this.box(0.55, 0.14, 2.1, d.x, d.y + 0.52, d.z, this.dark, d.area);
        this.box(
          0.14,
          1.05,
          2.1,
          d.x - 0.2,
          d.y + 0.525,
          d.z,
          this.dark,
          d.area,
        );
        for (const z of [-0.8, 0.8])
          this.box(
            0.4,
            0.48,
            0.15,
            d.x,
            d.y + 0.24,
            d.z + z,
            this.stone,
            d.area,
          );
      } else if (d.kind === "crate") {
        this.box(0.85, 0.95, 0.85, d.x, d.y + 0.475, d.z, this.bark, d.area);
        for (const y of [0.12, 0.83])
          this.box(0.89, 0.07, 0.89, d.x, d.y + y, d.z, this.metal, d.area);
      } else {
        this.box(0.85, 0.45, 0.85, d.x, d.y + 0.225, d.z, this.stone, d.area);
        this.cylinder(
          0.21,
          0.32,
          1.4,
          10,
          d.x,
          d.y + 1.15,
          d.z,
          this.wall,
          d.area,
        );
        const head = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.22, 1),
          this.stone,
        );
        head.position.set(d.x, d.y + 1.96, d.z);
        this.part(head, d.area);
        this.box(0.75, 0.15, 0.25, d.x, d.y + 1.45, d.z, this.stone, d.area);
      }
    }
  }
  private ironFence(
    x: number,
    z: number,
    length: number,
    rotation: number,
    sector: Sector,
    base = 0,
  ) {
    const group = new THREE.Group();
    for (let i = 0; i < Math.ceil(length / 0.35); i++) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.026, 1.25, 6),
        this.metal,
      );
      bar.position.set(-length / 2 + i * 0.35, 0.64, 0);
      group.add(bar);
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.19, 5),
        this.metal,
      );
      tip.position.set(bar.position.x, 1.35, 0);
      group.add(tip);
    }
    for (const y of [0.23, 0.95]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.045, 0.05),
        this.metal,
      );
      rail.position.y = y;
      group.add(rail);
    }
    group.position.set(x, base, z);
    group.rotation.y = rotation;
    group.updateMatrixWorld(true);
    for (const o of group.children) {
      const mesh = o as THREE.Mesh;
      mesh.applyMatrix4(group.matrix);
      this.part(mesh, sector);
    }
  }
  private window(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    sector: Sector,
    rotation: number,
    bright: boolean,
  ) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(-width / 2, height * 0.72);
    shape.quadraticCurveTo(-width / 2, height * 0.86, 0, height);
    shape.quadraticCurveTo(width / 2, height * 0.86, width / 2, height * 0.72);
    shape.lineTo(width / 2, 0);
    shape.closePath();
    const material = new THREE.MeshBasicMaterial({
      map: this.pattern("glass"),
      color: bright ? 0xf7fafc : 0x151c25,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    this.part(mesh, sector, 0);
    this.arch(
      x,
      y,
      z,
      width * 0.58,
      height * 0.69,
      this.stone,
      sector,
      rotation,
    );
  }
  private torch(x: number, y: number, z: number, sector: Sector) {
    const sign = Math.sign(x) || 1;
    this.box(0.12, 0.48, 0.35, x, y - 0.15, z, this.metal, sector);
    this.box(
      0.48,
      0.07,
      0.09,
      x - sign * 0.22,
      y - 0.05,
      z,
      this.metal,
      sector,
    );
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.043, 0.055, 0.65, 8),
      this.bark,
    );
    handle.position.set(x - sign * 0.4, y + 0.15, z);
    handle.rotation.z = sign * 0.2;
    this.part(handle, sector);
    this.cylinder(
      0.13,
      0.065,
      0.18,
      10,
      x - sign * 0.46,
      y + 0.48,
      z,
      this.metal,
      sector,
    );
    this.fire(x - sign * 0.46, y + 0.68, z, sector);
    this.warm.push({
      x: x - sign * 0.64,
      y: y + 0.68,
      z,
      power: 32,
      range: 6.5,
    });
  }
  private chandelier(x: number, y: number, z: number, sector: Sector) {
    this.cylinder(0.023, 0.023, 1.8, 6, x, y + 1.1, z, this.metal, sector);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.63, 0.045, 6, 18),
      this.metal,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y, z);
    this.part(ring, sector);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2,
        px = x + Math.sin(a) * 0.63,
        pz = z + Math.cos(a) * 0.63;
      this.cylinder(0.045, 0.05, 0.28, 8, px, y + 0.1, pz, this.stone, sector);
      this.fire(px, y + 0.32, pz, sector, 0.65);
    }
    this.warm.push({ x, y: y + 0.3, z, power: 46, range: 8 });
  }
  private fire(x: number, y: number, z: number, sector: Sector, scale = 1) {
    this.flames.push({ x, y, z, scale });
  }
  private buildFlames() {
    this.flameOuter = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.065, 0.32, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd79f, toneMapped: false }),
      this.flames.length,
    );
    this.flameCore = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.035, 0.2, 7),
      new THREE.MeshBasicMaterial({ color: 0xfffaf0, toneMapped: false }),
      this.flames.length,
    );
    this.root.add(this.flameOuter, this.flameCore);
    this.updateFlames(0);
    this.flameOuter.computeBoundingSphere();
    this.flameCore.computeBoundingSphere();
  }
  private updateFlames(time: number) {
    if (!this.flameOuter || !this.flameCore) return;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i],
        sy = f.scale * (0.94 + Math.sin(time * 12 + f.z) * 0.06);
      this.fireMatrix
        .makeScale(f.scale, sy, f.scale)
        .setPosition(f.x, f.y + 0.08 * sy, f.z);
      this.flameOuter.setMatrixAt(i, this.fireMatrix);
      this.fireMatrix.setPosition(f.x, f.y + 0.015 * sy, f.z);
      this.flameCore.setMatrixAt(i, this.fireMatrix);
    }
    this.flameOuter.instanceMatrix.needsUpdate =
      this.flameCore.instanceMatrix.needsUpdate = true;
  }
  private beam(anchor: BeamAnchor) {
    this.cool.push(anchor);
    const origin = new THREE.Vector3(anchor.x, anchor.y, anchor.z),
      end = new THREE.Vector3(anchor.tx, anchor.ty, anchor.tz),
      direction = end.clone().sub(origin).normalize();
    const across = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
    if (across.lengthSq() < 0.1) across.set(1, 0, 0);
    const material = new THREE.MeshBasicMaterial({
      map: this.pattern("beam"),
      color: 0xf4f7ff,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    for (let i = 0; i < 2; i++) {
      const side = across.clone().applyAxisAngle(direction, (i * Math.PI) / 2),
        a = origin.clone().addScaledVector(side, -0.16),
        b = origin.clone().addScaledVector(side, 0.16),
        c = end.clone().addScaledVector(side, anchor.width),
        d = end.clone().addScaledVector(side, -anchor.width);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [
            ...a.toArray(),
            ...b.toArray(),
            ...c.toArray(),
            ...a.toArray(),
            ...c.toArray(),
            ...d.toArray(),
          ],
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          [0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0],
          2,
        ),
      );
      geometry.computeVertexNormals();
      this.group(anchor.area).add(new THREE.Mesh(geometry, material));
    }
    this.beams.push({ material, area: anchor.area, phase: anchor.z * 0.5 });
  }
  private pattern(kind: string) {
    const cached = this.patterns.get(kind);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    if (kind === "leaves") {
      for (let i = 0; i < 550; i++) {
        const x = rand(i) * 256,
          y = rand(i + 400) * 256,
          dx = (x - 128) / 125,
          dy = (y - 128) / 100;
        if (dx * dx + dy * dy > 1.1 + rand(i) * 0.2) continue;
        ctx.fillStyle = i % 3 === 0 ? "#536c5f" : i % 2 ? "#697f68" : "#3c5549";
        ctx.beginPath();
        ctx.ellipse(
          x,
          y,
          4 + rand(i + 1) * 8,
          2 + rand(i + 2) * 4,
          rand(i + 3) * 6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else if (kind === "beam") {
      const image = ctx.createImageData(256, 256);
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
          const u = x / 255,
            v = y / 255,
            a =
              Math.pow(Math.sin(u * Math.PI), 2) *
              Math.pow(Math.sin(v * Math.PI), 0.65) *
              (0.65 + rand(x + y * 256) * 0.35);
          image.data.set(
            [255, 255, 255, Math.round(a * 255)],
            (y * 256 + x) * 4,
          );
        }
      ctx.putImageData(image, 0, 0);
    } else {
      ctx.fillStyle =
        kind === "glass"
          ? "#ecf0f2"
          : kind === "bark"
            ? "#62665c"
            : kind === "cloth"
              ? "#9a858b"
              : "#727b6a";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1600; i++) {
        const v = Math.floor(rand(i) * 100);
        ctx.fillStyle = `rgba(${v},${v + 5},${v + 9},${kind === "glass" ? 0.12 : 0.25})`;
        ctx.fillRect(
          rand(i + 4) * 256,
          rand(i + 7) * 256,
          kind === "bark" ? 1 + rand(i) * 3 : 2,
          kind === "bark" ? 10 + rand(i) * 55 : 2,
        );
      }
      if (kind === "glass") {
        ctx.strokeStyle = "#26313d";
        ctx.lineWidth = 6;
        for (let i = -8; i < 12; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 40, 0);
          ctx.lineTo(i * 40 + 256, 256);
          ctx.moveTo(i * 40, 0);
          ctx.lineTo(i * 40 - 256, 256);
          ctx.stroke();
        }
      }
      if (kind === "cloth") {
        ctx.strokeStyle = "#322c31";
        ctx.lineWidth = 2;
        for (let i = 5; i < 256; i += 16) {
          ctx.strokeRect(i, 5, 6, 246);
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    this.patterns.set(kind, texture);
    return texture;
  }
  update(
    time: number,
    player: { x: number; y: number; z: number },
    area: AreaId,
  ) {
    for (const [id, group] of this.sectors)
      group.visible =
        id === "world" || Math.abs(CENTERS[id as AreaId] - player.z) < 42;
    this.chosen.fill(-1);
    for (let slot = 0; slot < this.warmPool.length; slot++) {
      let best = -1,
        distance = Infinity;
      for (let i = 0; i < this.warm.length; i++) {
        if (this.chosen.includes(i)) continue;
        const a = this.warm[i],
          d =
            (a.x - player.x) ** 2 +
            (a.z - player.z) ** 2 +
            (a.y - player.y - 1) ** 2;
        if (d < distance) {
          best = i;
          distance = d;
        }
      }
      this.chosen[slot] = best;
      const light = this.warmPool[slot],
        a = this.warm[best];
      light.position.set(a.x, a.y, a.z);
      light.distance = a.range;
      light.intensity =
        a.power *
        0.3 *
        (0.96 +
          Math.sin(time * 11 + best) * 0.025 +
          Math.sin(time * 17 + best) * 0.015);
    }
    this.chosenCool.fill(-1);
    for (let slot = 0; slot < this.coolPool.length; slot++) {
      let best = -1,
        distance = Infinity;
      for (let i = 0; i < this.cool.length; i++) {
        const a = this.cool[i];
        if (a.area !== area || this.chosenCool.includes(i)) continue;
        const d = (a.tx - player.x) ** 2 + (a.tz - player.z) ** 2;
        if (d < distance) {
          best = i;
          distance = d;
        }
      }
      this.chosenCool[slot] = best;
      const light = this.coolPool[slot],
        a = this.cool[best];
      light.intensity = a
        ? a.power * (0.96 + Math.sin(time * 0.73 + a.z) * 0.04)
        : 0;
      if (a) {
        light.position.set(a.x, a.y, a.z);
        light.target.position.set(a.tx, a.ty, a.tz);
      }
    }
    for (const b of this.beams)
      b.material.opacity =
        (b.area === area ? 0.12 : 0.045) *
        (1 + Math.sin(time * 0.65 + b.phase) * 0.08);
    this.updateFlames(time);
  }
}
