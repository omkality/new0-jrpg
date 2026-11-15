// Shared with asset validation. Units are metres, before the hand attachment.
export const WEAPONS = {
  sword: {
    name: "Длинный меч",
    damage: 1,
    reach: 2.05,
    tempo: 1,
    cost: 1,
    asset: "weapon-sword",
  },
  axe: {
    name: "Секира палача",
    damage: 1.5,
    reach: 1.9,
    tempo: 0.83,
    cost: 1.2,
    asset: "weapon-axe",
  },
  spear: {
    name: "Погребальное копьё",
    damage: 0.9,
    reach: 2.7,
    tempo: 1.1,
    cost: 0.82,
    asset: "weapon-spear",
  },
  unarmed: {
    name: "Пустые руки",
    damage: 0.25,
    reach: 1.1,
    tempo: 1,
    cost: 0.4,
    asset: "",
  },
  relic: {
    name: "Лунный серп",
    damage: 1,
    reach: 2.05,
    tempo: 1,
    cost: 1,
    asset: "weapon-sword",
  },
} as const;
export const RELIC_BLADE = {
  widthScale: 0.25,
  lengthScale: 0.9,
  minX: -0.13,
  maxX: 0.56,
  maxY: 1.19,
  baseY: 0.11,
  halfThickness: 0.026,
} as const;

// Rigid hand attachment, shared by runtime and offline contact validation.
export const WEAPON_MOUNTS = {
  sword: { scale: 0.79, twist: 0 },
  axe: { scale: 0.86, twist: Math.PI / 2 },
  spear: { scale: 0.7, twist: 0 },
  relic: { scale: 0.79, twist: 0 },
  unarmed: { scale: 1, twist: 0 },
} as const;
