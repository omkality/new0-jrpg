import { ARCH_PORTALS, CHESTS } from "../world-layout.ts";
import type { Point } from "../world-layout.ts";

export const BELL = { x: -4.6, y: 2.4, z: -27.5 } as const;
export const KEEPER_POSITION = { x: 1.35, z: -39.8 } as const;
export const RELIQUARY = { ...CHESTS.find((c) => c.id === "gallery-sword")! };
export const CHOIR_PORTAL = ARCH_PORTALS[0];
export const REAR_PORTAL = ARCH_PORTALS[1];
export const MORTUARY_EXIT = ARCH_PORTALS[3];
export const TOLL = 5;
export const CAIRN = { x: -4.6, y: 2.4, z: -32.1 } as const;
export const VOTIVE = { x: -3.7, y: 2.4, z: -53.2 } as const;
export const COFFER = { x: -3.45, y: 2.4, z: -57.4 } as const;

// At this height the light well at (-1.65, -84.8) falls onto the mirror.
export const MIRROR = { x: -0.8, y: 2.4, z: -85.88 } as const;
export const TABLETS = [
  {
    x: -2.35,
    y: 2.4,
    z: -90.0,
    mark: "Чаша",
    inscription: "Здесь мы оставляли воду для тех, кто уже не мог пить.",
  },
  {
    x: 0,
    y: 2.4,
    z: -91.1,
    mark: "Перо",
    inscription:
      "Ива, первый голос. На камне осталась борозда от длинного пера.",
  },
  {
    x: 2.35,
    y: 2.4,
    z: -90.0,
    mark: "Ладонь",
    inscription:
      "Савва, четвёртый голос. Между буквами уместилась детская ладонь.",
  },
] as const;
export type Memorial = "inscribe" | "rest";
export const LAST_SINGER = 2;

export const SIGNS = {
  thorn: { name: "Терн", path: "M12 21V3 M12 10L6 6 M12 15L19 9 M12 18L6 14" },
  sun: {
    name: "Солнце",
    path: "M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0 M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2",
  },
  wave: { name: "Волна", path: "M2 9q5-7 10 0t10 0 M2 15q5-7 10 0t10 0" },
} as const;
export type Sign = keyof typeof SIGNS;
export const INSCRIPTION: readonly Sign[] = ["wave", "thorn", "sun"];
export const INSCRIPTION_TEXT = INSCRIPTION.map((s) => SIGNS[s].name).join(
  " · ",
);
export type Vow = "one" | "all";
export const STRIKES = { one: [0.32], all: [0.32, 1.55, 2.78] } as const;
export type CourtOption =
  | Sign
  | Vow
  | "pay"
  | "fight"
  | "name"
  | "ask"
  | "speak"
  | "take"
  | "swap"
  | "uncatch"
  | "takeRegen"
  | "drinkRegen"
  | "drinkHeal"
  | "retreat"
  | "shelter"
  | "promise"
  | "left"
  | "right"
  | Memorial;

export function portalBarrier(p: (typeof ARCH_PORTALS)[number]) {
  return {
    x: 0,
    z: p.z,
    hx: p.radius,
    hz: 0.16,
    minY: p.base - 0.1,
    maxY: p.base + p.stem + p.radius,
  };
}
export const BELL_BASE = {
  x: BELL.x,
  z: BELL.z,
  hx: 1.42,
  hz: 0.57,
  minY: 2.25,
  maxY: 4.98,
};
export const RELIC_BASE = {
  x: RELIQUARY.x,
  z: RELIQUARY.z,
  hx: 0.68,
  hz: 0.43,
  minY: RELIQUARY.y - 0.1,
  maxY: RELIQUARY.y + 1.18,
};
export type ViewShot = {
  eye: Point & { y: number };
  target: Point & { y: number };
};
export const CAIRN_SHOT: ViewShot = {
  eye: { x: -3.55, y: 3.79, z: -30.15 },
  target: { x: CAIRN.x, y: 3.03, z: CAIRN.z },
};
export const VOTIVE_SHOT: ViewShot = {
  eye: { x: -2.65, y: 3.8, z: -51.8 },
  target: { x: VOTIVE.x, y: 3.24, z: VOTIVE.z },
};
export const MIRROR_SHOT: ViewShot = {
  eye: { x: 0.2, y: 4.75, z: -80.2 },
  target: { x: -0.23, y: 3.37, z: -88.5 },
};
export function tabletShot(index: number): ViewShot {
  const p = TABLETS[index];
  return {
    eye: { x: p.x + 0.59, y: p.y + 1.37, z: p.z + 2.35 },
    target: { x: p.x, y: p.y + 1.04, z: p.z },
  };
}
export const BELL_SHOT: ViewShot = {
  eye: { x: -3.65, y: 4.57, z: -24.62 },
  target: { x: -4.6, y: 4.02, z: -27.55 },
};
export const RELIC_SHOT: ViewShot = {
  eye: { x: 5.48, y: 7.38, z: -63.05 },
  target: { x: 5, y: 6.23, z: -65 },
};
