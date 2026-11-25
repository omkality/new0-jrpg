import {
  KEEPER,
  MIMIC,
  SCOUT,
  CHARGE_LIMIT,
  type Command,
  type Encounter,
} from "./encounter.ts";
import type { CourtOption } from "./bell-quest.ts";
import type { ForestChapter } from "./forest.ts";

type Screen = ForestChapter["screen"];
type Step =
  | { kind: "walk"; x: number; z: number }
  | { kind: "use"; label: string }
  | { kind: "next"; screen: Screen }
  | { kind: "select"; screen: Screen; option: CourtOption }
  | { kind: "duel"; foe: Encounter }
  | { kind: "turn"; direction: number };
const walk = (x: number, z: number): Step => ({ kind: "walk", x, z });
const use = (label: string): Step => ({ kind: "use", label });
const next = (screen: Screen): Step => ({ kind: "next", screen });
const pick = (screen: Screen, option: CourtOption): Step => ({
  kind: "select",
  screen,
  option,
});
const duel = (foe: Encounter): Step => ({ kind: "duel", foe });
const turn = (direction: number): Step => ({ kind: "turn", direction });

// Waypoints lead around walls, the keeper's body and the base of the bell.
// All interactions use the same controls and movement as the manual chapter.
const route: readonly Step[] = [
  walk(1.5, 4.35),
  use("Заговорить"),
  pick("dialogue", "name"),
  next("cantorName"),
  duel(SCOUT),
  walk(-2.8, 2.32),
  use("ключ"),
  walk(0, 2.5),
  walk(0, -12.8),
  use("ворота"),
  walk(0, -21.8),
  walk(-4.4, -25.8),
  use("колокол"),
  next("inscription"),
  walk(-2.35, -26.5),
  walk(-2.35, -30.25),
  walk(-4.5, -30.31),
  use("зарубки"),
  pick("cairn", "speak"),
  pick("cache", "take"),
  walk(-2.35, -30.4),
  walk(1, -38.3),
  use("сторожа"),
  pick("toll", "fight"),
  duel(KEEPER),
  walk(2.15, -38.35),
  use("оружие"),
  pick("weapon", "swap"),
  use("оружие"),
  pick("weapon", "swap"),
  use("оружие"),
  pick("weapon", "swap"),
  walk(0, -38.15),
  walk(0, -44.9),
  walk(-3.33, -45.78),
  use("ключ"),
  walk(-2.38, -46.5),
  walk(-2.38, -51.9),
  walk(-3.55, -52.13),
  use("огарок"),
  pick("votive", "shelter"),
  pick("votive", "takeRegen"),
  next("votive"),
  walk(-2.38, -51.9),
  walk(-2.35, -55.65),
  walk(-3.31, -55.76),
  use("сундук"),
  pick("coffer", "uncatch"),
  duel(MIMIC),
  walk(-2.35, -55.65),
  walk(-2.38, -51.9),
  walk(-2.38, -46.5),
  walk(0, -46),
  walk(5, -46),
  walk(5, -58.95),
  use("Открыть"),
  walk(5, -63.55),
  use("ларец"),
  pick("seals", "wave"),
  pick("seals", "thorn"),
  pick("seals", "sun"),
  next("relic"),
  turn(-1),
  walk(5, -54.5),
  walk(5, -46),
  walk(0, -44.9),
  walk(0, -38.8),
  walk(-4.55, -29.4),
  walk(-6.55, -29.4),
  walk(-6.55, -25.6),
  walk(-4.5, -25.7),
  use("Вернуть"),
  pick("vow", "all"),
  next("ending"),
  turn(1),
  walk(-3.05, -25.7),
  walk(-2.4, -29.4),
  walk(0, -38.6),
  walk(0, -45),
  walk(0, -65.3),
  walk(0, -80.4),
  walk(-0.8, -84.55),
  use("зеркало"),
  pick("mirror", "right"),
  pick("mirror", "right"),
  next("mirror"),
  walk(1.15, -84.65),
  walk(2.35, -88.94),
  use("плиту"),
  pick("tablet", "inscribe"),
];

export interface ChapterControls {
  interact(): void;
  advance(): void;
  select(option: CourtOption): void;
  command(command: Command): void;
  orbit(dx: number): void;
}

const still = { x: 0, z: 0 };
export const PORTRAIT_BENCHMARK_SEED = 90;

export class ChapterAutoplay {
  private index = 0;
  private hold = 0.4;
  private elapsed = 0;
  private previousScreen?: Screen;
  swaps = 0;
  failed = false;
  get active() {
    return !this.failed && this.index < route.length;
  }
  private proceed(readSeconds: number) {
    this.index++;
    this.elapsed = 0;
    this.hold = readSeconds;
  }
  update(dt: number, game: ForestChapter, controls: ChapterControls) {
    if (!this.active) return still;
    if (game.screen !== this.previousScreen) {
      this.previousScreen = game.screen;
      if (game.screen === "choice") this.hold = Math.max(this.hold, 0.85);
      if (game.screen === "victory" || game.screen === "ending")
        this.hold = Math.max(this.hold, 1.6);
    }
    if (this.hold > 0) {
      this.hold -= dt;
      return still;
    }
    const step = route[this.index];
    this.elapsed += dt;
    if (this.elapsed > (step.kind === "duel" ? 60 : 22)) {
      this.failed = true;
      return still;
    }
    switch (step.kind) {
      case "walk": {
        if (game.screen !== "trail") break;
        const dx = step.x - game.player.x,
          dz = step.z - game.player.z;
        const d = Math.hypot(dx, dz);
        if (d <= 0.11) this.proceed(0);
        else {
          const gain = Math.min(1, d * 2.4) / d;
          return { x: dx * gain, z: dz * gain };
        }
        break;
      }
      case "use":
        if (!game.nearby.includes(step.label)) break;
        controls.interact();
        this.proceed(
          game.screen === "weapon" || game.screen === "coffer" ? 2.6 : 1.25,
        );
        break;
      case "select": {
        if (game.screen !== step.screen) break;
        const held = game.equipped;
        controls.select(step.option);
        if (step.option === "swap" && game.equipped !== held) this.swaps++;
        this.proceed(game.screen === "cache" ? 2.6 : 1.05);
        break;
      }
      case "next":
        if (game.screen !== step.screen) break;
        controls.advance();
        this.proceed(0.55);
        break;
      case "duel": {
        const b = game.battle;
        if (!b || game.spec !== step.foe) break;
        if (game.screen === "dialogue") {
          controls.advance();
          this.hold = 1;
        } else if (game.screen === "choice") {
          const drink =
            step.foe === MIMIC && b.regenFlasks > 0 && b.hp < b.maxHp;
          controls.command(
            drink ? "item" : b.charge === CHARGE_LIMIT ? "skill" : "attack",
          );
          this.hold = drink ? 1.5 : 0.4;
        } else if (game.screen === "potions") {
          controls.select("drinkRegen");
        } else if (game.screen === "victory") {
          controls.advance();
          this.proceed(0.8);
        } else if (game.screen === "defeat") this.failed = true;
        break;
      }
      case "turn": {
        // Same orbit as a horizontal swipe, spread across one second.
        const delta = Math.min(dt, 1 - (this.elapsed - dt));
        controls.orbit(step.direction * delta * (Math.PI / 0.004));
        if (this.elapsed >= 1) this.proceed(0);
        break;
      }
    }
    return still;
  }
}
