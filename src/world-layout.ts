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
    name: "Ключ верхней галереи",
  },
] as const;
export const COINS = [
  { id: "forest-coins", area: "forest", x: 4.4, z: -8.1, y: 0, amount: 7 },
  { id: "gallery-coins", area: "chapel", x: 4.2, z: -65.7, y: 5.2, amount: 12 },
] as const;
export const DOORS = [
  { id: "gate", area: "forest", x: 0, z: -14, y: 0, key: "gate", width: 2.9 },
  {
    id: "gallery",
    area: "chapel",
    x: 5,
    z: -60.4,
    y: 5.2,
    key: "gallery",
    width: 1.8,
  },
] as const;
export function areaAt(z: number): AreaId {
  return z > -16 ? "forest" : z > -42 ? "roofs" : z > -76 ? "chapel" : "crypt";
}
export function floorHeight(x: number, z: number) {
  if (z >= -16) return 0;
  if (z > -22) return ((-16 - z) / 6) * 2.4;
  if (x > 3.45 && z <= -49 && z >= -59) return 2.4 + ((-49 - z) / 10) * 2.8;
  if (x > 3.45 && z < -59 && z >= -68) return 5.2;
  if (x > 3.45 && z < -68 && z >= -74) return 5.2 - ((-68 - z) / 6) * 2.8;
  return 2.4;
}
export const OBSTACLES: Obstacle[] = [
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
  { x: -5, z: -14, hx: 3.35, hz: 0.4 },
  { x: 5, z: -14, hx: 3.35, hz: 0.4 },
  // Stair balustrades. The entrance and the lower return stay open.
  { x: 3.35, z: -56, hx: 0.13, hz: 6.7 },
  { x: 6.65, z: -58.5, hx: 0.13, hz: 10.5 },
  { x: 3.35, z: -65.3, hx: 0.13, hz: 2.8 },
  { x: 3.35, z: -71, hx: 0.13, hz: 2.7 },
  { x: 3.7, z: -60.4, hx: 0.42, hz: 0.22, minY: 4.9, maxY: 9 },
  { x: 6.3, z: -60.4, hx: 0.32, hz: 0.22, minY: 4.9, maxY: 9 },
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
