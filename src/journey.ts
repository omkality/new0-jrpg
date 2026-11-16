import { AREAS, AREA_ORDER, type AreaId, type Point } from "./world-layout.ts";
import { Campaign, type ScenarioId } from "./campaign.ts";
import { ENEMIES, type MoveInput } from "./game.ts";
import { RouteNavigation } from "./route-navigation.ts";
import { WEAPONS } from "./weapon-spec.ts";
import { bodyPenetration } from "./body-collision.ts";
import { floorHeight } from "./world-layout.ts";

const rest: MoveInput = { x: 0, z: 0, guard: false };
type Step =
  | { type: "walk"; x: number; z: number; label: string; look?: number }
  | { type: "interact"; label: string; hold: number; look?: number }
  | { type: "wait"; label: string; hold: number; look?: number; pitch?: number }
  | { type: "fight"; label: string; near?: boolean }
  | { type: "heal"; label: string }
  | { type: "gear"; label: string; hold: number }
  | { type: "takeHit"; label: string }
  | { type: "ambush"; label: string }
  | { type: "riskHeal"; label: string }
  | { type: "probe"; x: number; z: number; hold: number; label: string }
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
      {
        type: "fight",
        near: true,
        label: "Осмотр прерван: сначала отбиваемся",
      },
      walk(4.6, 5.65, "Возвращаемся за секирой"),
      use("Возвращаемся к открытому сундуку", 0.85, 0.15),
      use("Секира из сундука", 0.8, 0.3),
      walk(-6, 5.65, "Слабое свечение между надгробиями"),
      use("Зелье в укрытии", 0.65, -0.7),
      { type: "heal", label: "Лечимся найденным зельем" },
      walk(-6, 5.95, "Выходим между надгробиями"),
      walk(-3, 5.95, "Обходим каменные плиты"),
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
      walk(4.3, -26.4, "Обходим колонны воротного двора"),
      walk(5.7, -26.6, "Тайник за старыми ящиками"),
      walk(5.7, -29.2, "Ищем белый отблеск стекла"),
      use("Забираем зелье из тайника", 0.65, 0.8),
      walk(3.6, -29.4, "Возвращаемся на проход"),
      { type: "fight", label: "Смотритель воротного двора" },
      wait("За стенами есть мир", 2, 1.15, 0.24),
      walk(0, -41.3, "Через крытый переход", 0.1),
    ];
  if (area === "chapel")
    return [
      walk(-2.5, -45.65, "Вход в боковую комнату", -0.35),
      walk(-3.6, -45.65, "Ключ на аналое в нише", -0.2),
      use("Ключ ризницы", 0.8, -0.15),
      walk(-2.5, -45.65, "Выходим через проём ниши"),
      walk(-1, -48, "Под цепной люстрой"),
      { type: "fight", label: "Носильщик в нижнем зале" },
      walk(-5.8, -60.5, "Тайник за саркофагами хора"),
      use("Подбираем спрятанное зелье", 0.7, -0.5),
      { type: "heal", label: "Безопасный глоток после боя" },
      wait("Нижний зал пройден", 1.9, 0.75, 0.2),
      walk(0, -48, "К лестнице"),
      walk(5, -48, "Вход на боковую лестницу", -0.2),
      walk(5, -58.8, "Настоящий подъём на второй ярус", -0.55),
      use("Ключ открывает ризницу", 1, 0),
      walk(5, -63.85, "Оружейная над залом"),
      use("Сундук верхней комнаты", 1.2, 0.1),
      use("Кираса хранителя и меч", 0.8, 0.25),
      walk(3.95, -63.85, "Обходим сундук"),
      walk(3.95, -65.7, "Схрон на галерее"),
      use("Монеты верхнего яруса", 0.75, -0.7),
      walk(4.2, -66.4, "За сундуком есть ещё один тайник"),
      walk(5.8, -66.4, "Белое свечение в углу ризницы"),
      use("Запасное лечебное зелье", 0.65, 0.6),
      wait("Смотрим в уже пройденный зал", 1.7, 1.1, 0.38),
      walk(3.95, -66.4, "Возвращаемся из закрытой комнаты"),
      walk(3.95, -63.7, "Обходим сундук обратно"),
      walk(5, -63.7, "К единственной двери ризницы"),
      walk(5, -58.5, "Возвращаемся через открытую дверь"),
      walk(5, -48, "Спуск по той же лестнице", -0.3),
      walk(0, -48, "Возвращаемся в нижний зал"),
      {
        type: "gear",
        hold: 2,
        label: "Кираса хранителя меняет защиту, а не только облик",
      },
      walk(0, -74.5, "Переход в склеп"),
      walk(0, -75.5, "В глубину замка", 0),
    ];
  return [
    walk(2.2, -79.8, "Страж погребального зала"),
    { type: "fight", near: true, label: "Страж перед подозрительным сундуком" },
    walk(-2, -83.65, "Обычный сундук в погребальном зале", 0.1),
    use("Крышка начинает открываться", 1.1, 0.75),
    wait("У сундука есть зубы", 0.6, 0.9, 0.18),
    { type: "takeHit", label: "Кираса смягчает настоящий укус мимика" },
    { type: "fight", label: "Мимик пытается укусить" },
    wait("Мимик повержен", 2.2, 1, 0.2),
    { type: "heal", label: "Восстанавливаем здоровье оставшимся зельем" },
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
  private target?: object;
  private healthAtStep = 100;
  private navigation: RouteNavigation;
  private frameDt = 1 / 60;
  private walkTargets = new WeakMap<object, Point>();
  constructor(game: Campaign, scenario: ScenarioId) {
    this.g = game;
    this.navigation = new RouteNavigation(game);
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
        : scenario === "escape"
          ? [
              walk(-2.4, 2.7, "Ищем только ключ ворот"),
              use("Ключ Чёрных ворот", 0.2),
              walk(-2.4, -8, "Обходим лесную стражу"),
              walk(0, -12.3, "Путь к Чёрным воротам"),
              use("Открываем единственный проход", 0.65),
              walk(0, -22.8, "Уходим по внешней лестнице"),
              walk(3.8, -34.4, "Обходим стражу двора"),
              walk(1.05, -36.5, "Под центральной аркой перехода"),
              walk(1.05, -41.2, "Не задерживаемся в проходе"),
              walk(-2.5, -47.7, "Ризница остаётся необязательной"),
              walk(-2.5, -60, "Обходим тяжёлого носильщика"),
              walk(-1.2, -68, "К проходу в крипту"),
              walk(-1.2, -75.5, "Броню и зелья пришлось оставить"),
              walk(-4.3, -79, "Обходим стража погребального зала"),
              walk(-4.3, -89, "Не трогаем подозрительный сундук"),
              walk(-3, -96, "К последнему свету"),
              walk(0, -100.7, "Выход без зачистки и ценного лута"),
            ]
          : scenario === "defeat" || scenario === "unarmoured"
            ? [
                ...(scenario === "defeat"
                  ? [
                      walk(2.2, -79.8, "Сначала страж зала"),
                      {
                        type: "fight" as const,
                        near: true,
                        label: "Осторожный бой со стражем",
                      },
                    ]
                  : []),
                walk(-2, -83.65, "Неосторожный подход к сундуку", 0.1),
                use("Сундук открывается", 1, 0.7),
                { type: "defeat", label: "Мимик пытается проглотить путника" },
              ]
            : scenario === "ambush"
              ? [
                  walk(4.6, 5.65, "Сундук под охраной"),
                  use("Открываем сундук, пока враг рядом", 0.25, 0.2),
                  { type: "ambush", label: "Враг не ждёт окончания осмотра" },
                  {
                    type: "fight",
                    near: true,
                    label: "Отбиваемся после прерванного осмотра",
                  },
                  walk(4.6, 5.65, "Возвращаемся к луту"),
                  use("Снова осматриваем сундук", 0.85),
                  use("Теперь забираем секиру", 0.7),
                  wait("Осмотр не даёт неуязвимости", 2),
                ]
              : scenario === "healing"
                ? [
                    walk(-6, 5.65, "Свет зелья между надгробиями"),
                    use(
                      "Подбор не восстанавливает HP автоматически",
                      0.7,
                      -0.7,
                    ),
                    walk(3.7, 3.6, "Рискованное лечение рядом с врагом"),
                    {
                      type: "riskHeal",
                      label: "Пытаемся выпить зелье под замахом",
                    },
                    {
                      type: "fight",
                      near: true,
                      label: "Прерванное зелье потрачено",
                    },
                    wait("Без зелья здоровье само не растёт", 4),
                  ]
                : scenario === "locked"
                  ? [
                      walk(0, -48, "Сначала проверяем запертую комнату"),
                      walk(5, -48, "Поднимаемся без ключа"),
                      walk(5, -58.8, "Ризница закрыта"),
                      use("Без ключа дверь не открывается", 1),
                      {
                        type: "probe",
                        x: 5,
                        z: -63,
                        hold: 1.6,
                        label: "Закрытую дверь нельзя пройти насквозь",
                      },
                      walk(5, -48, "Возвращаемся за ключом"),
                      ...route("chapel"),
                    ]
                  : route(scenario as AreaId);
  }
  private next() {
    this.index++;
    this.stepTime = 0;
    this.called = false;
    this.fightStage = 0;
    this.attackBegan = false;
    this.dodged = false;
  }
  private towards(
    point: Point,
    tolerance = 0.25,
    avoidLiving = false,
  ): MoveInput {
    const p = this.g.player,
      waypoint = this.navigation.next(point, this.frameDt, avoidLiving),
      dx = waypoint.x - p.x,
      dz = waypoint.z - p.z,
      d = Math.hypot(dx, dz);
    return d < 0.001 || Math.hypot(point.x - p.x, point.z - p.z) < tolerance
      ? rest
      : { x: dx / d, z: dz / d, guard: false };
  }
  private fight(near = false): MoveInput {
    const g = this.g,
      p = g.player,
      e = g.enemy,
      profile = ENEMIES[e.kind],
      weapon = WEAPONS[p.weapon];
    if (g.foes.length === 0 || (near && g.distance > 6.2)) {
      this.next();
      return rest;
    }
    if (this.target !== e) {
      this.target = e;
    }
    const dx = e.x - p.x,
      dz = e.z - p.z,
      d = g.distance;
    const approach = () =>
      this.towards(e, Math.min(weapon.reach - 0.3, profile.reach - 0.2));
    this.cameraYaw = Math.atan2(p.x - e.x, p.z - e.z) + 0.22;
    if (p.mode === "heal") return rest;
    if (p.hp < 62 && g.flasks > 0) {
      this.label = "Отходим от врагов, чтобы выпить зелье";
      if (d < 5.2) return this.backOff();
      g.heal();
      return rest;
    }
    if (e.hp <= 0) {
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
      if (d > profile.reach - 0.1) return approach();
      const imminent =
        (e.mode === "windup" && e.time > profile.windup - 0.22) ||
        e.mode === "attack";
      return { ...rest, guard: imminent && g.guardCooldown <= 0 };
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
          ? "Выпад пастью / уходим от укуса"
          : "Уходим с линии удара";
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
    this.label = weapon.name + " / ответная цепочка";
    if (p.mode === "attack") {
      if (p.chain === 1 && p.time > 0.17) g.attack();
      else if (p.chain === 2 && p.time > 0.34) g.attack();
      return rest;
    }
    const cost =
      Math.ceil(16 * weapon.cost) +
      Math.ceil(18 * weapon.cost) +
      Math.ceil(24 * weapon.cost);
    if (p.stamina < Math.min(100, cost)) {
      this.label = "Отходим и восстанавливаем выносливость";
      return d < profile.reach + 1.3 ? this.backOff() : rest;
    }
    if (d > weapon.reach - 0.28) return approach();
    if (
      (e.mode === "windup" && e.time > profile.windup * 0.55) ||
      e.mode === "attack"
    )
      return { ...rest, guard: g.guardCooldown <= 0 };
    g.attack();
    return rest;
  }
  // Choose an open escape direction before issuing normal movement input.
  // Fleeing directly away from the nearest foe can pin the hero against a
  // second fighter, a chest or the wall. This never changes actor state.
  private backOff(): MoveInput {
    const g = this.g,
      p = g.player;
    let best = rest,
      bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8,
        x = Math.sin(angle),
        z = Math.cos(angle);
      let clear = true;
      for (const s of [0.18, 0.36, 0.65])
        if (!g.walkable(p.x + x * s, p.z + z * s, p.x, p.z, true)) {
          clear = false;
          break;
        }
      if (!clear) continue;
      let score = 0;
      for (const foe of g.foes) {
        const before = Math.hypot(p.x - foe.x, p.z - foe.z),
          after = Math.hypot(p.x + x * 0.65 - foe.x, p.z + z * 0.65 - foe.z);
        score += 1 / Math.max(0.25, before) - 1 / Math.max(0.25, after);
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, guard: false };
      }
    }
    return best;
  }
  update(dt: number): MoveInput {
    this.frameDt = dt;
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
      if (g.scenario === "ambush" || g.scenario === "healing") {
        this.done = true;
        return rest;
      }
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
      const next = this.steps[this.index + 1];
      if (
        next?.type === "fight" &&
        Math.hypot(step.x - p.x, step.z - p.z) < 1.4 &&
        g.foes.some(
          (e) => Math.hypot(e.x - p.x, e.z - p.z) < ENEMIES[e.kind].reach + 0.5,
        )
      ) {
        this.next();
        return rest;
      }
      let goal = this.walkTargets.get(step);
      if (!goal) {
        goal = step;
        const at = { ...p, y: floorHeight(step.x, step.z) },
          occupied = [...g.enemies.values()].some(
            (e) => e.hp <= 0 && bodyPenetration(at, step.x, step.z, e) > 0,
          );
        if (occupied) {
          let score = Infinity;
          for (const radius of [0.8, 1.1, 1.4])
            for (let i = 0; i < 16; i++) {
              const x = step.x + Math.sin((i * Math.PI) / 8) * radius,
                z = step.z + Math.cos((i * Math.PI) / 8) * radius;
              if (
                Math.abs(floorHeight(x, z) - at.y) > 0.15 ||
                !g.walkable(x, z, x, z, true)
              )
                continue;
              const value = radius + Math.hypot(p.x - x, p.z - z) * 0.1;
              if (value < score) {
                score = value;
                goal = { x, z };
              }
            }
        }
        this.walkTargets.set(step, goal);
      }
      if (Math.hypot(goal.x - p.x, goal.z - p.z) < 0.28) {
        this.next();
        return rest;
      }
      const move = this.towards(goal, 0.25, true);
      if (g.scenario === "escape") {
        const threat = g.foes.find(
          (e) =>
            Math.hypot(e.x - p.x, e.z - p.z) < ENEMIES[e.kind].reach + 0.4 &&
            ((e.mode === "windup" && e.time > ENEMIES[e.kind].windup - 0.24) ||
              (e.mode === "attack" && e.time < 0.06)),
        );
        if (threat) g.dodge(move);
      }
      return move;
    }
    if (step.type === "probe") {
      if (this.stepTime > step.hold) {
        this.next();
        return rest;
      }
      return this.towards(step);
    }
    if (step.type === "ambush") {
      if (g.interruptedInspections > 0) this.next();
      return rest;
    }
    if (step.type === "gear") {
      this.cameraYaw = p.yaw - 0.85;
      this.cameraPitch = 0.12;
      if (this.stepTime > step.hold) this.next();
      return rest;
    }
    if (step.type === "takeHit") {
      if (!p.armour) {
        this.next();
        return rest;
      }
      if (!this.called) {
        this.healthAtStep = p.hp;
        this.called = true;
      }
      if (p.hp < this.healthAtStep) {
        this.next();
        return rest;
      }
      return g.distance > 1.6 ? this.towards(g.enemy, 1.5) : rest;
    }
    if (step.type === "riskHeal") {
      this.cameraYaw = p.yaw - 0.9;
      if (g.interruptedHeals > 0) {
        this.next();
        return rest;
      }
      const e = g.enemy;
      if (p.hp < 100 && e.mode === "windup" && e.time > 0.25) g.heal();
      return g.distance > 1.55 ? this.towards(e, 1.5) : rest;
    }
    if (step.type === "heal") {
      this.cameraYaw = p.yaw - 0.85;
      this.cameraPitch = 0.12;
      if (!this.called) {
        g.heal();
        this.called = true;
      }
      if (p.mode !== "heal" && this.stepTime > 0.2) this.next();
      return rest;
    }
    if (step.type === "interact") {
      if (!this.called) {
        const before = g.events.length;
        g.interact();
        this.called = g.events.length > before;
        if (this.called) this.stepTime = 0;
      }
      if (this.called && this.stepTime > step.hold) this.next();
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
    return this.fight(step.near);
  }
}
