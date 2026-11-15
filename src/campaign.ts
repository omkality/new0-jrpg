import {
  CombatGame,
  ENEMIES,
  type Fighter,
  type EnemyKind,
  type MoveInput,
  type GameEvent,
} from "./game.ts";
import {
  AREAS,
  AREA_ORDER,
  CHESTS,
  KEYS,
  COINS,
  DOORS,
  OBSTACLES,
  areaAt,
  floorHeight,
  type AreaId,
  type Obstacle,
  type WeaponId,
} from "./world-layout.ts";
import { WEAPONS } from "./weapon-spec.ts";

export type ScenarioId = AreaId | "defeat" | "journey";
export const SCENARIOS = {
  forest: "Лес · секира и ключ ворот",
  roofs: "Воротный двор · копьё и сброс оружия",
  chapel: "Собор · лестница и запертая галерея",
  crypt: "Мимик · победа",
  defeat: "Мимик · поражение",
  journey: "Связный маршрут через четыре локации",
} as const;
export type EnemyState = Fighter & { kind: EnemyKind };
export interface Drop {
  active: boolean;
  weapon: WeaponId;
  x: number;
  y: number;
  z: number;
  serial: number;
}
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

export class Campaign extends CombatGame {
  scenario: ScenarioId = "journey";
  enemies = new Map<AreaId, EnemyState>();
  openedChests = new Map<string, number>();
  lootedChests = new Set<string>();
  collectedKeys = new Set<string>();
  keys = new Set<string>();
  collectedCoins = new Set<string>();
  openDoors = new Set<string>();
  completedAreas = new Set<AreaId>();
  coins = 0;
  drops: Drop[] = Array.from({ length: 12 }, () => ({
    active: false,
    weapon: "sword",
    x: 0,
    y: 0,
    z: 0,
    serial: 0,
  }));
  private serial = 0;
  private activeArea: AreaId = "forest";
  mimicAwake = false;
  mimicAwokeAt = 0;
  constructor() {
    super();
    this.startScenario("journey");
    this.phase = "intro";
  }
  get location(): AreaId {
    return areaAt(this.player.z);
  }
  startScenario(id: ScenarioId) {
    this.scenario = id;
    const area: AreaId =
      id === "journey" ? "forest" : id === "defeat" ? "crypt" : id;
    super.start(AREAS[area].enemy.kind);
    this.bounds = { minX: -7.8, maxX: 7.8, minZ: -103, maxZ: 12 };
    this.heightAt = floorHeight;
    this.obstacles = OBSTACLES;
    this.enemies.clear();
    for (const a of AREA_ORDER) {
      const spec = AREAS[a].enemy;
      this.enemies.set(a, {
        ...this.enemy,
        x: spec.x,
        y: floorHeight(spec.x, spec.z),
        z: spec.z,
        yaw: 0,
        kind: spec.kind,
        hp: ENEMIES[spec.kind].hp,
        maxHp: ENEMIES[spec.kind].hp,
        time: 0,
        mode: "idle",
        speed: 0,
      });
    }
    const start = AREAS[area].start;
    this.player.x = start.x;
    this.player.z = start.z;
    this.player.y = floorHeight(start.x, start.z);
    this.player.weapon = id === "chapel" ? "spear" : "sword";
    this.activeArea = area;
    this.enemy = this.enemies.get(area)!;
    this.openedChests.clear();
    this.lootedChests.clear();
    this.collectedKeys.clear();
    this.keys.clear();
    this.openDoors.clear();
    this.collectedCoins.clear();
    this.completedAreas.clear();
    this.coins = 0;
    this.serial = 0;
    this.mimicAwake = false;
    this.mimicAwokeAt = 0;
    for (const drop of this.drops) drop.active = false;
    this.enemyDormant = area === "crypt";
  }
  protected override isObstacleActive(o: Obstacle) {
    return !o.door || !this.openDoors.has(o.door);
  }
  private notify(type: GameEvent["type"], label: string) {
    this.events.push({ type, x: this.player.x, z: this.player.z, label });
  }
  dropWeapon() {
    const p = this.player;
    if (
      p.weapon === "unarmed" ||
      p.hp <= 0 ||
      p.mode === "attack" ||
      p.mode === "dodge"
    )
      return false;
    let slot = this.drops.find((d) => !d.active);
    if (!slot)
      slot = this.drops.reduce((a, b) => (a.serial < b.serial ? a : b));
    slot.active = true;
    slot.weapon = p.weapon;
    slot.serial = ++this.serial;
    slot.x = p.x + Math.cos(p.yaw) * 0.7;
    slot.z = p.z - Math.sin(p.yaw) * 0.7;
    slot.y = floorHeight(slot.x, slot.z) + 0.06;
    p.weapon = "unarmed";
    this.notify("drop", "Оружие оставлено на земле");
    return true;
  }
  private equip(weapon: WeaponId) {
    if (this.player.weapon !== "unarmed") this.dropWeapon();
    this.player.weapon = weapon;
    this.notify("weapon", WEAPONS[weapon].name);
  }
  override interact() {
    const p = this.player;
    if (
      p.hp <= 0 ||
      this.phase === "intro" ||
      this.phase === "finished" ||
      p.mode === "attack" ||
      p.mode === "dodge"
    )
      return;
    for (const c of CHESTS) {
      if (
        Math.abs(p.y - c.y) > 0.8 ||
        distance(p, c) > 1.65 ||
        this.lootedChests.has(c.id)
      )
        continue;
      const opened = this.openedChests.get(c.id);
      if (opened === undefined) {
        this.openedChests.set(c.id, this.elapsed);
        this.notify("secret", "Сундук открыт");
        return;
      }
      if (this.elapsed - opened < 0.7) return;
      this.lootedChests.add(c.id);
      this.equip(c.weapon);
      this.secrets.add(c.id);
      return;
    }
    for (const key of KEYS)
      if (
        !this.collectedKeys.has(key.id) &&
        Math.abs(p.y - key.y) < 0.8 &&
        distance(p, key) < 1.7
      ) {
        this.collectedKeys.add(key.id);
        this.keys.add(key.id);
        this.secrets.add("key-" + key.id);
        this.notify("secret", key.name);
        return;
      }
    for (const coin of COINS)
      if (
        !this.collectedCoins.has(coin.id) &&
        Math.abs(p.y - coin.y) < 0.8 &&
        distance(p, coin) < 1.65
      ) {
        this.collectedCoins.add(coin.id);
        this.coins += coin.amount;
        this.notify("secret", `Найдено монет: ${coin.amount}`);
        return;
      }
    for (const door of DOORS)
      if (
        !this.openDoors.has(door.id) &&
        Math.abs(p.y - door.y) < 0.8 &&
        distance(p, door) < 2.1
      ) {
        if (!this.keys.has(door.key)) {
          this.notify("door", "Нужен ключ");
          return;
        }
        this.keys.delete(door.key);
        this.openDoors.add(door.id);
        this.notify(
          "door",
          door.id === "gate"
            ? "Чёрные ворота открыты"
            : "Верхняя галерея открыта",
        );
        return;
      }
    const mimic = this.enemies.get("crypt")!;
    if (
      !this.mimicAwake &&
      this.location === "crypt" &&
      distance(p, mimic) < 1.9
    ) {
      this.mimicAwake = true;
      this.mimicAwokeAt = this.elapsed;
      this.enemyDormant = false;
      mimic.mode = "recover";
      mimic.time = 0;
      this.notify("secret", "Это не обычный сундук");
      return;
    }
    for (const drop of this.drops)
      if (
        drop.active &&
        Math.abs(p.y - drop.y) < 0.8 &&
        distance(p, drop) < 1.4
      ) {
        const weapon = drop.weapon;
        drop.active = false;
        this.equip(weapon);
        return;
      }
    const destination =
      this.scenario === "journey"
        ? AREAS.crypt.exit
        : AREAS[this.scenario === "defeat" ? "crypt" : this.scenario].exit;
    if (
      distance(p, destination) < 1.4 &&
      (this.scenario === "journey"
        ? this.completedAreas.size === 4
        : this.enemy.hp <= 0)
    ) {
      this.phase = "finished";
      this.set(p, "idle");
      p.speed = 0;
    }
  }
  override get nearby() {
    const p = this.player;
    if (p.hp <= 0) return "";
    for (const c of CHESTS)
      if (
        !this.lootedChests.has(c.id) &&
        Math.abs(p.y - c.y) < 0.8 &&
        distance(p, c) < 1.65
      )
        return this.openedChests.has(c.id)
          ? `Взять: ${WEAPONS[c.weapon].name}`
          : "Открыть сундук";
    for (const k of KEYS)
      if (
        !this.collectedKeys.has(k.id) &&
        Math.abs(p.y - k.y) < 0.8 &&
        distance(p, k) < 1.7
      )
        return "Взять ключ";
    for (const c of COINS)
      if (
        !this.collectedCoins.has(c.id) &&
        Math.abs(p.y - c.y) < 0.8 &&
        distance(p, c) < 1.65
      )
        return "Собрать монеты";
    for (const d of DOORS)
      if (
        !this.openDoors.has(d.id) &&
        Math.abs(p.y - d.y) < 0.8 &&
        distance(p, d) < 2.1
      )
        return this.keys.has(d.key) ? "Открыть дверь ключом" : "Заперто";
    if (
      this.location === "crypt" &&
      !this.mimicAwake &&
      distance(p, this.enemy) < 1.9
    )
      return "Открыть сундук";
    for (const d of this.drops)
      if (d.active && Math.abs(p.y - d.y) < 0.8 && distance(p, d) < 1.4)
        return `Поднять: ${WEAPONS[d.weapon].name}`;
    return this.enemy.hp <= 0 ? "Продолжить путь" : "";
  }
  override update(dt: number, input: MoveInput) {
    if (
      this.phase !== "intro" &&
      this.phase !== "finished" &&
      this.player.hp > 0
    ) {
      const location = this.location;
      if (location !== this.activeArea) {
        this.activeArea = location;
        this.enemy = this.enemies.get(location)!;
        this.enemyDormant = location === "crypt" && !this.mimicAwake;
        this.phase = this.enemy.hp > 0 ? "playing" : "won";
      }
    }
    super.update(dt, input);
    for (const [id, enemy] of this.enemies) {
      if (enemy !== this.enemy && enemy.mode === "dead") enemy.time += dt;
      if (enemy.hp <= 0) this.completedAreas.add(id);
    }
    if (
      this.enemy.kind === "mimic" &&
      !this.mimicAwake &&
      this.enemy.hp < this.enemy.maxHp
    ) {
      this.mimicAwake = true;
      this.mimicAwokeAt = this.elapsed;
      this.enemyDormant = false;
    }
  }
}
