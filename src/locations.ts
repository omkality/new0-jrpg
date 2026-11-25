import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assetUrl } from "./assets.ts";
import {
  areaAt,
  TREES,
  WALLS,
  DRESSING,
  COURT_COLUMNS,
  COURT_STAIR,
  FOREST_GATE,
  CHAPEL_COLUMNS,
  CHAPEL_THRESHOLD_Z,
  ARCH_PORTALS,
  CRYPT_COLUMNS,
  CRYPT_CEILING_Y,
  OBSTACLES,
  VESTRY,
  OSSUARY_PASSAGE,
  type AreaId,
} from "./world-layout.ts";
import { createForest } from "./forest.ts";
import {
  blackGate,
  vestryDoor,
  gateWall,
  standardTexture,
} from "./gatehouse.ts";
import { StaticLightField } from "./static-light.ts";
import { terrainHeight } from "./terrain-height.ts";
import { CRYPT_FURNISHINGS } from "./castle-furnishings.ts";
import {
  environmentTexture,
  type EnvironmentPattern,
} from "./environment-materials.ts";

export const LOCATIONS = {
  forest: { name: "Лес у Чёрных ворот", fog: 0xd4d9d3, density: 0.052 },
  roofs: { name: "Воротный двор", fog: 0xcbd2cc, density: 0.048 },
  chapel: { name: "Собор и верхняя галерея", fog: 0xc7cec8, density: 0.045 },
  crypt: { name: "Зал погребённых", fog: 0xc3cbc5, density: 0.047 },
  courtyard: { name: "Лес у Чёрных ворот", fog: 0xd4d9d3, density: 0.052 },
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
  area: Sector;
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
  threshold?: boolean;
};
const rand = (i: number) => {
  const n = Math.sin(i * 127.13 + 6.71) * 43758.5453;
  return n - Math.floor(n);
};

// A continuous map. Geometry, materials and light pools are allocated once.
export class ConnectedEnvironment {
  root = new THREE.Group();
  readonly gateDoors: THREE.Group;
  readonly vestryDoor: THREE.Group;
  readonly localLighting: StaticLightField;
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
  private earth: THREE.MeshStandardMaterial;
  private dressedStone: THREE.MeshStandardMaterial;
  private causeway: THREE.MeshStandardMaterial;
  private torchCloth: THREE.MeshStandardMaterial;
  private iron: THREE.MeshStandardMaterial;
  private wax: THREE.MeshStandardMaterial;
  private wood: THREE.MeshStandardMaterial;
  private burialStone: THREE.MeshStandardMaterial;
  private skyLight = new THREE.HemisphereLight(0xb9c5c6, 0x20251e, 0.42);
  private moonLight = new THREE.DirectionalLight(0xd9e4df, 0.8);
  private bounceLight = new THREE.DirectionalLight(0x788b88, 0.1);
  private indoorBounceColor = new THREE.Color(0x5c6863);
  private outdoorBounceColor = new THREE.Color(0x20251e);
  private lastTime = 0;
  private warm: WarmAnchor[] = [];
  private cool: BeamAnchor[] = [];
  private beams: {
    material: THREE.MeshBasicMaterial;
    area: AreaId;
    phase: number;
    threshold?: boolean;
  }[] = [];
  private flames: { x: number; y: number; z: number; scale: number }[] = [];
  private flameOuter?: THREE.InstancedMesh;
  private flameClock = { value: 0 };
  private fireMatrix = new THREE.Matrix4();
  private fireScale = new THREE.Vector3();
  private patterns = new Map<string, THREE.CanvasTexture>();
  private exitSource?: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private exitHalo?: THREE.Sprite;
  private exitRequest = 0;
  private activeFurnishing?: { index: number; bounds: THREE.Box3 };
  readonly assetReview = {
    furnishings: [] as {
      index: number;
      kind: string;
      min: number[];
      max: number[];
    }[],
    candleFlames: [] as {
      x: number;
      z: number;
      waxTop: number;
      wickTop: number;
      flameBase: number;
      scale: number;
    }[],
  };
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
    const tile = (path: string, mirrored = false) =>
      loader.load(assetUrl(path), (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = mirrored
          ? THREE.MirroredRepeatWrapping
          : THREE.RepeatWrapping;
        texture.anisotropy = 2;
      });
    const tiled = (map: THREE.Texture, tint: number) =>
      new THREE.MeshStandardMaterial({
        map,
        color: tint,
        roughness: 1,
        vertexColors: true,
      });
    const gateTile = (id: string) => tile(`/assets/gatehouse/${id}.webp`, true);
    this.wall = new THREE.MeshStandardMaterial({
      map: this.pattern("brick"),
      color: 0xc0bcb1,
      roughness: 1,
      vertexColors: true,
    });
    this.stone = tiled(tile("/assets/dungeon/TEX_Arch_02.png"), 0xb5b8ac);
    this.floor = tiled(tile("/assets/dungeon/TEX_Ground_04.png"), 0xbbbeb5);
    const ashlar = tiled(gateTile("ashlar"), 0xc5ceca);
    this.dressedStone = tiled(gateTile("dressed-stone"), 0xa0b3bb);
    this.causeway = tiled(gateTile("causeway"), 0xb8bdb0);
    const oakMap = gateTile("black-oak");
    this.vestryDoor = vestryDoor(oakMap);
    this.group("chapel").add(this.vestryDoor);
    this.gateDoors = blackGate(oakMap);
    this.gateDoors.position.set(FOREST_GATE.x, 0, FOREST_GATE.z);
    this.group("forest").add(this.gateDoors);
    this.metal = new THREE.MeshStandardMaterial({
      color: 0x353e48,
      roughness: 0.87,
      metalness: 0.25,
      vertexColors: true,
    });
    this.dark = new THREE.MeshStandardMaterial({
      color: 0x393e39,
      roughness: 1,
      vertexColors: true,
    });
    this.bark = new THREE.MeshStandardMaterial({
      map: this.pattern("bark"),
      color: 0x9b9a87,
      roughness: 1,
      vertexColors: true,
    });
    this.earth = new THREE.MeshStandardMaterial({
      map: this.pattern("earth"),
      color: 0xb3b29d,
      roughness: 1,
      vertexColors: true,
    });
    this.torchCloth = new THREE.MeshStandardMaterial({
      map: this.pattern("torch-wrap"),
      color: 0xb6a482,
      roughness: 1,
      vertexColors: true,
    });
    this.iron = new THREE.MeshStandardMaterial({
      map: this.pattern("iron"),
      color: 0x9c9d95,
      metalness: 0.65,
      roughness: 0.74,
      vertexColors: true,
    });
    this.wax = new THREE.MeshStandardMaterial({
      map: this.pattern("wax"),
      color: 0xd0c6a9,
      // A small baked transmission term keeps the side facing away from the
      // shared light readable, as a real wax candle scatters its own flame.
      emissive: 0xc0a778,
      emissiveMap: this.pattern("wax"),
      emissiveIntensity: 0.12,
      roughness: 0.92,
      vertexColors: true,
    });
    this.wood = new THREE.MeshStandardMaterial({
      map: this.pattern("oak"),
      color: 0xa29b87,
      roughness: 1,
      vertexColors: true,
    });
    this.burialStone = new THREE.MeshStandardMaterial({
      map: this.pattern("burial-stone"),
      color: 0xb0b5ac,
      roughness: 0.94,
      vertexColors: true,
    });
    this.moonLight.position.set(-9, 18, 8);
    this.bounceLight.position.set(8, 4, -40);
    this.root.add(this.skyLight, this.moonLight, this.bounceLight);
    this.terrain();
    this.fortress();
    this.forest();
    this.court();
    this.cathedral();
    this.crypt();
    for (const p of ARCH_PORTALS) {
      for (const side of [-1, 1])
        this.box(
          p.wingWidth,
          p.wallHeight,
          p.depth,
          side * p.wingX,
          p.base + p.wallHeight / 2,
          p.z,
          this.wall,
          p.area,
        );
      this.arch(0, p.base, p.z, p.radius, p.stem, this.stone, p.area);
      this.archBacking(
        0,
        p.base,
        p.z,
        p.radius,
        p.stem,
        p.radius,
        p.wallHeight,
        p.depth - 0.08,
        p.area,
      );
    }
    const gateMaterials = {
      ashlar,
      dressed: this.dressedStone,
      recess: this.dark,
      iron: this.iron,
      standard: tiled(standardTexture(), 0xe3ddce),
    };
    for (const w of WALLS) {
      if (w.id.startsWith("gate-")) {
        gateWall(w, gateMaterials, (mesh, scale) =>
          this.part(mesh, "forest", scale),
        );
        continue;
      }
      this.box(
        w.hx * 2,
        w.height,
        w.hz * 2,
        w.x,
        w.base + w.height / 2,
        w.z,
        w.material === "ashlar"
          ? ashlar
          : w.material === "stone"
            ? this.stone
            : w.material === "dark"
              ? this.dark
              : this.wall,
        w.area,
      );
    }
    this.dressing();
    this.buildFlames();
    this.flush();
    this.localLighting = new StaticLightField(this.warm, this.cool);
  }
  private group(sector: Sector) {
    return this.sectors.get(sector)!;
  }
  private shade(x: number, y: number, z: number, ny: number, nx: number) {
    const area = areaAt(z),
      inside =
        (area === "chapel" && z < -43 && z > -69) ||
        (area === "crypt" && z < -78);
    // Material colour stays earthy. Cold distance fog and actual openings,
    // rather than a white albedo remap, provide the pale atmospheric range.
    let value = inside ? 0.53 : 0.76;
    value += Math.max(0, ny) * 0.1 + nx * 0.035;
    if (inside) {
      for (const w of [-47, -54, -62, -89]) {
        const band = z - (w + 1.8 + x * 0.43);
        value +=
          0.48 *
          Math.exp((-band * band) / 0.75) *
          Math.exp(-((x + 2) ** 2) / 35);
      }
      value += 0.08 * Math.exp(-((x + 2) ** 2 + (z + 54) ** 2) / 7);
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
    if (this.activeFurnishing) {
      geometry.computeBoundingBox();
      this.activeFurnishing.bounds.union(geometry.boundingBox!);
    }
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
  // Continuous masonry between the extrados, supporting piers and the deck above.
  private archBacking(
    x: number,
    y: number,
    z: number,
    radius: number,
    stem: number,
    halfSpan: number,
    height: number,
    depth: number,
    sector: Sector,
  ) {
    const crown = new THREE.Shape(),
      r = radius - 0.035;
    crown.moveTo(-halfSpan, stem);
    crown.lineTo(-r, stem);
    crown.absarc(0, stem, r, Math.PI, 0, true);
    crown.lineTo(halfSpan, stem);
    crown.lineTo(halfSpan, height);
    crown.lineTo(-halfSpan, height);
    crown.closePath();
    const masonry = new THREE.Mesh(
      new THREE.ExtrudeGeometry(crown, {
        depth,
        bevelEnabled: false,
        curveSegments: 20,
      }),
      this.wall,
    );
    masonry.position.set(x, y, z - depth / 2);
    this.part(masonry, sector);
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
        support = terrainHeight(x, z);
      p.setY(i, support);
    }
    geometry.computeVertexNormals();
    const terrain = new THREE.MeshStandardMaterial({
      map: this.pattern("earth"),
      color: 0xa1a48e,
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
    // A supported stone bridge: arch feet meet the court, crowns meet the deck.
    this.box(28, 0.7, 2.6, 0, 7.25, -37, this.stone);
    for (const side of [-1, 1])
      this.box(1, 9.3, 2.6, side * 14, 2.25, -37, this.wall);
    for (const z of [-38.15, -35.85])
      this.box(28, 1.1, 0.3, 0, 8.15, z, this.wall);
    for (let x = -12; x <= 12; x += 4) {
      this.arch(x, 2.4, -37.5, 1.9, 2.6, this.wall);
      this.archBacking(x, 2.4, -37, 1.9, 2.6, 2, 4.56, 2.5, "world");
    }
    // Beyond the last arch: another inhabited-looking volume, never a floating exit.
    this.box(24, 8, 15, 0, 4, -115, this.wall);
    this.box(25, 0.5, 16, 0, 8.3, -115, this.stone);
    for (let x = -10; x <= 10; x += 4)
      this.window(x, 3.5, -107.3, 1.3, 2.6, "world", 0, false);
  }
  private forest() {
    this.ground(18, 31, 0, 0.01, -1.5, "forest", this.earth);
    this.group("forest").add(
      createForest(
        TREES,
        this.bark,
        this.pattern("leaves"),
        this.pattern("fern"),
        OBSTACLES,
      ),
    );
    // An irregular dirt track is only a surface treatment. Roots and leaf litter
    // sit on the same y=0 traversable ground as the shared physics map.
    const mud = new THREE.MeshStandardMaterial({
      map: this.pattern("mud"),
      color: 0xa4a58c,
      roughness: 1,
      vertexColors: true,
    });
    const path = new THREE.BufferGeometry();
    const positions: number[] = [],
      uvs: number[] = [];
    for (let i = 0; i < 30; i++) {
      const z1 = 13 - i * 0.9,
        z2 = z1 - 0.9;
      const center1 = Math.sin(z1 * 0.22) * 0.5,
        center2 = Math.sin(z2 * 0.22) * 0.5;
      const w1 = 1.05 + Math.sin(i * 1.8) * 0.18,
        w2 = 1.05 + Math.sin((i + 1) * 1.8) * 0.18;
      positions.push(
        center1 - w1,
        0.017,
        z1,
        center1 + w1,
        0.017,
        z1,
        center2 + w2,
        0.017,
        z2,
        center1 - w1,
        0.017,
        z1,
        center2 + w2,
        0.017,
        z2,
        center2 - w2,
        0.017,
        z2,
      );
      uvs.push(0, i, 1, i, 1, i + 1, 0, i, 1, i + 1, 0, i + 1);
    }
    path.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    path.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    path.computeVertexNormals();
    this.part(new THREE.Mesh(path, mud), "forest", 0);
    this.gateApproach();
    for (const side of [-1, 1]) {
      // Only the grounded remnants of the forest ruin survive. Their bounds
      // match the existing shared low piers instead of adding a freestanding arch.
      for (const leg of [-1, 1])
        this.box(
          0.26,
          1.1,
          0.4,
          side * 5.8 + leg * 1.09,
          0.55,
          -3.84,
          this.stone,
          "forest",
        );
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
    this.box(1.2, 0.8, 0.9, -3.8, 0.4, 1.3, this.dressedStone, "forest");
    this.box(1.5, 0.12, 1.1, -3.8, 0.85, 1.3, this.dressedStone, "forest");
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
    for (const side of [-1, 1])
      this.torch(
        side * (FOREST_GATE.width / 2 + FOREST_GATE.towerWidth / 2),
        1.92,
        FOREST_GATE.z + FOREST_GATE.towerDepth / 2 + 0.15,
        "forest",
      );
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
  private gateApproach() {
    // The dirt track gradually uncovers a foundation of setts. Keep the top
    // almost flush with the walking surface and continue it through the tunnel.
    const p: number[] = [],
      uv: number[] = [],
      rows: number[][] = [];
    for (let i = 0; i <= 13; i++) {
      const z = FOREST_GATE.z + 9.35 - i * 0.86;
      const spread = Math.min(1, (i + 0.2) / 6);
      const half = 0.1 + spread * (FOREST_GATE.width / 2 - 0.18);
      const center = (1 - spread) * 0.6 * Math.sin(i * 0.85);
      rows.push([
        center - half - rand(i + 71) * 0.12,
        center + half + rand(i + 58) * 0.12,
        z,
      ]);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const [a, b, z] = rows[i],
        [c, d, next] = rows[i + 1];
      for (const [x, sz] of [
        [a, z],
        [b, z],
        [d, next],
        [a, z],
        [d, next],
        [c, next],
      ]) {
        p.push(x, 0.026, sz);
        uv.push(x * 0.67, sz * 0.67);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    this.part(new THREE.Mesh(g, this.causeway), "forest", 0);
    for (const [x, offset, rx, rz] of [
      [-0.18, 10.5, 0.26, 0.16],
      [0.06, 10.2, 0.18, 0.14],
      [0.49, 9.37, 0.28, 0.16],
      [0.68, 9.05, 0.18, 0.13],
      [-0.34, 8.7, 0.22, 0.16],
      [-0.73, 7.55, 0.18, 0.16],
      [1.46, 5.18, 0.24, 0.17],
    ]) {
      const slab = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1.12, 0.035, 6),
        this.causeway,
      );
      slab.scale.set(rx, 1, rz);
      slab.position.set(x, 0.016, FOREST_GATE.z + offset);
      slab.rotation.y = offset * 1.73;
      this.part(slab, "forest", 0.79);
    }
  }
  private court() {
    const s = COURT_STAIR,
      tread = (s.foot - s.landing) / s.steps,
      base = -0.45;
    const courtDepth = s.landing - CHAPEL_THRESHOLD_Z;
    this.ground(
      s.width,
      courtDepth,
      0,
      s.rise,
      s.landing - courtDepth / 2,
      "roofs",
    );
    // The tessellated walking surface above is the sole top face. Leave the
    // foundation walls at their full height without a second coplanar floor.
    const foundation = new THREE.BoxGeometry(
      s.width,
      s.rise - base,
      courtDepth,
    );
    const normals = foundation.getAttribute("normal");
    foundation.setIndex(
      Array.from(foundation.getIndex()!.array).filter(
        (i) => normals.getY(i) < 0.99,
      ),
    );
    foundation.clearGroups();
    const body = new THREE.Mesh(foundation, this.wall);
    body.position.set(0, (s.rise + base) / 2, s.landing - courtDepth / 2);
    this.part(body, "roofs");
    for (let i = 1; i <= s.steps; i++) {
      const top = (i / s.steps) * s.rise;
      const z = s.foot - (i - 0.5) * tread;
      this.box(
        s.width,
        top - base,
        tread,
        0,
        (top + base) / 2,
        z,
        this.stone,
        "roofs",
      );
      if (i % 3 === 0) {
        for (const side of [-1, 1]) {
          const height = top + 0.8 - base;
          this.box(
            0.56,
            height,
            3 * tread,
            side * 7.55,
            base + height / 2,
            z + tread,
            this.wall,
            "roofs",
          );
          this.box(
            0.63,
            0.11,
            3 * tread,
            side * 7.55,
            top + 0.855,
            z + tread,
            this.dressedStone,
            "roofs",
          );
        }
      }
    }
    for (const side of [-1, 1]) {
      this.box(0.45, 1.1, 22, side * 7.6, 2.95, -31, this.wall, "roofs");
      this.ironFence(side * 7.4, -31, 23, Math.PI / 2, "roofs", 3.5);
    }
    for (const { x, z } of COURT_COLUMNS)
      this.cylinder(0.28, 0.43, 4.5, 14, x, 4.65, z, this.stone, "roofs");
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
    const farWall = -70;
    this.ground(
      15.6,
      CHAPEL_THRESHOLD_Z - farWall,
      0,
      base,
      (CHAPEL_THRESHOLD_Z + farWall) / 2,
      sector,
    );
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
    const left = Math.min(...CHAPEL_COLUMNS.map((p) => p.x));
    const right = Math.max(...CHAPEL_COLUMNS.map((p) => p.x));
    for (const z of new Set(CHAPEL_COLUMNS.map((p) => p.z)))
      this.arch(
        (left + right) / 2,
        base,
        z,
        (right - left) / 2,
        3.7,
        this.stone,
        sector,
      );
    for (const { x, z } of CHAPEL_COLUMNS) {
      this.cylinder(0.26, 0.41, 3.7, 16, x, base + 1.85, z, this.stone, sector);
      this.cylinder(0.49, 0.55, 0.2, 16, x, base + 0.1, z, this.stone, sector);
    }
    this.box(15.6, 0.35, 29, 0, base + 8.4, -55.5, this.dark, sector);
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
    for (const x of [3.35, 6.65]) {
      for (let step = 0; step <= 10; step++) {
        const top = base + step * 0.28,
          z = -49 - step;
        this.box(0.12, 0.86, 0.12, x, top + 0.43, z, this.metal, sector);
        if (step % 2 === 0)
          this.box(
            0.25,
            0.16,
            0.25,
            x,
            top + 0.08,
            z,
            this.dressedStone,
            sector,
          );
      }
      for (const lift of [0.49, 0.89]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.105, 0.09, Math.hypot(10, 2.8)),
          this.metal,
        );
        rail.position.set(x, base + 1.4 + lift, -54);
        rail.rotation.x = Math.atan2(2.8, 10);
        this.part(rail, sector);
      }
    }
    this.ironFence(3.35, -63.5, 8.7, Math.PI / 2, sector, 5.2);
    this.ironFence(6.65, -63.5, 9, Math.PI / 2, sector, 5.2);
    const { x, y, z, width, clearHeight } = VESTRY;
    const high = 3.8 - clearHeight;
    this.box(
      2.2,
      high,
      0.27,
      x,
      y + clearHeight + high / 2,
      z,
      this.wall,
      sector,
    );
    this.box(
      2.16,
      0.16,
      0.35,
      x,
      y + clearHeight + 0.08,
      z,
      this.dressedStone,
      sector,
    );
    for (const side of [-1, 1])
      this.box(
        0.19,
        clearHeight,
        0.27,
        x + side * (width / 2 + 0.06),
        y + clearHeight / 2,
        z,
        this.stone,
        sector,
      );
    this.arch(x, y, z, 1.14, 1.9, this.stone, sector);
    this.archBacking(5, 5.2, -60.4, 1.14, 1.9, 1.1, 3.8, 0.38, sector);
    this.box(3.6, 0.3, 8, 5, 9, -64, this.dark, sector);
    this.window(6.43, 6.1, -65, 1.3, 2.1, sector, -Math.PI / 2, true);
    this.chandelier(5, 7.35, -61.9, "chapel");
    this.torch(6.5, 6.5, -61.5, "chapel");
  }
  private crypt() {
    const s: Sector = "crypt",
      b = 2.4;
    this.ground(15.5, 27, 0, b, -89.5, s);
    // Only the six metres between the two existing floors need paving.
    // The masonry extends farther and keys into both end walls.
    const passage = OSSUARY_PASSAGE;
    this.ground(2 * passage.x, 6, 0, b, -73, "chapel");
    for (const side of [-1, 1])
      this.box(
        passage.wallHalf * 2,
        passage.height,
        passage.halfDepth * 2,
        side * passage.x,
        b + passage.height / 2,
        passage.z,
        this.wall,
        "chapel",
      );
    this.box(
      2 * (passage.x + passage.wallHalf),
      0.38,
      passage.halfDepth * 2,
      0,
      b + passage.height,
      passage.z,
      this.dark,
      "chapel",
    );
    for (const z of [-70.2, -73.5, -76.7])
      this.arch(0, b, z, passage.x - 0.03, 1.7, this.stone, "chapel");
    for (const side of [-1, 1]) {
      this.box(0.5, 4.4, 26, side * 7.7, b + 2.2, -89.5, this.wall, s);
    }
    // Roof supports stand between occupied burial/storage bays. Their capitals
    // meet the shared underside of the ceiling.
    for (const { x, z } of CRYPT_COLUMNS) {
      const shaft = CRYPT_CEILING_Y - b - 0.34;
      this.cylinder(
        0.29,
        0.34,
        shaft,
        14,
        x,
        b + 0.16 + shaft / 2,
        z,
        this.stone,
        s,
      );
      this.cylinder(0.39, 0.39, 0.16, 14, x, b + 0.08, z, this.stone, s);
      this.cylinder(
        0.39,
        0.34,
        0.18,
        14,
        x,
        CRYPT_CEILING_Y - 0.09,
        z,
        this.stone,
        s,
      );
    }
    this.cryptFurnishings(b, s);
    // Four slabs leave a real break in the ceiling above the encounter.
    this.box(
      5.3,
      0.35,
      27,
      -5.15,
      CRYPT_CEILING_Y + 0.175,
      -89.5,
      this.dark,
      s,
    );
    this.box(8.6, 0.35, 27, 3.5, CRYPT_CEILING_Y + 0.175, -89.5, this.dark, s);
    this.box(
      1.7,
      0.35,
      7.4,
      -1.65,
      CRYPT_CEILING_Y + 0.175,
      -79.7,
      this.dark,
      s,
    );
    this.box(
      1.7,
      0.35,
      16.4,
      -1.65,
      CRYPT_CEILING_Y + 0.175,
      -94.8,
      this.dark,
      s,
    );
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
    for (const z of [-80.4, -88, -96]) {
      this.torch(-7.3, b + 1.9, z, s);
      this.torch(7.3, b + 1.9, z + 1, s);
    }
    this.chandelier(0, b + 2.7, -87, s);
    this.exitLight(b);
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
    const wrapping = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.065, 0.26, 12),
      this.torchCloth,
    );
    wrapping.position.set(x - sign * 0.46, y + 0.51, z);
    wrapping.rotation.z = sign * 0.08;
    this.part(wrapping, sector, 0);
    this.fire(x - sign * 0.46, y + 0.68, z, sector);
    this.warm.push({
      x: x - sign * 0.64,
      y: y + 0.68,
      z,
      power: sector === "forest" ? 25 : 46,
      range: sector === "forest" ? 4.8 : 7,
      area: sector,
    });
  }
  private chandelier(x: number, y: number, z: number, sector: Sector) {
    // Six swept forged arms, supported by a central stem and a ceiling link.
    // Sockets and drip pans support uneven wax candles, their wicks meet the fire.
    this.cylinder(0.027, 0.034, 1.24, 8, x, y + 0.63, z, this.iron, sector);
    for (const hy of [y - 0.17, y + 0.04, y + 0.78, y + 1.17])
      this.cylinder(0.056, 0.048, 0.055, 10, x, hy, z, this.iron, sector);
    const link = new THREE.Mesh(
      new THREE.TorusGeometry(0.105, 0.018, 6, 16),
      this.iron,
    );
    link.position.set(x, y + 1.36, z);
    this.part(link, sector);
    const ceiling =
      sector === "crypt"
        ? CRYPT_CEILING_Y
        : sector === "chapel" && x > 3
          ? 9
          : 10.8;
    const start = y + 1.47;
    if (ceiling > start)
      this.cylinder(
        0.014,
        0.014,
        ceiling - start,
        6,
        x,
        (ceiling + start) / 2,
        z,
        this.iron,
        sector,
      );
    const finial = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0, -0.24),
          new THREE.Vector2(0.07, -0.2),
          new THREE.Vector2(0.055, -0.12),
          new THREE.Vector2(0.025, -0.06),
        ],
        10,
      ),
      this.iron,
    );
    finial.position.set(x, y, z);
    this.part(finial, sector);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2,
        px = x + Math.sin(a) * 0.68,
        pz = z + Math.cos(a) * 0.68;
      const outward = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      this.curve(
        [
          new THREE.Vector3(x, y - 0.1, z),
          new THREE.Vector3(x, y - 0.04, z).addScaledVector(outward, 0.19),
          new THREE.Vector3(x, y - 0.2, z).addScaledVector(outward, 0.43),
          new THREE.Vector3(px, y - 0.1, pz),
          new THREE.Vector3(px, y + 0.05, pz),
        ],
        0.018,
        this.iron,
        sector,
      );
      this.candle(px, y + 0.015, pz, 0.27 + (i % 3) * 0.038, sector);
    }
    this.warm.push({ x, y: y + 0.34, z, power: 84, range: 9.5, area: sector });
  }
  private curve(
    points: THREE.Vector3[],
    radius: number,
    material: THREE.Material,
    sector: Sector,
  ) {
    this.part(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points),
          14,
          radius,
          5,
          false,
        ),
        material,
      ),
      sector,
    );
  }
  private candle(
    x: number,
    y: number,
    z: number,
    height: number,
    sector: Sector,
  ) {
    const pan = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.025, 0),
          new THREE.Vector2(0.04, 0.027),
          new THREE.Vector2(0.105, 0.037),
          new THREE.Vector2(0.112, 0.056),
        ],
        12,
      ),
      this.iron,
    );
    pan.position.set(x, y, z);
    this.part(pan, sector);
    this.cylinder(0.044, 0.049, 0.11, 10, x, y + 0.09, z, this.iron, sector);
    const base = y + 0.1,
      top = base + height;
    const wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.043, height, 12, 4),
      this.wax,
    );
    const p = wax.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) > height * 0.48) {
        p.setY(i, p.getY(i) - 0.004 * (1 + Math.sin(i * 1.7 + x)));
      }
    wax.geometry.computeVertexNormals();
    wax.position.set(x, base + height / 2, z);
    this.part(wax, sector);
    // Small wax trails are part of the candle, never luminous cylinders.
    for (let i = 0; i < 3; i++) {
      const a = i * 2.3 + x,
        drop = 0.025 + 0.012 * (i % 2);
      this.cylinder(
        0.004,
        0.006,
        drop,
        5,
        x + Math.sin(a) * 0.041,
        top - 0.014 - drop / 2,
        z + Math.cos(a) * 0.041,
        this.wax,
        sector,
      );
    }
    this.cylinder(0.004, 0.006, 0.022, 5, x, top + 0.006, z, this.dark, sector);
    const flameBase = top + 0.031,
      scale = 0.43;
    this.fire(x, flameBase, z, sector, scale);
    this.assetReview.candleFlames.push({
      x,
      z,
      waxTop: top,
      wickTop: top + 0.017,
      flameBase,
      scale,
    });
  }
  private cryptFurnishings(base: number, sector: Sector) {
    for (let index = 0; index < CRYPT_FURNISHINGS.length; index++) {
      const f = CRYPT_FURNISHINGS[index],
        { x, z } = f;
      this.activeFurnishing = { index, bounds: new THREE.Box3() };
      this.box(
        f.hx * 2 - 0.08,
        0.12,
        f.hz * 2 - 0.08,
        x,
        base + 0.06,
        z,
        this.burialStone,
        sector,
      );
      if (f.kind === "sarcophagus") {
        this.box(1.7, 0.68, 0.79, x, base + 0.46, z, this.burialStone, sector);
        const outline = new THREE.Shape();
        outline.moveTo(-0.88, -0.42);
        outline.lineTo(0.88, -0.42);
        outline.lineTo(0.88, 0.42);
        outline.lineTo(-0.88, 0.42);
        outline.closePath();
        const lid = new THREE.Mesh(
          new THREE.ExtrudeGeometry(outline, {
            depth: 0.08,
            bevelEnabled: true,
            bevelSize: 0.045,
            bevelThickness: 0.045,
            bevelSegments: 1,
            steps: 1,
          }),
          this.burialStone,
        );
        lid.rotation.x = -Math.PI / 2;
        lid.position.set(x, base + 0.88, z);
        this.part(lid, sector);
        this.box(1.36, 0.027, 0.57, x, base + 1.005, z, this.dark, sector);
        this.box(
          1.21,
          0.012,
          0.43,
          x,
          base + 1.026,
          z,
          this.burialStone,
          sector,
        );
        for (const side of [-1, 1]) {
          this.box(
            0.055,
            0.44,
            0.045,
            x + side * 0.65,
            base + 0.47,
            z + 0.42,
            this.burialStone,
            sector,
          );
        }
      } else if (f.kind === "ossuary") {
        this.box(
          1.8,
          1.17,
          0.11,
          x,
          base + 0.7,
          z - 0.35,
          this.burialStone,
          sector,
        );
        for (const side of [-1, 1])
          this.box(
            0.12,
            1.2,
            0.78,
            x + side * 0.82,
            base + 0.71,
            z,
            this.burialStone,
            sector,
          );
        for (const h of [0.14, 0.69, 1.28])
          this.box(1.79, 0.08, 0.78, x, base + h, z, this.burialStone, sector);
        for (const sx of [-0.54, 0, 0.54])
          for (const h of [0.2, 0.75])
            this.urn(x + sx, base + h, z + 0.04, sector);
      } else if (f.kind === "memorial") {
        this.box(1.7, 0.64, 0.76, x, base + 0.45, z, this.burialStone, sector);
        this.box(1.82, 0.09, 0.86, x, base + 0.81, z, this.burialStone, sector);
        const plaque = new THREE.Mesh(
          new THREE.BoxGeometry(0.76, 0.045, 0.41),
          this.dark,
        );
        plaque.rotation.x = -0.25;
        plaque.position.set(x, base + 0.88, z + 0.04);
        this.part(plaque, sector);
        for (const sx of [-0.64, 0.64])
          this.candle(x + sx, base + 0.87, z - 0.13, 0.25, sector);
        this.warm.push({
          x,
          y: base + 1.25,
          z,
          power: 17,
          range: 4,
          area: sector,
        });
      } else {
        this.box(0.9, 0.66, 0.75, x - 0.35, base + 0.45, z, this.wood, sector);
        this.box(
          0.74,
          0.44,
          0.66,
          x - 0.34,
          base + 1,
          z - 0.03,
          this.wood,
          sector,
        );
        for (const sx of [-0.7, -0.03]) {
          this.box(
            0.045,
            0.68,
            0.79,
            x + sx,
            base + 0.46,
            z,
            this.iron,
            sector,
          );
          this.box(
            0.045,
            0.45,
            0.7,
            x + sx * 0.85,
            base + 1,
            z - 0.03,
            this.iron,
            sector,
          );
        }
        const barrel = new THREE.Mesh(
          new THREE.LatheGeometry(
            [
              new THREE.Vector2(0.19, 0),
              new THREE.Vector2(0.23, 0.08),
              new THREE.Vector2(0.255, 0.32),
              new THREE.Vector2(0.23, 0.58),
              new THREE.Vector2(0.19, 0.66),
            ],
            12,
          ),
          this.wood,
        );
        barrel.position.set(x + 0.55, base + 0.13, z);
        this.part(barrel, sector);
        for (const h of [0.19, 0.36, 0.68]) {
          const hoop = new THREE.Mesh(
            new THREE.TorusGeometry(h === 0.36 ? 0.253 : 0.222, 0.016, 5, 12),
            this.iron,
          );
          hoop.rotation.x = Math.PI / 2;
          hoop.position.set(x + 0.55, base + h, z);
          this.part(hoop, sector);
        }
        this.cylinder(
          0.189,
          0.189,
          0.025,
          12,
          x + 0.55,
          base + 0.797,
          z,
          this.wood,
          sector,
        );
      }
      const box = this.activeFurnishing.bounds;
      this.assetReview.furnishings.push({
        index,
        kind: f.kind,
        min: box.min.toArray(),
        max: box.max.toArray(),
      });
      this.activeFurnishing = undefined;
    }
  }
  private urn(x: number, y: number, z: number, sector: Sector) {
    const vessel = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.06, 0),
          new THREE.Vector2(0.1, 0.02),
          new THREE.Vector2(0.13, 0.14),
          new THREE.Vector2(0.12, 0.24),
          new THREE.Vector2(0.065, 0.31),
          new THREE.Vector2(0.058, 0.36),
          new THREE.Vector2(0.078, 0.37),
        ],
        12,
      ),
      this.burialStone,
    );
    vessel.position.set(x, y, z);
    this.part(vessel, sector);
    this.cylinder(0.081, 0.072, 0.025, 12, x, y + 0.385, z, this.dark, sector);
  }
  private exitLight(base: number) {
    const shape = new THREE.Shape();
    shape.moveTo(-2.2, 0);
    shape.lineTo(-2.2, 1.67);
    shape.absarc(0, 1.67, 2.2, Math.PI, 0, true);
    shape.lineTo(2.2, 0);
    shape.closePath();
    const material = new THREE.MeshBasicMaterial({
      color: 0xf8ffff,
      transparent: true,
      opacity: 0.76,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: false,
      fog: true,
    });
    this.exitSource = new THREE.Mesh(
      new THREE.ShapeGeometry(shape, 24),
      material,
    );
    this.exitSource.name = "FinalWhiteThreshold";
    this.exitSource.position.set(0, base + 0.025, -103.26);
    this.group("crypt").add(this.exitSource);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!,
      g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "#f4fff9c0");
    g.addColorStop(0.32, "#edf6f279");
    g.addColorStop(1, "#e6efeb00");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    this.exitHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map,
        color: 0xf4fff8,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: true,
      }),
    );
    this.exitHalo.name = "ThresholdMistGlare";
    this.exitHalo.position.set(0, base + 2, -102.75);
    this.exitHalo.scale.set(5.2, 5.2, 1);
    this.group("crypt").add(this.exitHalo);
    this.beam({
      x: 0,
      y: base + 3.2,
      z: -103.12,
      tx: 0,
      ty: base + 0.03,
      tz: -97.3,
      power: 165,
      width: 1.6,
      area: "crypt",
      threshold: true,
    });
  }
  setExitLight(progress: number) {
    this.exitRequest = THREE.MathUtils.clamp(progress, 0, 1);
  }
  private fire(x: number, y: number, z: number, sector: Sector, scale = 1) {
    this.flames.push({ x, y, z, scale });
  }
  private buildFlames() {
    const material = new THREE.MeshBasicMaterial({
      map: this.pattern("fire"),
      transparent: true,
      alphaTest: 0.018,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFireTime = this.flameClock;
      shader.vertexShader =
        "uniform float uFireTime;\nvarying float vFirePhase;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFirePhase=instanceMatrix[3].x*0.37+instanceMatrix[3].z*0.21;
        float flutter=.94+.06*sin(uFireTime*12.0+vFirePhase);
        transformed.y=(transformed.y+.065)*flutter-.065;
        transformed.x+=sin(uFireTime*8.0+vFirePhase)*.014*uv.y;`,
      );
      shader.fragmentShader =
        "uniform float uFireTime;\nvarying float vFirePhase;\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `
 #ifdef USE_MAP
 float tick=uFireTime*9.0+vFirePhase;
 float frame=mod(floor(tick),8.0);
 vec2 uv1=vec2((vMapUv.x+frame)/8.0,vMapUv.y);
 vec2 uv2=vec2((vMapUv.x+mod(frame+1.0,8.0))/8.0,vMapUv.y);
 diffuseColor*=mix(texture2D(map,uv1),texture2D(map,uv2),fract(tick));
 #endif`,
      );
    };
    material.customProgramCacheKey = () =>
      "new0-wick-anchored-textured-fire-fixes2";
    const geometry = new THREE.PlaneGeometry(0.31, 0.55);
    geometry.translate(0, 0.21, 0);
    this.flameOuter = new THREE.InstancedMesh(
      geometry,
      material,
      this.flames.length * 2,
    );
    this.flameOuter.name = "AlwaysBurningTexturedFlames";
    this.root.add(this.flameOuter);
    this.positionFlames();
    this.flameOuter.computeBoundingSphere();
  }
  private positionFlames() {
    if (!this.flameOuter) return;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      for (let side = 0; side < 2; side++) {
        this.fireMatrix.makeRotationY(Math.PI * 0.25 + side * Math.PI * 0.5);
        this.fireMatrix.scale(this.fireScale.setScalar(f.scale));
        this.fireMatrix.setPosition(f.x, f.y, f.z);
        this.flameOuter.setMatrixAt(i * 2 + side, this.fireMatrix);
      }
    }
    this.flameOuter.instanceMatrix.needsUpdate = true;
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
    this.beams.push({
      material,
      area: anchor.area,
      phase: anchor.z * 0.5,
      threshold: anchor.threshold,
    });
  }
  private pattern(kind: string) {
    const cached = this.patterns.get(kind);
    if (cached) return cached;
    if (
      [
        "brick",
        "earth",
        "mud",
        "bark",
        "leaves",
        "fern",
        "fire",
        "torch-wrap",
        "iron",
        "wax",
        "oak",
        "burial-stone",
      ].includes(kind)
    ) {
      const texture = environmentTexture(kind as EnvironmentPattern);
      this.patterns.set(kind, texture);
      return texture;
    }
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
    ending = false,
  ) {
    const dt = Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    const indoors = area === "chapel" || area === "crypt";
    const approach =
      area === "crypt" ? THREE.MathUtils.smoothstep(-player.z, 95, 101) : 0;
    const exit = Math.max(this.exitRequest, ending ? 1 : 0, approach * 0.82);
    const blend = 1 - Math.exp(-dt * 4);
    // Pale bounced light reaches the underside and front of the furnishings.
    // This uses the existing hemisphere, not another mobile point-light pass.
    this.skyLight.groundColor.lerp(
      indoors ? this.indoorBounceColor : this.outdoorBounceColor,
      blend,
    );
    this.skyLight.intensity = THREE.MathUtils.lerp(
      this.skyLight.intensity,
      indoors ? 0.38 : 0.72,
      blend,
    );
    this.moonLight.intensity = THREE.MathUtils.lerp(
      this.moonLight.intensity,
      indoors ? 0.2 : 0.82,
      blend,
    );
    this.bounceLight.intensity = THREE.MathUtils.lerp(
      this.bounceLight.intensity,
      indoors ? 0.14 : 0.17,
      blend,
    );
    for (const [id, group] of this.sectors)
      group.visible =
        id === "world" || Math.abs(CENTERS[id as AreaId] - player.z) < 42;
    for (const b of this.beams)
      b.material.opacity =
        (b.area === area ? 0.12 : 0.045) *
        (b.threshold ? 0.5 + 0.8 * exit : 1) *
        (1 + Math.sin(time * 0.65 + b.phase) * 0.08);
    this.flameClock.value = time;
    const pulse =
      0.94 + Math.sin(time * 2.2) * 0.045 + Math.sin(time * 5.7) * 0.015;
    if (this.exitSource)
      this.exitSource.material.opacity = (0.42 + 0.56 * exit) * pulse;
    if (this.exitHalo)
      (this.exitHalo.material as THREE.SpriteMaterial).opacity =
        (0.09 + 0.4 * exit) * pulse;
  }
}
