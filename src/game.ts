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
}
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
});

export class CombatGame {
  player = fighter(0, 5);
  enemy = { ...fighter(0, -3.8), hp: 80, yaw: 0 };
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
  private attackBuffered = false;
  private dodgeRequest: { x: number; z: number; remaining: number } | null =
    null;
  private staminaDelay = 0;
  private distanceWalked = 0;
  private deathTime = 0;
  obstacles: { x: number; z: number; hx: number; hz: number }[] = [];

  start() {
    this.player = fighter(0, 5);
    this.enemy = { ...fighter(0, -3.8), hp: 80, yaw: 0 };
    this.phase = "playing";
    this.elapsed = 0;
    this.tutorial = 0;
    this.secrets.clear();
    this.events = [];
    this.vx = this.vz = 0;
    this.dodgeRequest = null;
    this.swingHit = this.enemyHit = this.attackBuffered = false;
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
      if (p.time > 0.28) this.attackBuffered = true;
      return;
    }
    if (
      (p.mode === "dodge" && p.time < 0.36) ||
      p.mode === "hit" ||
      p.stamina < 16
    )
      return;
    p.stamina -= 16;
    this.staminaDelay = 0.65;
    this.swingHit = false;
    if (this.distance < 4) p.yaw = this.enemyAngle;
    p.combo = (p.combo + 1) % 2;
    this.set(p, "attack");
    p.time = 0;
    this.emit("swing");
    if (this.tutorial === 1) this.tutorial = 2;
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
    if ((p.mode === "attack" && p.time < 0.3) || p.mode === "hit") {
      this.dodgeRequest = { ...move, remaining: 0.45 };
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
    p.stamina -= 22;
    this.staminaDelay = 0.7;
    this.set(p, "dodge");
    this.attackBuffered = false;
    this.emit("dodge");
    if (this.tutorial >= 1 && this.tutorial < 3) this.tutorial = 3;
  }
  damagePlayer(amount: number) {
    const p = this.player;
    if (p.hp <= 0 || this.phase !== "playing") return false;
    if (p.mode === "dodge" && p.time >= 0.05 && p.time <= 0.38) return false;
    if (p.mode === "guard" && p.stamina > 10) {
      p.stamina -= 12;
      amount = Math.ceil(amount * 0.15);
      this.emit("block");
    } else {
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
    if (p.hp <= 0) {
      this.deathTime += dt;
      e.speed = 0;
      this.set(e, "idle");
      return;
    }
    this.staminaDelay -= dt;
    if (this.staminaDelay < 0 && p.mode !== "guard")
      p.stamina = clamp(p.stamina + dt * 29, 0, 100);
    if (p.mode === "hit" && p.time > 0.27) this.set(p, "idle");
    if (this.dodgeRequest) {
      this.dodgeRequest.remaining -= dt;
      if (this.dodgeRequest.remaining <= 0) this.dodgeRequest = null;
      else if (
        (p.mode === "attack" && p.time >= 0.3) ||
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
      if (!this.swingHit && p.time >= 0.21) {
        this.swingHit = true;
        const angle = Math.atan2(
          Math.sin(this.enemyAngle - p.yaw),
          Math.cos(this.enemyAngle - p.yaw),
        );
        if (e.hp > 0 && this.distance < 2.05 && Math.abs(angle) < 1.1) {
          e.hp = Math.max(0, e.hp - 16);
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
      if (p.time > 0.64) {
        this.set(p, "idle");
        if (this.attackBuffered) {
          this.attackBuffered = false;
          this.attack();
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
    if (p.mode === "attack" && p.time > 0.12 && p.time < 0.3) {
      dx += Math.sin(p.yaw) * 1.9;
      dz += Math.cos(p.yaw) * 1.9;
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
    const angle = Math.atan2(p.x - e.x, p.z - e.z);
    if (e.mode !== "attack")
      e.yaw +=
        Math.atan2(Math.sin(angle - e.yaw), Math.cos(angle - e.yaw)) *
        (1 - Math.exp(-dt * 7));
    e.speed = 0;
    if (e.mode === "hit") {
      if (e.time > 0.3) this.set(e, "recover");
      return;
    }
    if (e.mode === "windup") {
      if (e.time > 1.0) {
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
      if (e.time > 0.22 && !this.enemyHit) {
        this.enemyHit = true;
        const diff = Math.atan2(
          Math.sin(angle - e.yaw),
          Math.cos(angle - e.yaw),
        );
        if (d < 2.8 && Math.abs(diff) < 1.15) this.damagePlayer(12);
      }
      if (e.time > 0.68) this.set(e, "recover");
      return;
    }
    if (e.mode === "recover") {
      if (e.time > 1.35) this.set(e, "idle");
      return;
    }
    if (d < 2.9) {
      this.set(e, "windup");
      return;
    }
    if (d < 5.8) {
      this.set(e, "move");
      e.speed = 1.35;
      this.move(e, Math.sin(e.yaw) * dt * 1.35, Math.cos(e.yaw) * dt * 1.35);
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
      if (d > 0 && d < 0.87) {
        f.x = other.x + (ox / d) * 0.87;
        f.z = other.z + (oz / d) * 0.87;
      }
    }
  }
}
