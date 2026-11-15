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
}
export interface Wall extends Obstacle {
  id: string;
  area: AreaId;
  base: number;
  height: number;
  material?: "stone" | "wall" | "dark";
}
export const AREA_ORDER: AreaId[] = ["forest", "roofs", "chapel", "crypt"];
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
    name: "Ключ Чёрных ворот",
  },
  {
    id: "gallery",
    area: "chapel",
    x: -4.5,
    z: -46,
    y: 2.4,
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
export const DOORS = [
  {
    id: "gate",
    area: "forest",
    x: 0,
    z: -14,
    y: 0,
    key: "gate",
    width: 3.2,
    name: "Чёрные ворота",
  },
  {
    id: "gallery",
    area: "chapel",
    x: 5,
    z: -60.4,
    y: 5.2,
    key: "gallery",
    width: 1.8,
    name: "Ризница на верхней галерее",
  },
] as const;
export function areaAt(z: number): AreaId {
  return z > -16 ? "forest" : z > -42 ? "roofs" : z > -76 ? "chapel" : "crypt";
}
export function floorHeight(x: number, z: number) {
  if (z >= -16) return 0;
  if (z > -22) return ((-16 - z) / 6) * 2.4;
  if (x > 3.45 && x < 6.55 && z <= -49 && z >= -59)
    return 2.4 + ((-49 - z) / 10) * 2.8;
  if (x > 3.45 && x < 6.55 && z < -59 && z >= -68) return 5.2;
  return 2.4;
}
// Every structural solid below is rendered from this same record. A closed room
// cannot acquire a second entrance because its visual and collision walls differ.
export const WALLS: Wall[] = [
  ...[-1, 1].map(
    (s): Wall => ({
      id: `gate-wing-${s}`,
      area: "forest",
      x: s * 5,
      z: -14,
      hx: 3.4,
      hz: 0.5,
      base: 0,
      height: 8,
    }),
  ),
  {
    id: "gate-header",
    area: "forest",
    x: 0,
    z: -14,
    hx: 1.6,
    hz: 0.5,
    base: 4.25,
    height: 3.75,
  },
  ...[-6, -2, 2, 6].map(
    (x): Wall => ({
      id: `bridge-pier-${x}`,
      area: "roofs",
      x,
      z: -37,
      hx: 0.32,
      hz: 0.65,
      base: 2.4,
      height: 2.6,
      material: "stone",
    }),
  ),
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
  { kind: "tomb", area: "crypt", x: 6.7, z: -91.3, y: 2.4, yaw: 0 },
  { kind: "tomb", area: "crypt", x: 4.8, z: -92.5, y: 2.4, yaw: Math.PI / 2 },
] as const;
export const OBSTACLES: Obstacle[] = [
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
    maxY: d.y + 1.9,
  })),
  ...WALLS.map((w) => ({ ...w, minY: w.base - 0.1, maxY: w.base + w.height })),
  ...CHESTS.map((c) => ({
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
    maxY: d.y + 2.6,
    door: d.id,
  })),
  // Stair balustrades. The entrance and the lower return stay open.
  { x: 3.35, z: -56, hx: 0.13, hz: 6.7 },
  { x: 6.65, z: -58.5, hx: 0.13, hz: 10.5 },
  // Real portal wings and the lectern alcove.
  ...[-42.3, -69.4].flatMap((z) =>
    [-1, 1].map((s) => ({
      x: s * 5,
      z,
      hx: 2.85,
      hz: 0.25,
      minY: 2.3,
      maxY: 10.8,
    })),
  ),
  { x: -3.3, z: -43.9, hx: 0.15, hz: 0.9, minY: 2.3, maxY: 5.2 },
  { x: -3.3, z: -47.3, hx: 0.15, hz: 0.8, minY: 2.3, maxY: 5.2 },
  { x: -5.4, z: -48.1, hx: 1.4, hz: 0.15, minY: 2.3, maxY: 5.2 },
  ...[-45, -51, -58, -65].flatMap((z) =>
    [-6.5, 2.85].map((x) => ({ x, z, hx: 0.33, hz: 0.33 })),
  ),
  { x: -4.5, z: -46, hx: 0.55, hz: 0.48 },
  { x: -3.8, z: 1.3, hx: 0.48, hz: 0.4 },
];
export const TREES: Point[] = [];
for (let i = 0; i < 66; i++) {
  const side = i % 2 ? -1 : 1;
  const x = side * (7.2 + ((i * 7) % 19) * 0.72);
  const z = 13 - ((i * 11) % 49) * 0.8;
  TREES.push({ x, z });
  if (Math.abs(x) < 8) OBSTACLES.push({ x, z, hx: 0.45, hz: 0.45 });
}
