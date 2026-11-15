import { AREAS, AREA_ORDER, type AreaId, type Point } from "./world-layout.ts";
import { Campaign, type ScenarioId } from "./campaign.ts";
import { ENEMIES, type MoveInput } from "./game.ts";
import { WEAPONS } from "./weapon-spec.ts";

const rest: MoveInput = { x: 0, z: 0, guard: false };
type Step =
  | { type: "walk"; x: number; z: number; label: string; look?: number }
  | { type: "interact"; label: string; hold: number; look?: number }
  | { type: "wait"; label: string; hold: number; look?: number; pitch?: number }
  | { type: "fight"; label: string }
  | { type: "drop"; label: string }
  | { type: "defeat"; label: string };
const walk = (x: number, z: number, label: string, look?: number): Step => ({
  type: "walk",
  x,
  z,
  label,
  look,
});
const use = (label: string, hold = 0.85, look?: number): Step => ({
  type: "interact",
  label,
  hold,
  look,
});
const wait = (
  label: string,
  hold = 1,
  look?: number,
  pitch?: number,
): Step => ({ type: "wait", label, hold, look, pitch });
function route(area: AreaId): Step[] {
  if (area === "forest")
    return [
      walk(4.6, 5.65, "Тайник за корнями"),
      use("Осматриваем сундук", 1.2, 0.15),
      use("Секира из сундука", 0.8, 0.3),
      walk(1, 3.4, "Лесная тропа"),
      walk(-3.8, 2.7, "Ключ на старом алтаре"),
      use("Ключ Чёрных ворот", 0.8, -0.5),
      walk(-2.4, 2.7, "Обходим корни"),
      walk(-2.4, -1, "Тропа под белым светом"),
      { type: "fight", label: "Лесная засада" },
      wait("Путь к замку", 1.9, 0.6),
      walk(4.4, -8.1, "Схрон у разбитой стены"),
      use("Монеты под камнем", 0.7, 0.2),
      walk(0, -12.3, "Запертые ворота"),
      use("Ключ подходит к воротам", 1, 0),
      walk(0, -15.4, "За Чёрные ворота"),
    ];
  if (area === "roofs")
    return [
      walk(0, -22.8, "Поднимаемся по внешней лестнице", 0.2),
      walk(-4.6, -24.25, "Сундук в нише над двором"),
      use("Оружие видно внутри", 1.25, 0.1),
      use("Погребальное копьё", 0.75, 0.2),
      walk(-2.7, -24.1, "Меняем оружие без инвентаря"),
      { type: "drop", label: "Сбрасываем копьё" },
      wait("Оружие осталось на земле", 0.8, -0.6),
      use("Поднимаем копьё обратно", 0.7, -0.4),
      { type: "fight", label: "Смотритель воротного двора" },
      wait("За стенами есть мир", 2, 1.15, 0.24),
      walk(0, -41.3, "Через крытый переход", 0.1),
    ];
  if (area === "chapel")
    return [
      walk(-4.5, -44.65, "Боковая комната собора", -0.35),
      use("Ключ верхней галереи", 0.8, -0.15),
      walk(-2.7, -44.65, "Свет из высоких окон"),
      walk(-1, -48, "Под цепной люстрой"),
      { type: "fight", label: "Носильщик в нижнем зале" },
      wait("Нижний зал пройден", 1.9, 0.75, 0.2),
      walk(0, -48, "К лестнице"),
      walk(5, -48, "Вход на боковую лестницу", -0.2),
      walk(5, -58.8, "Настоящий подъём на второй ярус", -0.55),
      use("Открываем запертую галерею", 1, 0),
      walk(5, -63.85, "Оружейная над залом"),
      use("Сундук верхней комнаты", 1.2, 0.1),
      use("Длинный меч", 0.8, 0.25),
      walk(3.95, -63.85, "Обходим сундук"),
      walk(3.95, -65.7, "Схрон на галерее"),
      use("Монеты верхнего яруса", 0.75, -0.7),
      wait("Смотрим в уже пройденный зал", 1.7, 1.1, 0.38),
      walk(3.95, -67.4, "Вдоль перил"),
      walk(5, -67.4, "К обратной лестнице"),
      walk(5, -74.5, "Спускаемся к погребальным комнатам", -0.3),
      walk(0, -74.5, "Переход в склеп"),
      walk(0, -75.5, "В глубину замка", 0),
    ];
  return [
    walk(-2, -83.65, "Обычный сундук в погребальном зале", 0.1),
    use("Крышка начинает открываться", 1.1, 0.75),
    wait("У сундука есть зубы", 0.6, 0.9, 0.18),
    { type: "fight", label: "Мимик пытается укусить" },
    wait("Мимик повержен", 2.2, 1, 0.2),
    walk(0, -100.7, "Белый свет за последней аркой", 0),
  ];
}
export class CampaignShowcase {
  label = "Лесная тропа";
  cameraYaw = 0;
  cameraPitch = 0.08;
  done = false;
  private steps: Step[];
  private index = 0;
  private stepTime = 0;
  private called = false;
  private fightStage = 0;
  private attackBegan = false;
  private dodged = false;
  private g: Campaign;
  constructor(game: Campaign, scenario: ScenarioId) {
    this.g = game;
    this.steps =
      scenario === "journey"
        ? AREA_ORDER.flatMap((a, i) => [
            ...route(a),
            ...(i < AREA_ORDER.length - 1
              ? [
                  walk(
                    AREAS[AREA_ORDER[i + 1]].start.x,
                    AREAS[AREA_ORDER[i + 1]].start.z,
                    "Продолжаем путь без загрузки",
                  ),
                ]
              : []),
          ])
        : scenario === "defeat"
          ? [
              walk(-2, -83.65, "Неосторожный подход к сундуку", 0.1),
              use("Сундук открывается", 1, 0.7),
              { type: "defeat", label: "Мимик пытается проглотить путника" },
            ]
          : route(scenario);
  }
  private next() {
    this.index++;
    this.stepTime = 0;
    this.called = false;
    this.fightStage = 0;
    this.attackBegan = false;
    this.dodged = false;
  }
  private towards(point: Point, tolerance = 0.25): MoveInput {
    const p = this.g.player,
      dx = point.x - p.x,
      dz = point.z - p.z,
      d = Math.hypot(dx, dz);
    return d < tolerance ? rest : { x: dx / d, z: dz / d, guard: false };
  }
  private fight(): MoveInput {
    const g = this.g,
      p = g.player,
      e = g.enemy,
      profile = ENEMIES[e.kind],
      weapon = WEAPONS[p.weapon];
    const dx = e.x - p.x,
      dz = e.z - p.z,
      d = g.distance;
    const approach = () =>
      this.towards(e, Math.min(weapon.reach - 0.3, profile.reach - 0.2));
    this.cameraYaw = Math.atan2(p.x - e.x, p.z - e.z) + 0.22;
    if (e.hp <= 0) {
      this.next();
      return rest;
    }
    if (p.mode === "hit" || p.mode === "dodge") return rest;
    if (this.fightStage === 0) {
      if (d > Math.min(weapon.reach - 0.2, profile.reach - 0.1))
        return approach();
      this.fightStage = 1;
    }
    if (this.fightStage === 1) {
      this.label = "Читаемый замах и блок";
      if (p.recoil > 0) this.fightStage = 2;
      if (d > profile.reach - 0.1) return { ...approach(), guard: true };
      return { ...rest, guard: true };
    }
    if (this.fightStage === 2) {
      if (!this.attackBegan) {
        g.attack();
        this.attackBegan = p.mode === "attack";
      } else if (p.mode !== "attack") {
        this.fightStage = 3;
        this.attackBegan = false;
      }
      return rest;
    }
    if (this.fightStage === 3) {
      this.label =
        e.kind === "mimic"
          ? "Выпад пастью · уходим от укуса"
          : "Перекат под ударом";
      const moment =
        e.kind === "mimic"
          ? e.mode === "attack" && e.time > 0.04
          : e.mode === "windup" && e.time > profile.windup - 0.25;
      if (!this.dodged && moment) {
        g.dodge({ x: -dx / d, z: -dz / d });
        this.dodged = String(p.mode) === "dodge";
      }
      if (this.dodged && String(p.mode) !== "dodge") {
        this.fightStage = 4;
        this.attackBegan = false;
      }
      if (!this.dodged && d > profile.reach - 0.1) return approach();
      return rest;
    }
    this.label = weapon.name + " · ответная цепочка";
    if (p.mode === "attack") {
      if (p.chain === 1 && p.time > 0.17) g.attack();
      else if (p.chain === 2 && p.time > 0.34) g.attack();
      return rest;
    }
    const cost = 16 * weapon.cost + 18 * weapon.cost + 24 * weapon.cost;
    if (p.stamina < cost + 2) {
      this.label = "Отходим и восстанавливаем выносливость";
      return d < profile.reach + 1.3
        ? { x: -dx / d, z: -dz / d, guard: false }
        : rest;
    }
    if (d > weapon.reach - 0.28) return approach();
    if (
      (e.mode === "windup" && e.time > profile.windup * 0.55) ||
      e.mode === "attack"
    )
      return { ...rest, guard: true };
    g.attack();
    return rest;
  }
  update(dt: number): MoveInput {
    if (this.done) return rest;
    this.stepTime += dt;
    const g = this.g,
      p = g.player;
    if (g.phase === "lost") {
      this.label = "Путник погиб";
      this.cameraYaw = 0.8;
      this.cameraPitch = 0.18;
      if (p.time > 3.2) this.done = true;
      return rest;
    }
    if (g.phase === "finished") {
      this.done = true;
      return rest;
    }
    const step = this.steps[this.index];
    if (!step) {
      g.interact();
      if (String(g.phase) === "finished") this.done = true;
      return rest;
    }
    this.label = step.label;
    this.cameraYaw =
      "look" in step && step.look !== undefined ? step.look : 0.08;
    this.cameraPitch =
      "pitch" in step && step.pitch !== undefined ? step.pitch : 0.08;
    if (step.type === "walk") {
      if (Math.hypot(step.x - p.x, step.z - p.z) < 0.28) {
        this.next();
        return rest;
      }
      return this.towards(step);
    }
    if (step.type === "interact") {
      if (!this.called) {
        const before = g.events.length;
        g.interact();
        this.called = g.events.length > before;
        if (this.called) this.stepTime = 0;
      }
      if (this.stepTime > step.hold) this.next();
      return rest;
    }
    if (step.type === "wait") {
      if (this.stepTime > step.hold) this.next();
      return rest;
    }
    if (step.type === "drop") {
      g.dropWeapon();
      this.next();
      return rest;
    }
    if (step.type === "defeat") {
      const mimic = g.enemy;
      this.cameraYaw = Math.atan2(p.x - mimic.x, p.z - mimic.z) + 0.75;
      return g.distance > 1.7 ? this.towards(mimic, 1.6) : rest;
    }
    return this.fight();
  }
}
