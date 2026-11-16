import { ATTACKS, ENEMIES, type Fighter, type EnemyKind } from "./game.ts";

export function wieldedWeapon(f: Fighter) {
  return f.kind === "gaoler"
    ? "axe"
    : f.kind === "effigy"
      ? "unarmed"
      : f.weapon;
}
export function motionName(f: Fighter) {
  const weapon = wieldedWeapon(f);
  if (f.mode === "dead") return `Death${f.death}`;
  if (f.mode === "attack" || f.mode === "windup")
    return `${weapon === "sword" || weapon === "relic" ? "Sword" : weapon === "spear" ? "Spear" : weapon === "unarmed" ? "Fist" : ""}Attack${Math.max(1, Math.min(3, f.combo || 1))}`;
  if (f.mode === "dodge") return `Evade${f.dodgeSide}`;
  if (f.mode === "guard") return f.recoil > 0 ? "BlockHit" : "Guard";
  if (f.mode === "hit") return ["HitFront", "HitLeft", "HitRight"][f.reaction];
  return f.speed > 1.65 ? "Run" : f.speed > 0.1 ? "Walk" : "Idle";
}
export function semanticAttackTime(f: Fighter, enemy: boolean) {
  const a = ATTACKS[Math.max(0, (f.combo || 1) - 1)];
  if (f.mode === "windup") {
    const u = Math.min(
      1,
      Math.max(0, f.time / (ENEMIES[f.kind as EnemyKind].windup * 0.9)),
    );
    return a.contact * 0.72 * u * u * (3 - 2 * u);
  }
  return enemy
    ? a.contact * 0.72 + (f.time * (a.duration - a.contact * 0.72)) / 0.68
    : f.time;
}
// Retained axe clips use their original contact and link poses.
export function sourceAttackTime(name: string, time: number, index: number) {
  if (/^(Sword|Spear|Fist)/.test(name)) return time;
  const a = ATTACKS[index],
    old = [
      { duration: 0.74, contact: 0.3, link: 0.52 },
      { duration: 0.7, contact: 0.27, link: 0.51 },
      { duration: 1, contact: 0.42, link: 1 },
    ][index];
  const points = [
    [0, 0],
    [a.contact, old.contact],
    [a.link, old.link],
    [a.duration, old.duration],
  ];
  for (let i = 1; i < points.length; i++)
    if (time <= points[i][0]) {
      const [x, y] = points[i - 1],
        [xx, yy] = points[i];
      return y + ((yy - y) * (time - x)) / (xx - x || 1);
    }
  return old.duration;
}
