import {
  ENEMIES,
  type CombatGame,
  type EnemyKind,
  type MoveInput,
} from "./game.ts";
import type { LocationId } from "./locations";
import { RouteNavigation } from "./route-navigation.ts";

export const DEMO_ENEMIES: Record<LocationId, EnemyKind> = {
  forest: "effigy",
  crypt: "mimic",
  chapel: "gaoler",
  roofs: "watcher",
  courtyard: "effigy",
};
const rest: MoveInput = { x: 0, z: 0, guard: false };
type Stage =
  | "chest"
  | "chest-view"
  | "first-secret"
  | "approach"
  | "single"
  | "block"
  | "double"
  | "dodge"
  | "triple"
  | "death"
  | "second-secret"
  | "exit";

// A deterministic input driver, not a replay of positions, health or outcomes.
// Pickups, combat and collision pass through the same rules as manual play.
export class Showcase {
  label = "Тайник у стены";
  cameraYaw = 0;
  cameraPitch = 0.08;
  private stage: Stage = "chest";
  private time = 0;
  private stageTime = 0;
  private began = false;
  private dodged = false;
  private wonAt = 0;
  private game: CombatGame;
  private location: LocationId;
  private navigation: RouteNavigation;
  private frameDt = 1 / 120;
  constructor(game: CombatGame, location: LocationId = "chapel") {
    this.game = game;
    this.location = location;
    this.navigation = new RouteNavigation(game);
  }
  private enter(stage: Stage) {
    this.stage = stage;
    this.stageTime = 0;
    this.began = false;
  }
  private walk(x: number, z: number, tolerance = 0.22): MoveInput {
    const p = this.game.player,
      waypoint = this.navigation.next({ x, z }, this.frameDt),
      dx = waypoint.x - p.x,
      dz = waypoint.z - p.z,
      d = Math.hypot(dx, dz);
    return d < tolerance ? rest : { x: dx / d, z: dz / d, guard: false };
  }
  update(dt: number): MoveInput {
    this.frameDt = dt;
    this.time += dt;
    this.stageTime += dt;
    const g = this.game,
      p = g.player,
      e = g.enemy;
    if (g.phase === "lost" || g.phase === "finished") return rest;
    const dx = e.x - p.x,
      dz = e.z - p.z,
      d = Math.hypot(dx, dz);
    const approach = () =>
      d > 1.55 ? { x: dx / d, z: dz / d, guard: false } : rest;
    this.cameraPitch = 0.05;
    this.cameraYaw = Math.atan2(p.x - e.x, p.z - e.z) + 0.12;
    if (g.phase === "won" && !this.wonAt) {
      this.wonAt = this.time;
      this.enter("death");
    }
    if (this.stage === "chest") {
      this.cameraYaw = 0.48;
      if (Math.hypot(p.x + 2.65, p.z - 4.4) < 0.3) {
        g.interact();
        this.enter("chest-view");
      }
      return this.walk(-2.65, 4.4);
    }
    if (this.stage === "chest-view") {
      this.label = "Сундук / лунный серп";
      this.cameraYaw = 0.48 + Math.sin(this.stageTime * 1.5) * 0.55;
      this.cameraPitch = 0.13;
      if (this.stageTime > 1.25) this.enter("first-secret");
      return rest;
    }
    if (this.stage === "first-secret") {
      this.label = "Первая пасхалка / клеймо на камне";
      this.cameraYaw = 0.25;
      if (Math.hypot(p.x + 2.7, p.z - 0.65) < 0.28) {
        g.interact();
        if (g.secrets.has("inscription")) this.enter("approach");
      }
      return this.walk(-2.7, 0.65);
    }
    if (this.stage === "death") {
      this.label = "Направленное падение";
      this.cameraYaw += Math.sin(this.stageTime * 0.8) * 0.9;
      this.cameraPitch = 0.16;
      if (this.stageTime > 2.05) this.enter("second-secret");
      return rest;
    }
    if (this.stage === "second-secret") {
      this.label = "Вторая пасхалка / отзвук";
      this.cameraYaw = -0.35 + Math.sin(this.stageTime * 0.8) * 0.4;
      if (Math.hypot(p.x - 3.05, p.z + 4.8) < 0.3) {
        g.interact();
        if (g.secrets.has("echo")) this.enter("exit");
      }
      return this.walk(3.05, -4.8);
    }
    if (this.stage === "exit") {
      this.label = "Путь открыт / 2 / 2";
      this.cameraYaw = 0.12;
      if (Math.hypot(p.x, p.z + 6.9) < 0.3) g.interact();
      return this.walk(0, -6.9);
    }
    if (this.stage === "approach") {
      this.label = "Встреча";
      if (d < 1.8) this.enter("single");
      else return approach();
    }
    if (this.stage === "single") {
      this.label = "Одиночный удар";
      if (!this.began) {
        g.attack();
        this.began = true;
      } else if (p.mode !== "attack" && p.mode !== "hit") this.enter("block");
      return rest;
    }
    if (this.stage === "block") {
      this.label = "Блок и отдача";
      if (p.recoil > 0) this.enter("double");
      const profile = ENEMIES[e.kind as EnemyKind];
      return {
        ...rest,
        guard:
          g.guardCooldown <= 0 &&
          ((e.mode === "windup" && e.time > profile.windup - 0.22) ||
            e.mode === "attack"),
      };
    }
    if (this.stage === "double" || this.stage === "triple") {
      const total = this.stage === "double" ? 2 : 3;
      this.label = total === 2 ? "Двойной удар" : "Серп / тройная цепочка";
      if (d > 1.8 && !this.began) return approach();
      if (!this.began) {
        if (p.stamina < (total === 3 ? 60 : 36)) return rest;
        g.attack();
        this.began = p.mode === "attack";
      } else if (p.mode === "attack") {
        if (p.chain === 1 && p.time > 0.17) g.attack();
        else if (total === 3 && p.chain === 2 && p.time > 0.34) g.attack();
      } else if (p.mode !== "hit") {
        if (total === 2) {
          this.enter("dodge");
          this.dodged = false;
        } else this.enter("triple");
      }
      return rest;
    }
    if (this.stage === "dodge") {
      this.label = "Перекат под ударом";
      const profile = ENEMIES[e.kind as EnemyKind];
      if (
        !this.dodged &&
        e.mode === "windup" &&
        e.time > profile.windup - 0.3
      ) {
        const forward = this.location === "roofs";
        const dir = this.location === "courtyard" ? -1 : 1;
        const sideX = Math.cos(p.yaw) * dir,
          sideZ = -Math.sin(p.yaw) * dir;
        g.dodge(
          this.location === "chapel"
            ? { x: -dx / d, z: -dz / d }
            : forward
              ? { x: sideX * 0.65 + dx / d, z: sideZ * 0.65 + dz / d }
              : { x: sideX, z: sideZ },
        );
        this.dodged = p.mode === "dodge";
      }
      if (this.dodged && p.mode !== "dodge") this.enter("triple");
      if (!this.dodged && d > profile.reach) return approach();
      return rest;
    }
    return rest;
  }
}
