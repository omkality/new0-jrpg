import { CRYPT_FURNISHINGS } from "./castle-furnishings.ts";
export type AreaId = "forest" | "roofs" | "chapel" | "crypt";
export type WeaponId = "sword" | "axe" | "spear" | "unarmed" | "relic";
export interface Point {
  x: number;
  z: number;
}
export interface Obstacle extends Point {
  hx: number;
  hz: number;
  minY?: number;
  maxY?: number;
  door?: string;
  chest?: string;
}
export interface Wall extends Obstacle {
  id: string;
  area: AreaId;
  base: number;
  height: number;
  material?: "stone" | "wall" | "dark" | "ashlar";
}
export const AREA_ORDER: AreaId[] = ["forest", "roofs", "chapel", "crypt"];
export const CHAPEL_THRESHOLD_Z = -42;
export const AREAS = {
  forest: {
    name: "Лес у Чёрных ворот",
    start: { x: 0, z: 10 },
    exit: { x: 0, z: -15.4 },
    center: -1,
    enemy: { kind: "effigy", x: -1, z: -6 },
    floor: 0,
  },
  roofs: {
    name: "Воротный двор",
    start: { x: 0, z: -16.5 },
    exit: { x: 0, z: -41.3 },
    center: -29,
    enemy: { kind: "watcher", x: 1, z: -32 },
    floor: 2.4,
  },
  chapel: {
    name: "Собор и верхняя галерея",
    start: { x: 0, z: -42.1 },
    exit: { x: 0, z: -75.5 },
    center: -55,
    enemy: { kind: "gaoler", x: 0, z: -54 },
    floor: 2.4,
  },
  crypt: {
    name: "Зал погребённых",
    start: { x: 0, z: -76.8 },
    exit: { x: 0, z: -101 },
    center: -87,
    enemy: { kind: "mimic", x: -2, z: -85.2 },
    floor: 2.4,
  },
} as const;
export const CHESTS = [
  {
    id: "forest-axe",
    area: "forest",
    x: 4.6,
    z: 4.5,
    y: 0,
    weapon: "axe",
    yaw: -0.18,
  },
  {
    id: "court-spear",
    area: "roofs",
    x: -4.6,
    z: -25.5,
    y: 2.4,
    weapon: "spear",
    yaw: 0.2,
  },
  {
    id: "gallery-sword",
    area: "chapel",
    x: 5,
    z: -65,
    y: 5.2,
    weapon: "sword",
    yaw: 0,
    armour: true,
  },
] as const;
export const KEYS = [
  {
    id: "gate",
    area: "forest",
    x: -3.8,
    z: 1.3,
    y: 0,
    surfaceY: 0.91,
    name: "Ключ Чёрных ворот",
  },
  {
    id: "gallery",
    area: "chapel",
    x: -4.5,
    z: -46,
    y: 2.4,
    surfaceY: 3.42,
    name: "Ключ ризницы",
  },
] as const;
export const COINS = [
  { id: "forest-coins", area: "forest", x: 4.4, z: -8.1, y: 0, amount: 7 },
  { id: "gallery-coins", area: "chapel", x: 4.2, z: -65.7, y: 5.2, amount: 12 },
] as const;
export const POTIONS = [
  { id: "roots", area: "forest", x: -6, z: 4.3, y: 0 },
  { id: "court-cache", area: "roofs", x: 5.7, z: -29.2, y: 2.4 },
  { id: "choir-cache", area: "chapel", x: -5.8, z: -61.4, y: 2.4 },
  { id: "vestry-cache", area: "chapel", x: 5.8, z: -66.4, y: 5.2 },
  { id: "crypt-cache", area: "crypt", x: 5.7, z: -91.2, y: 2.4 },
] as const;
export const ENCOUNTERS = [
  { id: "forest", area: "forest", kind: "effigy", x: -1, z: -6 },
  { id: "forest-scout", area: "forest", kind: "effigy", x: 2, z: 2.7 },
  { id: "roofs", area: "roofs", kind: "watcher", x: 1, z: -32 },
  { id: "court-guard", area: "roofs", kind: "effigy", x: 0, z: -39.2 },
  { id: "chapel", area: "chapel", kind: "gaoler", x: 0, z: -54 },
  { id: "choir-guard", area: "chapel", kind: "watcher", x: -1.4, z: -61.5 },
  { id: "crypt", area: "crypt", kind: "mimic", x: -2, z: -85.2 },
  { id: "crypt-warden", area: "crypt", kind: "watcher", x: 3.6, z: -80.8 },
] as const;
// World-space dimensions shared by both door leaves, the lintel and collision.
export const FOREST_GATE = {
  x: 0,
  z: -14,
  width: 3.2,
  clearance: 3.12,
  towerWidth: 2.45,
  towerDepth: 3.3,
  passageDepth: 2.4,
  swing: Math.PI * 0.474,
} as const;
export const VESTRY = {
  x: 5,
  y: 5.2,
  z: -60.4,
  width: 1.8,
  clearHeight: 2.08,
} as const;
export const DOORS = [
  {
    id: "gate",
    area: "forest",
    x: FOREST_GATE.x,
    z: FOREST_GATE.z,
    y: 0,
    key: "gate",
    width: FOREST_GATE.width,
    name: "Чёрные ворота",
  },
  {
    id: "gallery",
    area: "chapel",
    ...VESTRY,
    key: "gallery",
    name: "Ризница на верхней галерее",
  },
] as const;
export function areaAt(z: number): AreaId {
  return z > -16
    ? "forest"
    : z > CHAPEL_THRESHOLD_Z
      ? "roofs"
      : z > -76
        ? "chapel"
        : "crypt";
}
export const COURT_STAIR = {
  foot: -16,
  landing: -22,
  rise: 2.4,
  width: 15.5,
  steps: 18,
} as const;
export function floorHeight(x: number, z: number) {
  const s = COURT_STAIR;
  if (z >= s.foot) return 0;
  if (z > s.landing) return ((s.foot - z) / (s.foot - s.landing)) * s.rise;
  if (x > 3.45 && x < 6.55 && z <= -49 && z >= -59)
    return 2.4 + ((-49 - z) / 10) * 2.8;
  if (x > 3.45 && x < 6.55 && z < -59 && z >= -68) return 5.2;
  return 2.4;
}
// Every structural solid below is rendered from this same record. A closed room
// cannot acquire a second entrance because its visual and collision walls differ.
export const WALLS: Wall[] = [
  ...[-1, 1].map((side): Wall => ({
    id: `forest-ruin-${side}`,
    area: "forest",
    material: "ashlar",
    x: side * 6.7,
    z: -5,
    hx: 0.5,
    hz: 2.2,
    base: 0,
    height: 1.3,
  })),
  ...[-1, 1].flatMap((side): Wall[] => {
    const opening = FOREST_GATE.width / 2;
    const outer = opening + FOREST_GATE.towerWidth;
    const end = 8.4;
    return [
      {
        id: `gate-tower-${side}`,
        area: "forest",
        material: "ashlar",
        x: FOREST_GATE.x + side * (opening + FOREST_GATE.towerWidth / 2),
        z: FOREST_GATE.z,
        hx: FOREST_GATE.towerWidth / 2,
        hz: FOREST_GATE.towerDepth / 2,
        base: 0,
        height: 6.95,
      },
      {
        id: `gate-wing-${side}`,
        area: "forest",
        material: "ashlar",
        x: FOREST_GATE.x + (side * (outer + end)) / 2,
        z: FOREST_GATE.z,
        hx: (end - outer) / 2,
        hz: 0.65,
        base: 0,
        height: 4.45,
      },
    ];
  }),
  {
    id: "gate-header",
    area: "forest",
    material: "ashlar",
    x: FOREST_GATE.x,
    z: FOREST_GATE.z,
    hx: FOREST_GATE.width / 2,
    hz: FOREST_GATE.passageDepth / 2,
    base: FOREST_GATE.clearance,
    height: 5.65 - FOREST_GATE.clearance,
  },
  ...[-6, -2, 2, 6].map((x): Wall => ({
    id: `bridge-pier-${x}`,
    area: "roofs",
    x,
    z: -37,
    hx: 0.32,
    hz: 0.65,
    base: 2.4,
    height: 2.6,
    material: "stone",
  })),
  {
    id: "vestry-front-left",
    area: "chapel",
    x: 3.7,
    z: -60.4,
    hx: 0.42,
    hz: 0.22,
    base: 5.2,
    height: 3.8,
  },
  {
    id: "vestry-front-right",
    area: "chapel",
    x: 6.3,
    z: -60.4,
    hx: 0.32,
    hz: 0.22,
    base: 5.2,
    height: 3.8,
  },
  {
    id: "vestry-back",
    area: "chapel",
    x: 5,
    z: -68,
    hx: 1.83,
    hz: 0.22,
    base: 5.2,
    height: 3.8,
  },
  {
    id: "vestry-foundation",
    area: "chapel",
    x: 5,
    z: -63.5,
    hx: 1.65,
    hz: 4.5,
    base: 2.4,
    height: 2.5,
  },
  {
    id: "vestry-east-sill",
    area: "chapel",
    x: 6.65,
    z: -64.2,
    hx: 0.18,
    hz: 3.8,
    base: 5.2,
    height: 0.9,
  },
  {
    id: "vestry-east-lintel",
    area: "chapel",
    x: 6.65,
    z: -64.2,
    hx: 0.18,
    hz: 3.8,
    base: 8.2,
    height: 0.8,
  },
  {
    id: "vestry-east-north",
    area: "chapel",
    x: 6.65,
    z: -62.375,
    hx: 0.18,
    hz: 1.975,
    base: 6.1,
    height: 2.1,
  },
  {
    id: "vestry-east-south",
    area: "chapel",
    x: 6.65,
    z: -66.825,
    hx: 0.18,
    hz: 1.175,
    base: 6.1,
    height: 2.1,
  },
  {
    id: "vestry-west-sill",
    area: "chapel",
    x: 3.35,
    z: -64.2,
    hx: 0.18,
    hz: 3.8,
    base: 5.2,
    height: 1.25,
    material: "stone",
  },
  {
    id: "vestry-west-lintel",
    area: "chapel",
    x: 3.35,
    z: -64.2,
    hx: 0.18,
    hz: 3.8,
    base: 8.5,
    height: 0.5,
    material: "stone",
  },
];
export const DRESSING = [
  { kind: "tomb", area: "forest", x: -6.8, z: 4.4, y: 0, yaw: 0 },
  { kind: "tomb", area: "forest", x: -5.1, z: 4.4, y: 0, yaw: 0 },
  { kind: "crate", area: "roofs", x: 4.7, z: -28.2, y: 2.4, yaw: 0.15 },
  { kind: "crate", area: "roofs", x: 6.8, z: -29.3, y: 2.4, yaw: -0.15 },
  { kind: "bench", area: "chapel", x: -4.8, z: -51, y: 2.4, yaw: Math.PI / 2 },
  { kind: "bench", area: "chapel", x: -4.8, z: -54, y: 2.4, yaw: Math.PI / 2 },
  { kind: "tomb", area: "chapel", x: -6.7, z: -61.5, y: 2.4, yaw: 0 },
  { kind: "tomb", area: "chapel", x: -4.8, z: -62.5, y: 2.4, yaw: Math.PI / 2 },
  { kind: "statue", area: "chapel", x: 1.8, z: -66.7, y: 2.4, yaw: Math.PI },
  { kind: "statue", area: "roofs", x: -6.5, z: -31, y: 2.4, yaw: 0.4 },
] as const;
export const COURT_COLUMNS = [-1, 1].flatMap((side) =>
  [-24, -34, -40].map((z) => ({ x: side * 6.6, z })),
);
export const CHAPEL_COLUMNS = [-6.5, 2.85].flatMap((x) =>
  [-43, -51, -58, -67].map((z) => ({ x, z })),
);
export const ARCH_PORTALS = [
  {
    area: "chapel",
    z: -42.3,
    base: 2.4,
    radius: 2.3,
    stem: 2.6,
    wingX: 5,
    wingWidth: 5.7,
    wallHeight: 8.4,
    depth: 0.5,
  },
  {
    area: "chapel",
    z: -69.4,
    base: 2.4,
    radius: 2.3,
    stem: 2.6,
    wingX: 5,
    wingWidth: 5.7,
    wallHeight: 8.4,
    depth: 0.5,
  },
  {
    area: "crypt",
    z: -77.6,
    base: 2.4,
    radius: 2.5,
    stem: 1.7,
    wingX: 5.1,
    wingWidth: 5.6,
    wallHeight: 4.4,
    depth: 0.5,
  },
  {
    area: "crypt",
    z: -103,
    base: 2.4,
    radius: 2.5,
    stem: 1.7,
    wingX: 5.1,
    wingWidth: 5.6,
    wallHeight: 4.4,
    depth: 0.5,
  },
] as const;
// The old service passage joins the chapel threshold to the crypt threshold.
export const OSSUARY_PASSAGE = {
  x: 2.65,
  z: -73.5,
  halfDepth: 4.15,
  wallHalf: 0.24,
  base: 2.4,
  height: 4.18,
} as const;
export const CRYPT_BAYS = [-1, 1].flatMap((side) =>
  [-80, -86, -92, -98].map((z) => ({ x: side * 5.8, z })),
);
export const CRYPT_CEILING_Y = 6.625;
export const CRYPT_COLUMNS = [-1, 1].flatMap((side) =>
  [-83, -89, -95, -101].map((z) => ({ x: side * 6.9, z })),
);
export const OBSTACLES: Obstacle[] = [
  {
    x: VESTRY.x,
    z: VESTRY.z,
    hx: 1.1,
    hz: 0.18,
    minY: VESTRY.y + VESTRY.clearHeight,
    maxY: VESTRY.y + 3.8,
  },
  ...ARCH_PORTALS.map((p) => ({
    x: 0,
    z: p.z,
    hx: p.radius,
    hz: p.depth / 2,
    minY: p.base + p.stem + p.radius,
    maxY: p.base + p.wallHeight,
  })),
  ...ARCH_PORTALS.flatMap((p) =>
    [-1, 1].flatMap((s) => [
      {
        x: s * p.wingX,
        z: p.z,
        hx: p.wingWidth / 2,
        hz: p.depth / 2,
        minY: p.base - 0.1,
        maxY: p.base + p.wallHeight,
      },
      {
        x: s * (p.radius - 0.11),
        z: p.z,
        hx: 0.11,
        hz: 0.18,
        minY: p.base - 0.1,
        maxY: p.base + p.stem,
      },
    ]),
  ),
  ...CHAPEL_COLUMNS.map((p) => ({
    ...p,
    hx: 0.55,
    hz: 0.55,
    minY: 2.3,
    maxY: 10.8,
  })),
  ...[-1, 1].map((s) => ({
    x: s * 7.7,
    z: -89.5,
    hx: 0.25,
    hz: 13,
    minY: 2.3,
    maxY: 6.8,
  })),
  ...CRYPT_COLUMNS.map((p) => ({
    ...p,
    hx: 0.4,
    hz: 0.4,
    minY: 2.3,
    maxY: CRYPT_CEILING_Y,
  })),
  ...COURT_COLUMNS.map((p) => ({
    ...p,
    hx: 0.43,
    hz: 0.43,
    minY: 2.3,
    maxY: 6.9,
  })),
  ...CRYPT_FURNISHINGS.map((p) => ({
    x: p.x,
    z: p.z,
    hx: p.hx,
    hz: p.hz,
    minY: 2.3,
    maxY: 2.4 + p.height,
  })),
  ...[-1, 1].flatMap((side) =>
    [-1, 1].map((leg) => ({
      x: side * 5.8 + leg * 1.09,
      z: -3.84,
      hx: 0.13,
      hz: 0.2,
      minY: -0.1,
      maxY: 1.1,
    })),
  ),
  ...[-1, 1].flatMap((side) =>
    [0, 1, 2].map((i) => ({
      x: side * (4.8 + i * 0.8),
      z: -11,
      hx: 0.35,
      hz: 0.5,
      minY: -0.1,
      maxY: 0.46,
    })),
  ),
  { x: 6.9, z: 3.85, hx: 1.2, hz: 1.05, minY: -0.1, maxY: 0.75 },
  ...DRESSING.map((d) => ({
    x: d.x,
    z: d.z,
    hx:
      d.kind === "bench"
        ? 0.33
        : d.kind === "tomb" && d.yaw !== 0
          ? 0.93
          : 0.43,
    hz:
      d.kind === "bench" ? 1.1 : d.kind === "tomb" && d.yaw === 0 ? 0.93 : 0.43,
    minY: d.y - 0.1,
    maxY:
      d.y +
      (d.kind === "tomb"
        ? 0.8
        : d.kind === "bench"
          ? 1.05
          : d.kind === "crate"
            ? 0.95
            : 2.2),
  })),
  ...WALLS.map((w) => ({ ...w, minY: w.base - 0.1, maxY: w.base + w.height })),
  ...CHESTS.map((c) => ({
    chest: c.id,
    x: c.x,
    z: c.z,
    hx: 0.62,
    hz: 0.46,
    minY: c.y - 0.1,
    maxY: c.y + 1.3,
  })),
  ...DOORS.map((d) => ({
    x: d.x,
    z: d.z,
    hx: d.width / 2,
    hz: 0.18,
    minY: d.y - 0.1,
    maxY: d.y + (d.id === "gate" ? FOREST_GATE.clearance : 2.6),
    door: d.id,
  })),
  // Stair balustrades. The entrance and the lower return stay open.
  { x: 3.35, z: -56, hx: 0.13, hz: 6.7, minY: 2.3, maxY: 6.45 },
  { x: 6.65, z: -58.5, hx: 0.13, hz: 10.5, minY: 2.3, maxY: 6.45 },
  // Both flanks of the covered passage and the lectern alcove.
  ...[-1, 1].map((side) => ({
    x: side * OSSUARY_PASSAGE.x,
    z: OSSUARY_PASSAGE.z,
    hx: OSSUARY_PASSAGE.wallHalf,
    hz: OSSUARY_PASSAGE.halfDepth,
    minY: 2.3,
    maxY: 6.8,
  })),
  { x: -3.3, z: -43.9, hx: 0.15, hz: 0.9, minY: 2.3, maxY: 5.2 },
  { x: -3.3, z: -47.3, hx: 0.15, hz: 0.8, minY: 2.3, maxY: 5.2 },
  { x: -5.4, z: -48.1, hx: 1.4, hz: 0.15, minY: 2.3, maxY: 5.2 },
  { x: -4.5, z: -46, hx: 0.675, hz: 0.55, minY: 2.3, maxY: 3.42 },
  { x: -3.8, z: 1.3, hx: 0.75, hz: 0.55, minY: -0.1, maxY: 0.91 },
];
export const TREES: Point[] = [];
for (let i = 0; i < 66; i++) {
  const side = i % 2 ? -1 : 1;
  const x = side * (7.2 + ((i * 7) % 19) * 0.72);
  const z = 13 - ((i * 11) % 49) * 0.8;
  // The forest ends at the gate. Near trees must not grow through the raised
  // stone courtyard or put their crowns inside its follow-camera corridor.
  if (z < -12.5 && Math.abs(x) < 14) continue;
  TREES.push({ x, z });
  if (Math.abs(x) < 8)
    OBSTACLES.push({ x, z, hx: 0.45, hz: 0.45, minY: -0.3, maxY: 12 });
}
for (const [x, z] of [
  [-5.8, 9.6],
  [5.8, 9.8],
  [-2.3, 5.5],
  [5.9, -0.5],
  [-5.3, -2.4],
  [5.4, -4.2],
  [-4.8, -10.8],
  [5.5, -11.2],
]) {
  TREES.push({ x, z });
  OBSTACLES.push({ x, z, hx: 0.42, hz: 0.42, minY: -0.3, maxY: 12 });
}
