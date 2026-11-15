// Local movement/combat vertical slice. Never submitted to the prize leaderboard.
export type Motion =
  | "idle"
  | "move"
  | "attack"
  | "dodge"
  | "guard"
  | "hit"
  | "dead"
  | "windup"
  | "recover";
export interface Fighter {
  x: number;
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
  kind: "pilgrim" | EnemyKind;
  maxHp: number;
}
export type EnemyKind = "gaoler" | "effigy" | "watcher";
export const ENEMIES = {
  gaoler: {
    name: "НОСИЛЬЩИК",
    hp: 112,
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
} as const;
export const ATTACKS = [
  {
    duration: 0.58,
    contact: 0.235,
    damage: 16,
    cost: 16,
    lunge: 1.5,
    cancel: 0.3,
  },
  {
    duration: 0.55,
    contact: 0.22,
    damage: 18,
    cost: 18,
    lunge: 1.8,
    cancel: 0.43,
  },
  {
    duration: 0.85,
    contact: 0.34,
    damage: 28,
    cost: 24,
    lunge: 2.3,
    cancel: 0.7,
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
    | "secret";
  x: number;
  z: number;
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const length = (x: number, z: number) => Math.hypot(x, z);
const fighter = (x: number, z: number): Fighter => ({
  x,
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
  kind: "pilgrim",
  maxHp: 100,
});

export class CombatGame {
  player = fighter(0, 5);
  enemy = {
    ...fighter(0, -3.8),
    hp: 112,
    maxHp: 112,
    yaw: 0,
    kind: "gaoler" as EnemyKind,
  };
  phase: "intro" | "playing" | "won" | "lost" | "finished" = "intro";
  elapsed = 0;
  tutorial = 0;
  secrets = new Set<string>();
  events: GameEvent[] = [];
  lock = false;
  private vx = 0;
  private vz = 0;
  private dodgeX = 0;
  private dodgeZ = -1;
  private swingHit = false;
  private enemyHit = false;
  private dodgeRequest: { x: number; z: number; remaining: number } | null =
    null;
  private staminaDelay = 0;
  private distanceWalked = 0;
  private deathTime = 0;
  obstacles: { x: number; z: number; hx: number; hz: number }[] = [];

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
    this.events = [];
    this.vx = this.vz = 0;
    this.dodgeRequest = null;
    this.swingHit = this.enemyHit = false;
    this.staminaDelay = this.distanceWalked = this.deathTime = 0;
    this.lock = false;
  }
  get distance() {
    return length(this.enemy.x - this.player.x, this.enemy.z - this.player.z);
  }
  get fighting() {
    return this.phase === "playing" && this.enemy.hp > 0 && this.distance < 6;
  }
  get enemyAngle() {
    return Math.atan2(
      this.enemy.x - this.player.x,
      this.enemy.z - this.player.z,
    );
  }
  private set(f: Fighter, mode: Motion) {
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
      (p.mode === "dodge" && p.time < 0.36) ||
      p.mode === "hit" ||
      p.stamina < 16
    )
      return;
    this.beginAttack(1);
    if (this.tutorial === 1) this.tutorial = 2;
  }
  private beginAttack(stage: number) {
    const p = this.player,
      a = ATTACKS[stage - 1];
    if (p.stamina < a.cost) return false;
    p.stamina -= a.cost;
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
  damagePlayer(amount: number) {
    const p = this.player;
    if (p.hp <= 0 || this.phase !== "playing") return false;
    if (p.mode === "dodge" && p.time >= 0.05 && p.time <= 0.38) return false;
    if (p.mode === "guard" && p.stamina >= 12) {
      p.stamina -= 12;
      amount = Math.ceil(amount * 0.15);
      p.recoil = 0.32;
      this.emit("block");
    } else {
      p.reaction = (p.reaction + 1) % 3;
      p.combo = p.chain = 0;
      this.set(p, "hit");
      this.emit("hurt");
    }
    p.hp = Math.max(0, p.hp - amount);
    if (p.hp === 0) {
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
    for (const [id, x, z] of [
      ["inscription", -4.1, 0.4],
      ["echo", 4.3, -4.8],
    ] as const) {
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
    )
      this.phase = "finished";
  }
  get nearby() {
    for (const [id, x, z] of [
      ["inscription", -4.1, 0.4],
      ["echo", 4.3, -4.8],
    ] as const) {
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
      return "Покинуть архив";
    return "";
  }
  update(dt: number, input: MoveInput) {
    if (this.phase === "intro" || this.phase === "finished") return;
    this.elapsed += dt;
    const p = this.player,
      e = this.enemy;
    p.time += dt;
    e.time += dt;
    p.recoil = Math.max(0, p.recoil - dt);
    if (p.hp <= 0) {
      this.deathTime += dt;
      e.speed = 0;
      this.set(e, "idle");
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
    if (p.mode === "dodge" && p.time > 0.52) this.set(p, "idle");
    if (p.mode === "attack") {
      const attack = ATTACKS[p.combo - 1];
      if (!this.swingHit && p.time >= attack.contact) {
        this.swingHit = true;
        const angle = Math.atan2(
          Math.sin(this.enemyAngle - p.yaw),
          Math.cos(this.enemyAngle - p.yaw),
        );
        if (e.hp > 0 && this.distance < 2.05 && Math.abs(angle) < 1.1) {
          e.hp = Math.max(0, e.hp - attack.damage);
          e.reaction = (e.reaction + 1) % 3;
          this.emit("hit", e);
          if (e.hp === 0) {
            this.set(e, "dead");
            this.phase = "won";
            this.emit("win", e);
          } else if (e.mode !== "attack") {
            this.set(e, "hit");
          }
        }
      }
      if (p.time >= attack.duration) {
        const continued =
          p.combo < 3 &&
          p.chain > p.combo &&
          e.hp > 0 &&
          this.beginAttack(p.combo + 1);
        if (!continued) {
          this.set(p, "idle");
          p.combo = p.chain = 0;
        }
      }
    }
    if (["idle", "move", "guard"].includes(p.mode)) {
      if (input.guard) {
        this.set(p, "guard");
        if (this.distance < 6) p.yaw = this.enemyAngle;
      } else if (p.mode === "guard") this.set(p, "idle");
    }
    const movement = length(input.x, input.z);
    let speed =
      p.mode === "guard"
        ? 1.1
        : p.mode === "attack"
          ? 0.65
          : p.mode === "hit"
            ? 0
            : 3.1;
    let dx = input.x * speed,
      dz = input.z * speed;
    if (p.mode === "dodge") {
      const curve = Math.sin(clamp(p.time / 0.52, 0, 1) * Math.PI);
      dx = this.dodgeX * (3.4 + curve * 3.8);
      dz = this.dodgeZ * (3.4 + curve * 3.8);
    }
    if (
      p.mode === "attack" &&
      p.time > 0.1 &&
      p.time < ATTACKS[p.combo - 1].contact + 0.07
    ) {
      dx += Math.sin(p.yaw) * ATTACKS[p.combo - 1].lunge;
      dz += Math.cos(p.yaw) * ATTACKS[p.combo - 1].lunge;
    }
    const a = 1 - Math.exp(-dt * (p.mode === "dodge" ? 28 : 13));
    this.vx += (dx - this.vx) * a;
    this.vz += (dz - this.vz) * a;
    this.move(p, this.vx * dt, this.vz * dt);
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
    if (e.hp > 0 && this.phase === "playing") this.enemyUpdate(dt);
  }
  private enemyUpdate(dt: number) {
    const e = this.enemy,
      p = this.player,
      d = this.distance;
    const profile = ENEMIES[e.kind as EnemyKind];
    const angle = Math.atan2(p.x - e.x, p.z - e.z);
    if (e.mode !== "attack")
      e.yaw +=
        Math.atan2(Math.sin(angle - e.yaw), Math.cos(angle - e.yaw)) *
        (1 - Math.exp(-dt * 7));
    e.speed = 0;
    if (e.mode === "hit") {
      if (e.time > [0.4, 0.42, 0.46][e.reaction]) this.set(e, "recover");
      return;
    }
    if (e.mode === "windup") {
      if (e.time > profile.windup) {
        this.set(e, "attack");
        this.enemyHit = false;
      }
      return;
    }
    if (e.mode === "attack") {
      if (e.time < 0.25) {
        this.move(e, Math.sin(e.yaw) * dt * 2.2, Math.cos(e.yaw) * dt * 2.2);
        e.speed = 2.2;
      }
      const clip = ATTACKS[Math.max(0, e.combo - 1)],
        windupPose = clip.contact * 0.72;
      const contactTime =
        ((clip.contact - windupPose) / (clip.duration - windupPose)) * 0.68;
      if (e.time > contactTime && !this.enemyHit) {
        this.enemyHit = true;
        const diff = Math.atan2(
          Math.sin(angle - e.yaw),
          Math.cos(angle - e.yaw),
        );
        if (d < profile.reach && Math.abs(diff) < 1.15)
          this.damagePlayer(profile.damage);
      }
      if (e.time > 0.68) this.set(e, "recover");
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
  private move(f: Fighter, dx: number, dz: number) {
    const can = (x: number, z: number) =>
      !this.obstacles.some(
        (o) =>
          Math.abs(x - o.x) < o.hx + 0.28 && Math.abs(z - o.z) < o.hz + 0.28,
      );
    const x = clamp(f.x + dx, -5.2, 5.2),
      z = clamp(f.z + dz, -7.3, 7.3);
    if (can(x, f.z)) f.x = x;
    if (can(f.x, z)) f.z = z;
    const other = f === this.player ? this.enemy : this.player;
    if (other.hp > 0 && f.hp > 0) {
      const ox = f.x - other.x,
        oz = f.z - other.z,
        d = length(ox, oz);
      const separation = this.enemy.kind === "gaoler" ? 1.1 : 0.82;
      if (d > 0 && d < separation) {
        f.x = other.x + (ox / d) * separation;
        f.z = other.z + (oz / d) * separation;
      }
    }
  }
}
