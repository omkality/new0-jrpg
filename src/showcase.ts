import type { CombatGame, MoveInput } from "./game.ts";
import { ENEMIES, type EnemyKind } from "./game.ts";

const rest: MoveInput = { x: 0, z: 0, guard: false };
// Review input driver: uses exactly the same attack/dodge/move rules as a player.
export class Showcase {
  label = "Приближение";
  private stage:
    | "approach"
    | "single"
    | "block"
    | "double"
    | "dodge"
    | "triple"
    | "exit" = "approach";
  private time = 0;
  private began = false;
  private dodged = false;
  private wonAt = 0;
  private game: CombatGame;
  constructor(game: CombatGame) {
    this.game = game;
  }
  update(dt: number): MoveInput {
    this.time += dt;
    const g = this.game,
      p = g.player,
      e = g.enemy,
      dx = e.x - p.x,
      dz = e.z - p.z,
      d = Math.hypot(dx, dz);
    const approach = () =>
      d > 1.65 ? { x: dx / d, z: dz / d, guard: false } : rest;
    if (g.phase === "lost" || g.phase === "finished") return rest;
    if (g.phase === "won") {
      if (!this.wonAt) this.wonAt = this.time;
      this.label = "Путь открыт";
      if (this.time - this.wonAt < 1.8) return rest;
      const ex = -p.x,
        ez = -7 - p.z,
        dist = Math.hypot(ex, ez);
      if (dist < 0.5) {
        g.interact();
        return rest;
      }
      return { x: ex / dist, z: ez / dist, guard: false };
    }
    if (this.stage === "approach") {
      if (d < 1.85) {
        this.stage = "single";
        this.began = false;
      } else return approach();
    }
    if (this.stage === "single") {
      this.label = "Одиночный удар";
      if (!this.began) {
        g.attack();
        this.began = true;
      } else if (p.mode !== "attack" && p.mode !== "hit") {
        this.stage = "block";
        this.began = false;
      }
      return rest;
    }
    if (this.stage === "block") {
      this.label = "Блок и отдача";
      if (p.recoil > 0) {
        this.stage = "double";
        this.began = false;
      }
      return { ...rest, guard: true };
    }
    if (this.stage === "double" || this.stage === "triple") {
      const total = this.stage === "double" ? 2 : 3;
      this.label =
        total === 2 ? "Двойной удар" : "Тройная цепочка · блок закрыт";
      if (d > 1.85 && !this.began) return approach();
      if (!this.began) {
        g.attack();
        this.began = true;
      } else if (p.mode === "attack") {
        if (p.chain === 1 && p.time > 0.17) g.attack();
        else if (total === 3 && p.chain === 2 && p.time > 0.34) g.attack();
      } else if (p.mode !== "hit") {
        if (total === 2) {
          this.stage = "dodge";
          this.dodged = false;
        } else {
          this.began = false;
          this.stage = "triple";
        }
      }
      return rest;
    }
    if (this.stage === "dodge") {
      this.label = "Уклонение от замаха";
      if (
        !this.dodged &&
        e.mode === "windup" &&
        e.time > ENEMIES[e.kind as EnemyKind].windup - 0.25
      ) {
        g.dodge({ x: 1, z: 0.1 });
        this.dodged = true;
      }
      if (this.dodged && p.mode !== "dodge" && e.mode === "recover") {
        this.stage = "triple";
        this.began = false;
      }
      return rest;
    }
    return rest;
  }
}
