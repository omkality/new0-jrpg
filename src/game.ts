// Local movement/combat vertical slice. Never submitted to the prize leaderboard.
import { bodyRadius, bodyPenetration } from "./body-collision.ts";
import { WEAPONS } from "./weapon-spec.ts";
import evadeMotion from "./evade-motion-data.json" with { type: "json" };
import type { Obstacle, WeaponId } from "./world-layout.ts";
export type Motion =
  | "idle"
  | "move"
  | "attack"
  | "dodge"
  | "guard"
  | "hit"
  | "dead"
  | "windup"
  | "recover"
  | "heal";
export interface Fighter {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  stamina: number;
  mode: Motion;
  time: number;
  speed: number;
  combo: number;
  chain: number;
  reaction: number;
  recoil: number;
  dodgeSide: "Left" | "Right" | "Back" | "Forward";
  death: "Front" | "Back" | "Side";
  weapon: WeaponId;
  kind: "pilgrim" | EnemyKind;
  maxHp: number;
  armour: number;
}
export type EnemyKind = "gaoler" | "effigy" | "watcher" | "mimic";
export const DODGE = {
  duration: 0.82,
  travelStart: 0.14,
  travelEnd: 0.65,
  distance: 2.25,
  invulnerableStart: 0.1,
  invulnerableEnd: 0.57,
} as const;
export function dodgeTravelAt(f: Fighter, time: number) {
  const profile = evadeMotion[`Evade${f.dodgeSide}`],
    rows = profile.samples;
  let i = 1;
  while (i < rows.length - 1 && time > rows[i][0]) i++;
  const a = rows[i - 1],
    b = rows[i],
    u = Math.max(0, Math.min(1, (time - a[0]) / (b[0] - a[0] || 1)));
  return profile.distance * (a[1] + (b[1] - a[1]) * u);
}
export const BLOCK = {
  window: 0.66,
  cooldown: 1.1,
  raiseCost: 6,
  impactBase: 28,
  impactScale: 0.7,
} as const;
export const CHEST = { x: -3.85, z: 4.4, radius: 1.55 } as const;
export const SECRETS = [
  { id: "inscription", x: -4.1, z: 0.4 },
  { id: "echo", x: 4.3, z: -4.8 },
] as const;
// Names describe the direction of the fall, not the attacker's position.
export function deathFromImpact(
  target: Fighter,
  source: { x: number; z: number },
): Fighter["death"] {
  const dx = source.x - target.x,
    dz = source.z - target.z;
  const d = Math.hypot(dx, dz) || 1;
  const front = (dx * Math.sin(target.yaw) + dz * Math.cos(target.yaw)) / d;
  return Math.abs(front) < 0.5 ? "Side" : front > 0 ? "Back" : "Front";
}
export const ENEMIES = {
  gaoler: {
    name: "НОСИЛЬЩИК",
    hp: 188,
    speed: 1.05,
    reach: 2.8,
    windup: 1.1,
    recover: 1.25,
    damage: 14,
  },
  effigy: {
    name: "ПУСТАЯ КУКЛА",
    hp: 80,
    speed: 1.8,
    reach: 2.05,
    windup: 0.72,
    recover: 0.9,
    damage: 9,
  },
  watcher: {
    name: "СМОТРИТЕЛЬ",
    hp: 94,
    speed: 1.35,
    reach: 2.5,
    windup: 0.92,
    recover: 1.15,
    damage: 11,
  },
  mimic: {
    name: "МИМИК",
    hp: 116,
    speed: 1.35,
    reach: 2.6,
    windup: 1.1,
    recover: 1.45,
    damage: 30,
  },
} as const;
export const ATTACKS = [
  {
    duration: 0.85,
    contact: 0.3,
    link: 0.52,
    damage: 16,
    cost: 16,
    lunge: 1.5,
    cancel: 0.57,
  },
  {
    duration: 0.77,
    contact: 0.27,
    link: 0.51,
    damage: 18,
    cost: 18,
    lunge: 1.8,
    cancel: 0.56,
  },
  {
    duration: 1.15,
    contact: 0.62,
    link: 1.15,
    damage: 28,
    cost: 24,
    lunge: 2.3,
    cancel: 0.96,
  },
] as const;
export interface MoveInput {
  x: number;
  z: number;
  guard: boolean;
}
export interface GameEvent {
  type:
    | "swing"
    | "hit"
    | "hurt"
    | "dodge"
    | "block"
    | "death"
    | "win"
    | "secret"
    | "weapon"
    | "door"
    | "drop";
  label?: string;
  x: number;
  z: number;
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const length = (x: number, z: number) => Math.hypot(x, z);
const fighter = (x: number, z: number): Fighter => ({
  x,
  y: 0,
  z,
  yaw: Math.PI,
  hp: 100,
  stamina: 100,
  mode: "idle",
  time: 0,
  speed: 0,
  combo: 0,
  chain: 0,
  reaction: 0,
  recoil: 0,
  dodgeSide: "Back",
  death: "Back",
  weapon: "sword",
  kind: "pilgrim",
  maxHp: 100,
  armour: 0,
});

export class CombatGame {
  player = fighter(0, 5);
  enemy: Fighter & { kind: EnemyKind } = {
    ...fighter(0, -3.8),
    hp: ENEMIES.gaoler.hp,
    maxHp: ENEMIES.gaoler.hp,
    yaw: 0,
    kind: "gaoler" as EnemyKind,
  };
  phase: "intro" | "playing" | "won" | "lost" | "finished" = "intro";
  elapsed = 0;
  tutorial = 0;
  secrets = new Set<string>();
  chestOpened = false;
  events: GameEvent[] = [];
  lock = false;
  hitPause = 0;
  guardCooldown = 0;
  private guardHeld = false;
  private vx = 0;
  private vz = 0;
  private dodgeX = 0;
  private dodgeZ = -1;
  private dodgeTravel = 0;
  private swingHit = false;
  private enemyHit = new WeakSet<Fighter>();
  private evasions = new WeakMap<
    Fighter,
    { next: number; x: number; z: number; travel: number }
  >();
  private dodgeRequest: { x: number; z: number; remaining: number } | null =
    null;
  private staminaDelay = 0;
  private distanceWalked = 0;
  private deathTime = 0;
  obstacles: Obstacle[] = [];
  bounds = { minX: -5.2, maxX: 5.2, minZ: -7.3, maxZ: 7.3 };
  heightAt: (x: number, z: number) => number = () => 0;
  enemyDormant = false;
  protected isObstacleActive(_o: Obstacle) {
    return true;
  }
  protected get opponents(): Fighter[] {
    return [this.enemy];
  }
  protected asleep(e: Fighter) {
    return e === this.enemy && this.enemyDormant;
  }
  protected clearLine(a: Fighter, b: Fighter) {
    if (Math.abs(a.y - b.y) > 1.1) return false;
    const dx = b.x - a.x,
      dz = b.z - a.z;
    return !this.obstacles.some((o) => {
      if (
        !this.isObstacleActive(o) ||
        (o.minY !== undefined && a.y < o.minY) ||
        (o.maxY !== undefined && a.y >= o.maxY)
      )
        return false;
      let lo = 0.04,
        hi = 0.96;
      for (const [start, delta, center, half] of [
        [a.x, dx, o.x, o.hx],
        [a.z, dz, o.z, o.hz],
      ]) {
        if (Math.abs(delta) < 1e-8) {
          if (Math.abs(start - center) > half) return false;
        } else {
          const u = (center - half - start) / delta,
            v = (center + half - start) / delta;
          lo = Math.max(lo, Math.min(u, v));
          hi = Math.min(hi, Math.max(u, v));
        }
        if (lo > hi) return false;
      }
      return true;
    });
  }

  start(kind: EnemyKind = "gaoler") {
    this.player = fighter(0, 5);
    this.enemy = {
      ...fighter(0, -3.8),
      hp: ENEMIES[kind].hp,
      maxHp: ENEMIES[kind].hp,
      yaw: 0,
      kind,
    };
    this.phase = "playing";
    this.elapsed = 0;
    this.tutorial = 0;
    this.secrets.clear();
    this.chestOpened = false;
    this.events = [];
    this.vx = this.vz = 0;
    this.dodgeRequest = null;
    this.swingHit = false;
    this.enemyHit = new WeakSet();
    this.staminaDelay = this.distanceWalked = this.deathTime = 0;
    this.lock = false;
    this.hitPause = 0;
    this.guardCooldown = 0;
    this.guardHeld = false;
    this.enemyDormant = false;
  }
  get distance() {
    return length(this.enemy.x - this.player.x, this.enemy.z - this.player.z);
  }
  get fighting() {
    return (
      this.phase === "playing" &&
      !this.enemyDormant &&
      this.enemy.hp > 0 &&
      this.distance < 7
    );
  }
  get enemyAngle() {
    return Math.atan2(
      this.enemy.x - this.player.x,
      this.enemy.z - this.player.z,
    );
  }
  protected set(f: Fighter, mode: Motion) {
    if (f.mode !== mode) {
      f.mode = mode;
      f.time = 0;
    }
  }
  private emit(type: GameEvent["type"], f = this.player) {
    this.events.push({ type, x: f.x, z: f.z });
  }
  attack() {
    const p = this.player;
    if (this.phase !== "playing" || p.hp <= 0) return;
    if (p.mode === "attack") {
      // Consecutive taps request at most a double/triple chain, never restart a swing.
      if (p.time >= 0.08) p.chain = Math.min(3, p.chain + 1);
      return;
    }
    if (
      (p.mode === "dodge" && p.time < DODGE.duration) ||
      p.mode === "hit" ||
      p.mode === "heal" ||
      p.stamina < Math.ceil(16 * WEAPONS[p.weapon].cost)
    )
      return;
    this.beginAttack(1);
    if (this.tutorial === 1) this.tutorial = 2;
  }
  private beginAttack(stage: number) {
    const p = this.player,
      a = ATTACKS[stage - 1];
    const cost = Math.ceil(a.cost * WEAPONS[p.weapon].cost);
    if (p.stamina < cost) return false;
    p.stamina -= cost;
    this.staminaDelay = 0.65;
    this.swingHit = false;
    if (this.distance < 4) p.yaw = this.enemyAngle;
    p.combo = stage;
    if (stage === 1) p.chain = 1;
    this.set(p, "attack");
    p.time = 0;
    this.emit("swing");
    return true;
  }
  dodge(move: { x: number; z: number }) {
    const p = this.player;
    if (
      this.phase !== "playing" ||
      p.hp <= 0 ||
      p.mode === "dodge" ||
      p.stamina < 22
    )
      return;
    if (
      (p.mode === "attack" && p.time < ATTACKS[p.combo - 1].cancel) ||
      p.mode === "hit"
    ) {
      this.dodgeRequest = { ...move, remaining: 0.8 };
      return;
    }
    let x = move.x,
      z = move.z,
      l = length(x, z);
    if (l < 0.1) {
      x = -Math.sin(p.yaw);
      z = -Math.cos(p.yaw);
      l = 1;
    }
    this.dodgeX = x / l;
    this.dodgeZ = z / l;
    this.dodgeTravel = 0;
    const side = this.dodgeX * Math.cos(p.yaw) - this.dodgeZ * Math.sin(p.yaw);
    const forward =
      this.dodgeX * Math.sin(p.yaw) + this.dodgeZ * Math.cos(p.yaw);
    p.dodgeSide =
      Math.abs(side) > 0.65
        ? side > 0
          ? "Right"
          : "Left"
        : forward > 0
          ? "Forward"
          : "Back";
    p.stamina -= 22;
    this.staminaDelay = 0.7;
    this.set(p, "dodge");
    p.combo = p.chain = 0;
    this.emit("dodge");
    if (this.tutorial >= 1 && this.tutorial < 3) this.tutorial = 3;
  }
  damagePlayer(amount: number, source: Fighter = this.enemy) {
    const p = this.player;
    if (p.hp <= 0 || this.phase !== "playing") return false;
    if (
      p.mode === "dodge" &&
      p.time >= DODGE.invulnerableStart &&
      p.time <= DODGE.invulnerableEnd
    )
      return false;
    amount = Math.ceil(amount * (p.armour ? 0.72 : 1));
    const facing = Math.cos(Math.atan2(source.x - p.x, source.z - p.z) - p.yaw);
    const impactCost = Math.ceil(BLOCK.impactBase + amount * BLOCK.impactScale);
    if (
      p.mode === "guard" &&
      p.recoil <= 0 &&
      p.stamina >= impactCost &&
      facing > 0.2
    ) {
      p.stamina -= impactCost;
      this.staminaDelay = 1;
      this.guardCooldown = BLOCK.cooldown;
      amount = Math.ceil(amount * 0.15);
      p.recoil = 0.32;
      this.hitPause = Math.max(this.hitPause, 0.018);
      this.emit("block");
    } else {
      if (p.mode === "guard") this.guardCooldown = BLOCK.cooldown;
      p.reaction = (p.reaction + 1) % 3;
      p.combo = p.chain = 0;
      this.set(p, "hit");
      this.vx += Math.sin(source.yaw) * 1.5;
      this.vz += Math.cos(source.yaw) * 1.5;
      this.hitPause = Math.max(this.hitPause, 0.04);
      this.emit("hurt");
    }
    p.hp = Math.max(0, p.hp - amount);
    if (p.hp === 0) {
      p.death = deathFromImpact(p, source);
      this.set(p, "dead");
      this.phase = "lost";
      this.emit("death");
      this.vx = this.vz = 0;
    }
    return true;
  }
  interact() {
    if (this.phase === "lost") {
      if (this.deathTime > 1.4) this.start();
      return;
    }
    if (this.player.hp <= 0) return;
    if (
      !this.chestOpened &&
      length(this.player.x - CHEST.x, this.player.z - CHEST.z) < CHEST.radius
    ) {
      this.chestOpened = true;
      this.player.weapon = "relic";
      this.emit("weapon");
      return;
    }
    for (const { id, x, z } of SECRETS) {
      if (
        length(this.player.x - x, this.player.z - z) < 1.7 &&
        !this.secrets.has(id)
      ) {
        this.secrets.add(id);
        this.emit("secret");
        return;
      }
    }
    if (
      this.phase === "won" &&
      this.player.z < -6.1 &&
      Math.abs(this.player.x) < 2
    ) {
      this.phase = "finished";
      this.set(this.player, "idle");
      this.player.speed = 0;
      this.vx = this.vz = 0;
    }
  }
  get nearby(): string {
    if (
      !this.chestOpened &&
      length(this.player.x - CHEST.x, this.player.z - CHEST.z) < CHEST.radius
    )
      return "Открыть сундук";
    for (const { id, x, z } of SECRETS) {
      if (
        length(this.player.x - x, this.player.z - z) < 1.7 &&
        !this.secrets.has(id)
      )
        return "Исследовать отголосок";
    }
    if (
      this.phase === "won" &&
      this.player.z < -6.1 &&
      Math.abs(this.player.x) < 2
    )
      return "Пройти дальше";
    return "";
  }
  update(dt: number, input: MoveInput) {
    if (this.phase === "intro" || this.phase === "finished") return;
    this.elapsed += dt;
    this.guardCooldown = Math.max(0, this.guardCooldown - dt);
    const raiseGuard = input.guard && !this.guardHeld;
    this.guardHeld = input.guard;
    // A very short pose hold gives contact weight while rendering stays continuous.
    const held = Math.min(dt, this.hitPause);
    this.hitPause -= held;
    dt -= held;
    if (dt <= 0) return;
    const p = this.player,
      e = this.enemy;
    p.time += dt * (p.mode === "attack" ? WEAPONS[p.weapon].tempo : 1);
    for (const foe of this.opponents) {
      foe.time += dt;
      foe.recoil = Math.max(0, foe.recoil - dt);
    }
    p.recoil = Math.max(0, p.recoil - dt);
    if (p.hp <= 0) {
      this.deathTime += dt;
      for (const foe of this.opponents) {
        foe.speed = 0;
        if (foe.hp > 0) this.set(foe, "idle");
      }
      return;
    }
    this.staminaDelay -= dt;
    if (this.staminaDelay < 0 && p.mode !== "guard")
      p.stamina = clamp(p.stamina + dt * 29, 0, 100);
    if (p.mode === "hit" && p.time > [0.4, 0.42, 0.46][p.reaction])
      this.set(p, "idle");
    if (this.dodgeRequest) {
      this.dodgeRequest.remaining -= dt;
      if (this.dodgeRequest.remaining <= 0) this.dodgeRequest = null;
      else if (
        (p.mode === "attack" && p.time >= ATTACKS[p.combo - 1].cancel) ||
        p.mode === "idle" ||
        p.mode === "move"
      ) {
        const requested = this.dodgeRequest;
        this.dodgeRequest = null;
        this.dodge(requested);
      }
    }
    if (p.mode === "dodge" && p.time >= DODGE.duration) {
      this.set(p, "idle");
      this.vx = this.vz = 0;
    }
    if (p.mode === "attack") {
      const attack = ATTACKS[p.combo - 1];
      if (!this.swingHit && p.time >= attack.contact) {
        this.swingHit = true;
        const targets =
          p.weapon === "spear"
            ? [...this.opponents].sort(
                (a, b) =>
                  length(a.x - p.x, a.z - p.z) - length(b.x - p.x, b.z - p.z),
              )
            : this.opponents;
        for (const e of targets) {
          const targetAngle = Math.atan2(e.x - p.x, e.z - p.z);
          const angle = Math.atan2(
            Math.sin(targetAngle - p.yaw),
            Math.cos(targetAngle - p.yaw),
          );
          if (
            e.hp > 0 &&
            !(
              e.mode === "dodge" &&
              e.time >= DODGE.invulnerableStart &&
              e.time <= DODGE.invulnerableEnd
            ) &&
            length(e.x - p.x, e.z - p.z) < WEAPONS[p.weapon].reach &&
            Math.abs(p.y - e.y) < 1.1 &&
            Math.abs(angle) < (p.weapon === "spear" ? 0.32 : 1.1) &&
            this.clearLine(p, e)
          ) {
            e.hp = Math.max(
              0,
              e.hp - Math.round(attack.damage * WEAPONS[p.weapon].damage),
            );
            e.reaction = (e.reaction + 1) % 3;
            e.recoil = p.combo === 3 ? 0.15 : 0.11;
            this.hitPause = Math.max(
              this.hitPause,
              p.combo === 3 ? 0.055 : 0.032,
            );
            this.emit("hit", e);
            if (e.hp === 0) {
              e.death = deathFromImpact(e, p);
              this.set(e, "dead");
              if (this.opponents.every((foe) => foe.hp <= 0))
                this.phase = "won";
              this.emit("win", e);
            } else if (e.mode !== "attack") {
              this.set(e, "hit");
            }
            if (p.weapon === "spear") break;
          }
        }
      }
      if (
        p.time >= attack.link &&
        p.combo < 3 &&
        p.chain > p.combo &&
        e.hp > 0
      ) {
        // Linked clips share this follow-through pose. Solo swings keep their recovery.
        if (!this.beginAttack(p.combo + 1)) p.chain = p.combo;
      } else if (p.time >= attack.duration) {
        this.set(p, "idle");
        p.combo = p.chain = 0;
      }
    }
    if (["idle", "move", "guard"].includes(p.mode)) {
      if (
        p.mode === "guard" &&
        (!input.guard ||
          (p.recoil <= 0 && (p.time >= BLOCK.window || this.guardCooldown > 0)))
      ) {
        this.set(p, "idle");
        this.guardCooldown = Math.max(this.guardCooldown, BLOCK.cooldown);
      }
      if (
        raiseGuard &&
        this.guardCooldown <= 0 &&
        p.stamina >= BLOCK.raiseCost
      ) {
        p.stamina -= BLOCK.raiseCost;
        this.staminaDelay = 0.7;
        this.set(p, "guard");
        if (this.distance < 6) p.yaw = this.enemyAngle;
      }
    }
    const movement = length(input.x, input.z);
    let speed =
      p.mode === "guard"
        ? 1.1
        : p.mode === "attack"
          ? 0.65
          : p.mode === "hit" || p.mode === "heal"
            ? 0
            : 3.1;
    let dx = input.x * speed,
      dz = input.z * speed;
    if (
      p.mode === "attack" &&
      p.time > 0.1 &&
      p.time < ATTACKS[p.combo - 1].contact + 0.07
    ) {
      dx += Math.sin(p.yaw) * ATTACKS[p.combo - 1].lunge;
      dz += Math.cos(p.yaw) * ATTACKS[p.combo - 1].lunge;
    }
    if (p.mode === "dodge") {
      // All humans use the grounded source step, including empty hands.
      const travel = dodgeTravelAt(p, p.time);
      const step = travel - this.dodgeTravel;
      this.dodgeTravel = travel;
      this.vx = (this.dodgeX * step) / dt;
      this.vz = (this.dodgeZ * step) / dt;
      this.move(p, this.dodgeX * step, this.dodgeZ * step);
    } else {
      const a = 1 - Math.exp(-dt * 13);
      this.vx += (dx - this.vx) * a;
      this.vz += (dz - this.vz) * a;
      this.move(p, this.vx * dt, this.vz * dt);
    }
    p.speed = length(this.vx, this.vz);
    if (["idle", "move"].includes(p.mode)) {
      this.set(p, movement > 0.08 ? "move" : "idle");
      let yaw = p.yaw;
      if (this.fighting && this.lock) yaw = this.enemyAngle;
      else if (movement > 0.08) yaw = Math.atan2(input.x, input.z);
      p.yaw +=
        Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)) *
        (1 - Math.exp(-dt * 15));
    }
    this.distanceWalked += p.speed * dt;
    if (this.distanceWalked > 1.8 && this.tutorial === 0) this.tutorial = 1;
    if (this.phase === "playing")
      for (const foe of this.opponents)
        if (foe.hp > 0 && !this.asleep(foe)) this.enemyUpdate(dt, foe);
  }
  private enemyUpdate(dt: number, e: Fighter) {
    const p = this.player,
      d = length(e.x - p.x, e.z - p.z);
    const evasion = this.evasions.get(e);
    if (e.mode === "dodge" && evasion) {
      const travel = dodgeTravelAt(e, e.time),
        step = travel - evasion.travel;
      evasion.travel = travel;
      this.move(e, evasion.x * step, evasion.z * step);
      if (e.time >= DODGE.duration) this.set(e, "recover");
      return;
    }
    e.stamina = Math.min(100, e.stamina + dt * 13);
    if (
      e.kind !== "mimic" &&
      ["idle", "move", "recover"].includes(e.mode) &&
      p.mode === "attack" &&
      p.time > 0.1 &&
      p.time < ATTACKS[Math.max(0, p.combo - 1)].contact - 0.045 &&
      d < WEAPONS[p.weapon].reach + 0.25 &&
      e.stamina >= 28 &&
      this.elapsed >= (evasion?.next ?? 3)
    ) {
      const facing = Math.atan2(p.x - e.x, p.z - e.z);
      for (const [side, offset] of [
        ["Left", -Math.PI / 2],
        ["Right", Math.PI / 2],
        ["Back", Math.PI],
      ] as const) {
        const x = Math.sin(facing + offset),
          z = Math.cos(facing + offset);
        const travel = dodgeTravelAt({ ...e, dodgeSide: side }, DODGE.duration);
        if (this.walkable(e.x + x * travel, e.z + z * travel, e.x, e.z, true)) {
          e.dodgeSide = side;
          e.stamina -= 28;
          this.evasions.set(e, { next: this.elapsed + 6.5, x, z, travel: 0 });
          this.set(e, "dodge");
          return;
        }
      }
    }
    if (!this.clearLine(e, p)) {
      e.speed = 0;
      this.set(e, "idle");
      return;
    }
    const profile = ENEMIES[e.kind as EnemyKind];
    const angle = Math.atan2(p.x - e.x, p.z - e.z);
    // The final windup commits to a direction. A roll can actually get behind it.
    if (
      ["idle", "move"].includes(e.mode) ||
      (e.mode === "windup" && e.time < profile.windup * 0.5) ||
      (e.mode === "recover" && e.time > 0.55)
    )
      e.yaw +=
        Math.atan2(Math.sin(angle - e.yaw), Math.cos(angle - e.yaw)) *
        (1 - Math.exp(-dt * 7));
    e.speed = 0;
    if (e.mode === "hit") {
      if (e.recoil > 0)
        this.move(
          e,
          Math.sin(p.yaw) * dt * e.recoil * 12,
          Math.cos(p.yaw) * dt * e.recoil * 12,
        );
      if (e.time > [0.4, 0.42, 0.46][e.reaction]) this.set(e, "recover");
      return;
    }
    if (e.mode === "windup") {
      if (e.time > profile.windup) {
        this.set(e, "attack");
        this.enemyHit.delete(e);
      }
      return;
    }
    if (e.mode === "attack") {
      const mimic = e.kind === "mimic";
      if (e.time < (mimic ? 0.55 : 0.25)) {
        const speed = mimic ? 3.6 : 2.2;
        this.move(
          e,
          Math.sin(e.yaw) * dt * speed,
          Math.cos(e.yaw) * dt * speed,
        );
        e.speed = speed;
      }
      const clip = ATTACKS[Math.max(0, e.combo - 1)],
        windupPose = clip.contact * 0.72;
      const contactTime = mimic
        ? 0.43
        : ((clip.contact - windupPose) / (clip.duration - windupPose)) * 0.68;
      if (e.time > contactTime && !this.enemyHit.has(e)) {
        this.enemyHit.add(e);
        const diff = Math.atan2(
          Math.sin(angle - e.yaw),
          Math.cos(angle - e.yaw),
        );
        if (
          d < profile.reach &&
          Math.abs(p.y - e.y) < 1.1 &&
          Math.abs(diff) < 1.15
        )
          this.damagePlayer(profile.damage, e);
      }
      if (e.time > (mimic ? 1 : 0.68)) this.set(e, "recover");
      return;
    }
    if (e.mode === "recover") {
      if (e.time > profile.recover) this.set(e, "idle");
      return;
    }
    if (d < profile.reach + 0.1) {
      e.combo = (e.combo % 3) + 1;
      this.set(e, "windup");
      return;
    }
    if (d < 5.8) {
      this.set(e, "move");
      e.speed = profile.speed;
      this.move(
        e,
        Math.sin(e.yaw) * dt * e.speed,
        Math.cos(e.yaw) * dt * e.speed,
      );
    } else this.set(e, "idle");
  }
  private staticPenetration(f: Fighter, x: number, z: number, o: Obstacle) {
    if (
      !this.isObstacleActive(o) ||
      (o.minY !== undefined && f.y < o.minY) ||
      (o.maxY !== undefined && f.y >= o.maxY)
    )
      return 0;
    const ax = Math.abs(x - o.x) - o.hx,
      az = Math.abs(z - o.z) - o.hz;
    return (
      bodyRadius(f) -
      (Math.hypot(Math.max(0, ax), Math.max(0, az)) +
        Math.min(0, Math.max(ax, az)))
    );
  }
  // Used by the ordinary-input route planner, with the same walls and corpses.
  walkable(
    x: number,
    z: number,
    fromX = this.player.x,
    fromZ = this.player.z,
    avoidLiving = false,
  ) {
    const f = {
      ...this.player,
      x: fromX,
      z: fromZ,
      y: this.heightAt(fromX, fromZ),
    };
    if (
      x < this.bounds.minX ||
      x > this.bounds.maxX ||
      z < this.bounds.minZ ||
      z > this.bounds.maxZ ||
      this.heightAt(x, z) > f.y + 0.3
    )
      return false;
    if (
      this.obstacles.some((o) => {
        const next = this.staticPenetration(f, x, z, o);
        return (
          next > 1e-6 &&
          next >= this.staticPenetration(f, fromX, fromZ, o) - 1e-7
        );
      })
    )
      return false;
    return !this.opponents.some((o) => {
      if (o === this.player || (!avoidLiving && o.hp > 0)) return false;
      const next = bodyPenetration(f, x, z, o);
      return next > 1e-6 && next >= bodyPenetration(f, fromX, fromZ, o) - 1e-7;
    });
  }
  private move(f: Fighter, dx: number, dz: number) {
    const others =
      f === this.player
        ? this.opponents
        : [this.player, ...this.opponents.filter((e) => e !== f)];
    const can = (x: number, z: number) => {
      if (this.heightAt(x, z) > f.y + 0.3) return false;
      for (const o of this.obstacles) {
        const next = this.staticPenetration(f, x, z, o);
        if (
          next > 1e-6 &&
          next >= this.staticPenetration(f, f.x, f.z, o) - 1e-7
        )
          return false;
      }
      for (const o of others) {
        const next = bodyPenetration(f, x, z, o);
        if (next > 1e-6 && next >= bodyPenetration(f, f.x, f.z, o) - 1e-7)
          return false;
      }
      return true;
    };
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    for (let i = 0; i < steps; i++) {
      const x = clamp(f.x + dx / steps, this.bounds.minX, this.bounds.maxX),
        z = clamp(f.z + dz / steps, this.bounds.minZ, this.bounds.maxZ);
      if (can(x, f.z)) f.x = x;
      if (can(f.x, z)) f.z = z;
      f.y = this.heightAt(f.x, f.z);
    }
  }
}
