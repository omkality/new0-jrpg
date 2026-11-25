import { ATTACKS, type Fighter } from "../game.ts";
import { semanticAttackTime } from "../motion-policy.ts";

// The two marks are on the same patch of ground where the conversation starts.
// Only the rendered footwork uses them. Exploration resumes at the player's own feet.
export class Duel {
  readonly hero: Fighter;
  readonly foe: Fighter;
  readonly target;
  readonly eye;
  private readonly distance;
  static readonly dx = -0.72;
  static readonly dz = Math.sqrt(1 - Duel.dx ** 2);
  constructor(player: Fighter, enemy: Fighter) {
    this.hero = { ...player };
    this.foe = { ...enemy };
    this.distance = player.weapon === "spear" ? 1.9 : 1.44;
    const x = enemy.x + (Duel.dx * this.distance) / 2;
    const z = enemy.z + (Duel.dz * this.distance) / 2;
    this.target = { x, y: enemy.y + 0.95, z };
    // Look past the pilgrim's right shoulder. Both marks sit inside the clear
    // central bay of the bridge, even with the longer spear in the foreground.
    this.eye = { x: x + 0.1, y: enemy.y + 1.98, z: z + 3.22 };
  }
  sample(player: Fighter, enemy: Fighter) {
    Object.assign(this.hero, player);
    Object.assign(this.foe, enemy);
    const dx = Duel.dx,
      dz = Duel.dz;
    const step = (f: Fighter, enemy: boolean) => {
      if (f.mode !== "attack" && f.mode !== "windup") return 0;
      const time = semanticAttackTime(f, enemy);
      const a = ATTACKS[f.combo - 1];
      const u = Math.min(1, Math.max(0, time / a.contact));
      const v = Math.min(
        1,
        Math.max(0, (time - a.contact) / (a.duration - a.contact)),
      );
      let reach = f.weapon === "unarmed" ? 0.53 : 0.43;
      if (f.weapon === "spear") reach = f.combo === 3 ? 0.48 : 0.24;
      return (u * u * (3 - 2 * u) - v * v * (3 - 2 * v)) * reach;
    };
    const heroDistance = this.distance - step(player, false);
    const foeDistance = step(enemy, true);
    this.hero.x = enemy.x + dx * heroDistance;
    this.hero.z = enemy.z + dz * heroDistance;
    this.hero.y = enemy.y;
    this.hero.yaw = Math.atan2(-dx, -dz);
    this.foe.x = enemy.x + dx * foeDistance;
    this.foe.z = enemy.z + dz * foeDistance;
    this.foe.yaw = Math.atan2(dx, dz);
    return this;
  }
}
