import test from "node:test";
import assert from "node:assert/strict";
import { CombatGame } from "../src/game.ts";
import { motionName } from "../src/motion-policy.ts";

const rest = { x: 0, z: 0, guard: false };
function setup(weapon = "sword") {
  const g = new CombatGame();
  g.start("gaoler");
  g.enemyDormant = true;
  g.player.x = g.player.z = 0;
  g.player.yaw = 0;
  g.player.weapon = weapon;
  g.enemy.x = 0;
  g.enemy.z = 1.65;
  g.enemy.yaw = Math.PI;
  return g;
}
function advance(g, s, input = rest) {
  for (let i = 0; i < Math.ceil(s * 120); i++) g.update(1 / 120, input);
}
test("a committed spear thrust deals substantially more damage and spends more stamina than a sword cut", () => {
  const run = (id) => {
    const g = setup(id),
      hp = g.enemy.hp;
    g.attack();
    advance(g, 0.45);
    return { damage: hp - g.enemy.hp, spent: 100 - g.player.stamina };
  };
  const sword = run("sword"),
    spear = run("spear");
  assert(spear.damage >= sword.damage * 1.7);
  assert(spear.spent >= sword.spent * 1.5);
});
test("a spear thrust reaches the frontal target without cutting a neighbour outside its narrow line", () => {
  class Multiple extends CombatGame {
    extra;
    get opponents() {
      return this.extra ? [this.enemy, this.extra] : [this.enemy];
    }
    asleep() {
      return true;
    }
  }
  const g = new Multiple();
  g.start("watcher");
  g.enemyDormant = true;
  g.player.x = g.player.z = 0;
  g.player.yaw = 0;
  g.player.weapon = "spear";
  g.enemy.x = 0;
  g.enemy.z = 1.7;
  g.extra = { ...g.enemy, x: 1, z: 1.7 };
  g.attack();
  advance(g, 0.45);
  assert(g.enemy.hp < g.enemy.maxHp);
  assert.equal(g.extra.hp, g.extra.maxHp);
});
test("a blocked blow costs serious stamina and the cooldown prevents a held-button block chain", () => {
  const g = setup();
  g.update(1 / 120, { ...rest, guard: true });
  assert.equal(g.player.mode, "guard");
  const before = g.player.stamina;
  g.damagePlayer(20);
  assert(before - g.player.stamina >= 30);
  const hp = g.player.hp;
  advance(g, 0.36, { ...rest, guard: true });
  g.damagePlayer(20);
  assert(hp - g.player.hp >= 18);
  advance(g, 1.8, { ...rest, guard: true });
  assert.notEqual(g.player.mode, "guard");
  g.update(1 / 120, rest);
  g.update(1 / 120, { ...rest, guard: true });
  assert.equal(g.player.mode, "guard");
});
test("unarmed attacks and spear attacks select their own full-body clips", () => {
  const g = setup();
  g.player.mode = "attack";
  g.player.combo = 1;
  g.player.weapon = "unarmed";
  assert.equal(motionName(g.player), "FistAttack1");
  g.player.weapon = "spear";
  assert.equal(motionName(g.player), "SpearAttack1");
});
test("the gaoler endures substantially more than the previous 112 HP", () => {
  const g = setup();
  assert(g.enemy.maxHp >= 180);
});
