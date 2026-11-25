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
  POTIONS,
  ENCOUNTERS,
  OBSTACLES,
  areaAt,
  floorHeight,
  type AreaId,
  type Obstacle,
  type WeaponId,
} from "./world-layout.ts";
import { WEAPONS } from "./weapon-spec.ts";

export type ScenarioId =
  | AreaId
  | "defeat"
  | "journey"
  | "ambush"
  | "healing"
  | "locked"
  | "unarmoured"
  | "escape";
export const SCENARIOS = {
  forest: "Лес / секира и ключ ворот",
  roofs: "Воротный двор / копьё и сброс оружия",
  chapel: "Собор / лестница и запертая галерея",
  crypt: "Мимик / победа",
  defeat: "Мимик / поражение",
  journey: "Связный маршрут через четыре локации",
  ambush: "Засада во время осмотра сундука",
  healing: "Скрытое зелье и прерванное лечение",
  locked: "Запертая ризница и награда за исследование",
  unarmoured: "Риск без брони и зелий",
  escape: "Короткий путь без ризницы и боя с мимиком",
} as const;
export type EnemyState = Fighter & {
  kind: EnemyKind;
  id: string;
  area: AreaId;
};
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
  chests: readonly (typeof CHESTS)[number][] = CHESTS;
  scenario: ScenarioId = "journey";
  enemies = new Map<string, EnemyState>();
  openedChests = new Map<string, number>();
  lootedChests = new Set<string>();
  collectedKeys = new Set<string>();
  keys = new Set<string>();
  collectedCoins = new Set<string>();
  openDoors = new Set<string>();
  completedAreas = new Set<AreaId>();
  coins = 0;
  collectedPotions = new Set<string>();
  flasks = 0;
  inspecting: string | null = null;
  inspectionAt = 0;
  private healingPending = false;
  healed = 0;
  interruptedHeals = 0;
  interruptedInspections = 0;
  doorOpenedAt = new Map<string, number>();
  doorSwing = new Map<string, number>();
  static readonly FLASK_HEAL = 45;
  static readonly FLASK_CAPACITY = 3;
  protected override get opponents() {
    return [...this.enemies.values()].filter(
      (e) => e.area === this.location || distance(this.player, e) < 6.5,
    );
  }
  get foes() {
    return this.opponents.filter((e) => e.hp > 0 && !this.asleep(e));
  }
  protected override asleep(e: Fighter) {
    return e.kind === "mimic" && !this.mimicAwake;
  }
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
    const area: AreaId = ["journey", "ambush", "healing", "escape"].includes(id)
      ? "forest"
      : ["defeat", "unarmoured"].includes(id)
        ? "crypt"
        : id === "locked"
          ? "chapel"
          : (id as AreaId);
    super.start(AREAS[area].enemy.kind);
    this.bounds = { minX: -7.1, maxX: 7.1, minZ: -103, maxZ: 12 };
    this.heightAt = floorHeight;
    this.obstacles = OBSTACLES;
    this.enemies.clear();
    for (const spec of ENCOUNTERS) {
      this.enemies.set(spec.id, {
        ...this.enemy,
        x: spec.x,
        y: floorHeight(spec.x, spec.z),
        z: spec.z,
        yaw: 0,
        kind: spec.kind,
        weapon:
          spec.kind === "gaoler"
            ? "axe"
            : spec.kind === "effigy"
              ? "unarmed"
              : "sword",
        id: spec.id,
        area: spec.area,
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
    this.flasks =
      this.healed =
      this.interruptedHeals =
      this.interruptedInspections =
        0;
    this.collectedPotions.clear();
    this.inspecting = null;
    this.healingPending = false;
    this.doorOpenedAt.clear();
    this.doorSwing.clear();
    this.serial = 0;
    this.mimicAwake = false;
    this.mimicAwokeAt = 0;
    for (const drop of this.drops) drop.active = false;
    this.enemyDormant = area === "crypt";
  }
  protected override isObstacleActive(o: Obstacle) {
    return (
      !o.door ||
      !this.openDoors.has(o.door) ||
      this.elapsed - (this.doorOpenedAt.get(o.door) ?? -100) < 0.65
    );
  }
  cancelInspection(reason = "") {
    if (!this.inspecting) return;
    this.inspecting = null;
    if (reason) {
      this.interruptedInspections++;
      this.notify("secret", reason);
    }
  }
  override attack() {
    this.cancelInspection();
    super.attack();
  }
  override dodge(move: { x: number; z: number }) {
    this.cancelInspection();
    super.dodge(move);
  }
  override damagePlayer(amount: number, source: Fighter = this.enemy) {
    const hit = super.damagePlayer(amount, source);
    if (hit) {
      this.cancelInspection("Удар прервал осмотр");
      if (this.healingPending) {
        this.interruptedHeals++;
        this.healingPending = false;
        this.notify("secret", "Зелье потеряно: лечение прервано");
      }
    }
    return hit;
  }
  heal() {
    const p = this.player;
    if (
      p.hp <= 0 ||
      p.hp >= p.maxHp ||
      this.flasks <= 0 ||
      !["idle", "move", "guard"].includes(p.mode) ||
      this.phase === "intro" ||
      this.phase === "finished"
    )
      return false;
    this.cancelInspection();
    this.flasks--;
    this.healingPending = true;
    this.set(p, "heal");
    p.time = 0;
    this.notify("secret", "Пьём зелье: уязвимость до конца глотка");
    return true;
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
      p.mode === "dodge" ||
      p.mode === "heal"
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
    this.contextAction()?.run();
  }
  override get nearby() {
    return this.contextAction()?.label ?? "";
  }
  private contextAction(): { label: string; run: () => void } | undefined {
    const p = this.player;
    if (
      p.hp <= 0 ||
      this.phase === "intro" ||
      this.phase === "finished" ||
      p.mode === "attack" ||
      p.mode === "dodge" ||
      p.mode === "heal" ||
      p.mode === "hit"
    )
      return;

    for (const chest of this.chests) {
      if (
        Math.abs(p.y - chest.y) > 0.8 ||
        distance(p, chest) > 1.65 ||
        this.lootedChests.has(chest.id)
      )
        continue;
      const opened = this.openedChests.get(chest.id);
      if (opened === undefined || this.inspecting !== chest.id)
        return {
          label: opened === undefined ? "Открыть сундук" : "Осмотреть сундук",
          run: () => {
            if (opened === undefined)
              this.openedChests.set(chest.id, this.elapsed);
            this.inspecting = chest.id;
            this.inspectionAt = this.elapsed;
            this.notify(
              "secret",
              opened === undefined
                ? "Сундук открыт"
                : "Осматриваем открытый сундук",
            );
          },
        };
      if (this.elapsed - Math.max(opened, this.inspectionAt) < 0.7) return;
      return {
        label: `Взять: ${WEAPONS[chest.weapon].name}`,
        run: () => {
          this.lootedChests.add(chest.id);
          this.inspecting = null;
          this.equip(chest.weapon);
          if ("armour" in chest && chest.armour) {
            p.armour = 1;
            this.notify("secret", "Кираса хранителя: урон снижен на 28%");
          }
          this.secrets.add(chest.id);
        },
      };
    }
    return this.pickupOrDoor() ?? this.encounterOrExit();
  }
  protected pickupOrDoor(): { label: string; run: () => void } | undefined {
    const p = this.player;
    for (const key of KEYS)
      if (
        !this.collectedKeys.has(key.id) &&
        Math.abs(p.y - key.y) < 0.8 &&
        distance(p, key) < 1.7
      )
        return {
          label: "Взять ключ",
          run: () => {
            this.collectedKeys.add(key.id);
            this.keys.add(key.id);
            this.secrets.add("key-" + key.id);
            this.notify("secret", key.name);
          },
        };
    for (const coin of COINS)
      if (
        !this.collectedCoins.has(coin.id) &&
        Math.abs(p.y - coin.y) < 0.8 &&
        distance(p, coin) < 1.65
      )
        return {
          label: "Собрать монеты",
          run: () => {
            this.collectedCoins.add(coin.id);
            this.coins += coin.amount;
            this.notify("secret", `Найдено монет: ${coin.amount}`);
          },
        };
    for (const flask of POTIONS)
      if (
        !this.collectedPotions.has(flask.id) &&
        Math.abs(p.y - flask.y) < 0.8 &&
        distance(p, flask) < 1.4
      ) {
        if (this.flasks >= Campaign.FLASK_CAPACITY)
          return {
            label: "Зелья заполнены",
            run: () => this.notify("secret", "Все три места для зелий заняты"),
          };
        return {
          label: "Взять лечебное зелье",
          run: () => {
            this.collectedPotions.add(flask.id);
            this.flasks++;
            this.notify("secret", "Найдено лечебное зелье");
          },
        };
      }
    for (const door of DOORS)
      if (
        !this.openDoors.has(door.id) &&
        Math.abs(p.y - door.y) < 0.8 &&
        distance(p, door) < 2.1
      ) {
        if (!this.keys.has(door.key))
          return {
            label: `Заперто: ${door.name}`,
            run: () => this.notify("door", "Нужен ключ"),
          };
        return {
          label: `Открыть: ${door.name}`,
          run: () => {
            this.keys.delete(door.key);
            this.openDoors.add(door.id);
            this.doorOpenedAt.set(door.id, this.elapsed);
            this.doorSwing.set(door.id, p.z >= door.z ? 1 : -1);
            this.notify(
              "door",
              door.id === "gate"
                ? "Чёрные ворота открыты"
                : "Ризница открыта ключом",
            );
          },
        };
      }
  }
  private encounterOrExit(): { label: string; run: () => void } | undefined {
    const p = this.player;
    const mimic = this.enemies.get("crypt")!;
    if (
      !this.mimicAwake &&
      this.location === "crypt" &&
      distance(p, mimic) < 1.9
    )
      return {
        label: "Открыть сундук",
        run: () => {
          this.mimicAwake = true;
          this.mimicAwokeAt = this.elapsed;
          this.enemyDormant = false;
          mimic.mode = "recover";
          mimic.time = 0;
          this.notify("secret", "Это не обычный сундук");
        },
      };
    for (const drop of this.drops)
      if (
        drop.active &&
        Math.abs(p.y - drop.y) < 0.8 &&
        distance(p, drop) < 1.4
      )
        return {
          label: `Поднять: ${WEAPONS[drop.weapon].name}`,
          run: () => {
            const weapon = drop.weapon;
            drop.active = false;
            this.equip(weapon);
          },
        };
    const scenario = this.scenario;
    const fullRoute = scenario === "journey" || scenario === "escape";
    const destination =
      AREAS[
        fullRoute || scenario === "defeat" || scenario === "unarmoured"
          ? "crypt"
          : scenario === "locked"
            ? "chapel"
            : scenario === "ambush" || scenario === "healing"
              ? "forest"
              : scenario
      ].exit;
    if (
      distance(p, destination) < 1.4 &&
      (fullRoute
        ? this.openDoors.has("gate")
        : this.completedAreas.has(areaAt(destination.z)))
    )
      return {
        label: "Продолжить путь",
        run: () => {
          this.phase = "finished";
          this.set(p, "idle");
          p.speed = 0;
        },
      };
  }
  override update(dt: number, input: MoveInput) {
    if (Math.hypot(input.x, input.z) > 0.12 || input.guard)
      this.cancelInspection();
    const nearest = this.foes.sort(
      (a, b) => distance(this.player, a) - distance(this.player, b),
    )[0];
    if (nearest) this.enemy = nearest;
    this.enemyDormant = this.asleep(this.enemy);
    if (this.phase === "won" && nearest) this.phase = "playing";
    if (
      this.phase !== "intro" &&
      this.phase !== "finished" &&
      this.player.hp > 0
    ) {
      const location = this.location;
      if (location !== this.activeArea) {
        this.activeArea = location;
        this.enemy = nearest ?? this.enemies.get(location)!;
        this.enemyDormant = location === "crypt" && !this.mimicAwake;
        this.phase = this.opponents.some((e) => e.hp > 0) ? "playing" : "won";
      }
    }
    super.update(dt, input);
    if (this.healingPending && this.player.mode !== "heal")
      this.healingPending = false;
    if (
      this.player.mode === "heal" &&
      this.player.time >= 1.05 &&
      this.healingPending
    ) {
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + Campaign.FLASK_HEAL,
      );
      this.healingPending = false;
      this.healed++;
      this.notify("secret", "Зелье восстановило здоровье");
    }
    if (this.player.mode === "heal" && this.player.time > 1.3)
      this.set(this.player, "idle");
    for (const area of AREA_ORDER)
      if (
        [...this.enemies.values()]
          .filter((e) => e.area === area)
          .every((e) => e.hp <= 0)
      )
        this.completedAreas.add(area);
    for (const e of this.enemies.values())
      if (!this.opponents.includes(e) && e.mode === "dead") e.time += dt;
    const mimic = this.enemies.get("crypt")!;
    if (!this.mimicAwake && mimic.hp < mimic.maxHp) {
      this.mimicAwake = true;
      this.mimicAwokeAt = this.elapsed;
      this.enemyDormant = false;
    }
  }
}
