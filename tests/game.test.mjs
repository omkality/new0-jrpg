import { test } from "node:test";
import assert from "node:assert/strict";
import { CombatGame } from "../src/game.ts";

const still = { x: 0, z: 0, guard: false };
function advance(g, seconds, input = still) {
  for (let n = 0; n < Math.round(seconds * 120); n++) g.update(1 / 120, input);
}
test("sword connects once per swing, respects range and never pauses for a turn", () => {
  const g = new CombatGame();
  g.start();
  g.player.x = 0;
  g.player.z = -1.7;
  g.enemy.z = -3;
  g.attack();
  advance(g, 0.4);
  assert.equal(g.enemy.hp, 64);
  advance(g, 0.1);
  assert.equal(g.enemy.hp, 64);
  const hp = g.enemy.hp;
  g.player.z = 5;
  advance(g, 0.4);
  g.attack();
  advance(g, 0.5);
  assert.equal(g.enemy.hp, hp);
});
test("early dodge has an invulnerable window and costs stamina", () => {
  const g = new CombatGame();
  g.start();
  g.dodge({ x: 1, z: 0 });
  advance(g, 0.12);
  assert.equal(g.player.mode, "dodge");
  assert.ok(g.player.stamina < 100);
  assert.equal(g.damagePlayer(15), false);
  assert.equal(g.player.hp, 100);
  advance(g, 0.6);
  assert.equal(g.damagePlayer(15), true);
  assert.equal(g.player.hp, 85);
});
test("movement is time based, accelerates and remains within the room", () => {
  const a = new CombatGame(),
    b = new CombatGame();
  a.start();
  b.start();
  for (let i = 0; i < 60; i++) a.update(1 / 60, { ...still, x: 1 });
  for (let i = 0; i < 120; i++) b.update(1 / 120, { ...still, x: 1 });
  assert.ok(Math.abs(a.player.x - b.player.x) < 0.07);
  advance(a, 10, { ...still, x: 1 });
  assert.ok(a.player.x <= 5.2);
});

test("dodge pressed during an attack is buffered until the early recovery window", () => {
  const g = new CombatGame();
  g.start();
  g.attack();
  advance(g, 0.08);
  g.dodge({ x: 1, z: 0 });
  assert.equal(g.player.mode, "attack");
  advance(g, 0.25);
  assert.equal(g.player.mode, "dodge");
});
test("enemy telegraphs before an attack, death stays on the ground and retry resets", () => {
  const g = new CombatGame();
  g.start();
  g.player.z = -1.2;
  advance(g, 0.1);
  assert.equal(g.enemy.mode, "windup");
  assert.equal(g.player.hp, 100);
  advance(g, 1.5);
  assert.ok(g.player.hp < 100);
  g.damagePlayer(200);
  assert.equal(g.player.mode, "dead");
  const z = g.player.z;
  advance(g, 2, { ...still, z: 1 });
  assert.equal(g.player.z, z);
  g.start();
  assert.equal(g.player.hp, 100);
  assert.equal(g.player.mode, "idle");
});
