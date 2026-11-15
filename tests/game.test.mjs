import { test } from "node:test";
import assert from "node:assert/strict";
import { CombatGame, ATTACKS } from "../src/game.ts";
import { Showcase } from "../src/showcase.ts";

const still = { x: 0, z: 0, guard: false };
test("review input driver demonstrates all three attacks, a block, a dodge and wins normally", () => {
  const g = new CombatGame();
  g.start();
  const demo = new Showcase(g),
    stages = new Set();
  let blocked = false,
    dodged = false;
  for (let n = 0; n < 120 * 24 && g.phase !== "finished"; n++) {
    const move = demo.update(1 / 120);
    g.update(1 / 120, move);
    if (g.player.mode === "attack") stages.add(g.player.combo);
    blocked ||= g.player.recoil > 0;
    dodged ||= g.player.mode === "dodge";
  }
  assert.deepEqual([...stages], [1, 2, 3]);
  assert.ok(blocked);
  assert.ok(dodged);
  assert.equal(g.phase, "finished");
});
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
  assert.equal(g.enemy.hp, g.enemy.maxHp - 16);
  advance(g, 0.1);
  assert.equal(g.enemy.hp, g.enemy.maxHp - 16);
  const hp = g.enemy.hp;
  g.player.z = 5;
  advance(g, 0.4);
  g.attack();
  advance(g, 0.5);
  assert.equal(g.enemy.hp, hp);
});

test("one, two and three taps produce bounded distinct chains and corresponding damage", () => {
  for (const count of [1, 2, 3]) {
    const g = new CombatGame();
    g.start();
    g.player.z = -2.5;
    g.enemy.z = -3.8;
    g.attack();
    advance(g, 0.1);
    for (let i = 1; i < count; i++) g.attack();
    const stages = new Set([g.player.combo]);
    for (let t = 0; t < 2.2; t += 1 / 120) {
      g.update(1 / 120, still);
      if (g.player.mode === "attack") stages.add(g.player.combo);
    }
    assert.deepEqual(
      [...stages],
      [...Array(count)].map((_, i) => i + 1),
    );
    assert.equal(
      g.enemy.hp,
      g.enemy.maxHp - ATTACKS.slice(0, count).reduce((n, a) => n + a.damage, 0),
    );
  }
});
test("held block never cancels a combo, and only guards after the final recovery", () => {
  const g = new CombatGame();
  g.start();
  g.attack();
  advance(g, 0.1);
  g.attack();
  g.attack();
  advance(g, 0.6, { ...still, guard: true });
  assert.equal(g.player.mode, "attack");
  assert.equal(g.player.combo, 2);
  g.damagePlayer(10);
  assert.equal(g.player.hp, 90); // no guard mitigation inside combo
  const h = new CombatGame();
  h.start();
  h.attack();
  advance(h, 0.1);
  h.attack();
  h.attack();
  advance(h, 2.1, { ...still, guard: true });
  assert.equal(h.player.mode, "guard");
  h.damagePlayer(10);
  assert.equal(h.player.hp, 98);
  assert.ok(h.player.recoil > 0);
});

test("tap spam is bounded to three stages, cannot spend negative stamina, and casts have different profiles", () => {
  const g = new CombatGame();
  g.start();
  g.attack();
  advance(g, 0.1);
  for (let i = 0; i < 15; i++) g.attack();
  assert.equal(g.player.chain, 3);
  g.player.stamina = 1;
  advance(g, 2);
  assert.ok(g.player.stamina >= 0);
  assert.equal(g.player.combo, 0);
  const hp = [];
  for (const kind of ["gaoler", "effigy", "watcher"]) {
    g.start(kind);
    hp.push(g.enemy.maxHp);
    assert.equal(g.enemy.kind, kind);
  }
  assert.equal(new Set(hp).size, 3);
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
