export type Command = "attack" | "item" | "regen" | "skill";
export type ChapterWeapon = "sword" | "spear" | "axe";
type EnemyWeapon = "claws" | "axe" | "fangs";
export const CRITICAL_CHANCE = {
  sword: 16,
  spear: 12,
  claws: 8,
  axe: 20,
  fangs: 10,
} as const;
export const CRITICAL_MULTIPLIER = 1.5;
export const freshBattleSeed = () => Math.floor(Math.random() * 0x1_0000_0000);

export type Outcome = "choosing" | "won" | "lost";

export interface Encounter {
  actor: string;
  weapon: EnemyWeapon;
  name: string;
  hp: number;
  strike: number;
  skill: number;
  heal: number;
  reward: number;
  intents: readonly { label: string; damage: number; breakable?: boolean }[];
}
export const SCOUT: Encounter = {
  actor: "forest-scout",
  weapon: "claws",
  name: "Певчая терновника",
  hp: 82,
  strike: 14,
  skill: 40,
  heal: 45,
  reward: 5,
  intents: [
    { label: "Удар когтем", damage: 18 },
    { label: "Размах крыла", damage: 32 },
    { label: "Удар когтем", damage: 18 },
  ],
};
export const CHARGE_LIMIT = 2;
export const REGEN_HEAL = 12;
export const REGEN_TURNS = 3;
export const TECHNIQUES = {
  sword: {
    basic: "Рассечь",
    heavy: "Тяжёлый удар",
    strikeBonus: 0,
    skillBonus: 0,
  },
  spear: { basic: "Укол", heavy: "Выпад", strikeBonus: 4, skillBonus: 3 },
  axe: { basic: "Рубануть", heavy: "Расколоть", strikeBonus: 6, skillBonus: 8 },
} as const;
export const KEEPER: Encounter = {
  actor: "roofs",
  weapon: "axe",
  name: "Железный причетник",
  hp: 80,
  strike: 16,
  skill: 36,
  heal: 45,
  reward: 3,
  intents: [
    { label: "Подсечка секирой", damage: 6 },
    { label: "Удар обухом", damage: 8 },
    { label: "Удар затвора", damage: 38, breakable: true },
  ],
};
export const MIMIC: Encounter = {
  actor: "crypt",
  weapon: "fangs",
  name: "Алчный реликварий",
  hp: 76,
  strike: 15,
  skill: 38,
  heal: 45,
  reward: 6,
  intents: [
    { label: "Щелчок челюстей", damage: 8 },
    { label: "Укус", damage: 12 },
    { label: "Мёртвая хватка", damage: 24, breakable: true },
  ],
};
export interface Supplies {
  hp: number;
  maxHp: number;
  flasks: number;
  regenFlasks?: number;
}
export interface Battle extends Supplies {
  regenFlasks: number;
  regenTurns: number;
  chanceState: number;
  weapon: ChapterWeapon;
  attempt: number;
  turn: number;
  enemyHp: number;
  charge: number;
  outcome: Outcome;
}
export function beginEncounter(
  spec: Encounter,
  supplies: Supplies,
  attempt: number,
  weapon: ChapterWeapon = "sword",
  seed = freshBattleSeed(),
): Battle {
  return {
    ...supplies,
    regenFlasks: supplies.regenFlasks ?? 0,
    regenTurns: 0,
    chanceState: (seed ^ Math.imul(attempt, 0x9e3779b9)) >>> 0,
    weapon,
    attempt,
    turn: 1,
    enemyHp: spec.hp,
    charge: 0,
    outcome: "choosing",
  };
}
export function intent(spec: Encounter, battle: Battle) {
  return spec.intents[(battle.turn - 1) % spec.intents.length];
}
export function unavailable(battle: Battle, command: Command) {
  if (command === "skill" && battle.charge < CHARGE_LIMIT)
    return battle.charge === 0 ? "Ещё 2 атаки" : "Ещё 1 атака";
  if (command === "item") {
    if (battle.flasks < 1) return "Нет зелий";
    if (battle.hp === battle.maxHp) return "Здоровье полное";
  }
  if (command === "regen") {
    if (battle.regenFlasks < 1) return "Нет зелья регенерации";
    if (battle.regenTurns > 0) return "Уже действует";
    if (battle.hp === battle.maxHp) return "Здоровье полное";
  }
  return "";
}
export function force(
  spec: Encounter,
  weapon: ChapterWeapon,
  command: Command,
) {
  if (command === "item" || command === "regen") return 0;
  return command === "skill"
    ? spec.skill + TECHNIQUES[weapon].skillBonus
    : spec.strike + TECHNIQUES[weapon].strikeBonus;
}
export function weaponStats(weapon: ChapterWeapon) {
  const range = (command: "attack" | "skill") => {
    const damage = [SCOUT, KEEPER, MIMIC].map((spec) =>
      force(spec, weapon, command),
    );
    return `${Math.min(...damage)}–${Math.max(...damage)}`;
  };
  return {
    damage: range("attack"),
    critical: CRITICAL_CHANCE[weapon],
    skill: range("skill"),
  };
}
// Step the copied snapshot only when a blow lands. Replaying an accepted turn
// from the same state gives the same damage, including the opponent's reply.
function resolveStrike(
  state: Battle,
  weapon: ChapterWeapon | EnemyWeapon,
  baseDamage: number,
  targetHp: number,
) {
  state.chanceState =
    (Math.imul(state.chanceState, 1664525) + 1013904223) >>> 0;
  const critical =
    state.chanceState / 0x1_0000_0000 < CRITICAL_CHANCE[weapon] / 100;
  const power = critical
    ? Math.round(baseDamage * CRITICAL_MULTIPLIER)
    : baseDamage;
  return {
    damage: Math.min(power, targetHp),
    critical,
    lethal: power >= targetHp,
  };
}

// Resolve once. The two snapshots let the view play the accepted events in order.
export function takeTurn(
  spec: Encounter,
  current: Battle,
  command: Command,
  attempt: number,
  turn: number,
) {
  if (
    current.outcome !== "choosing" ||
    current.attempt !== attempt ||
    current.turn !== turn ||
    unavailable(current, command)
  )
    return;
  const action = { ...current };
  const strike =
    command === "item" || command === "regen"
      ? null
      : resolveStrike(
          action,
          current.weapon,
          force(spec, current.weapon, command),
          current.enemyHp,
        );
  if (!strike) {
    if (command === "regen") {
      action.regenFlasks--;
      action.regenTurns = REGEN_TURNS;
    } else {
      action.flasks--;
      action.hp = Math.min(action.maxHp, action.hp + spec.heal);
    }
  } else {
    action.enemyHp -= strike.damage;
    action.charge =
      command === "skill" ? 0 : Math.min(CHARGE_LIMIT, action.charge + 1);
  }
  const regenerated = action.regenTurns
    ? Math.min(REGEN_HEAL, action.maxHp - action.hp)
    : 0;
  if (action.regenTurns) {
    action.hp += regenerated;
    action.regenTurns--;
  }
  const incoming = intent(spec, current);
  const interrupted =
    action.enemyHp > 0 && command === "skill" && !!incoming.breakable;
  const next: Battle = { ...action, turn: turn + 1 };
  const reply =
    action.enemyHp > 0 && !interrupted
      ? {
          label: incoming.label,
          ...resolveStrike(next, spec.weapon, incoming.damage, next.hp),
        }
      : null;
  if (reply) next.hp -= reply.damage;
  next.outcome =
    next.enemyHp === 0 ? "won" : next.hp === 0 ? "lost" : "choosing";
  return {
    command,
    before: current,
    action,
    strike,
    reply,
    next,
    interrupted,
    regenerated,
  };
}
export type TurnResult = NonNullable<ReturnType<typeof takeTurn>>;
