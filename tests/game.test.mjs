import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CombatGame, ATTACKS, DODGE, CHEST } from "../src/game.ts";
import { Showcase, DEMO_ENEMIES } from "../src/showcase.ts";

const still = { x: 0, z: 0, guard: false };
test("gameplay contact and chain links match the authored animation contract", () => {
  const native = JSON.parse(
    readFileSync(
      new URL("../public/assets/motion/contract.json", import.meta.url),
      "utf8",
    ),
  );
  const contract = JSON.parse(
    readFileSync(
      new URL("../public/assets/motion/fixes1-contract.json", import.meta.url),
      "utf8",
    ),
  );
  for (let i = 0; i < 3; i++) {
    const clip = contract.attacks["Attack" + (i + 1)];
    assert.equal(ATTACKS[i].duration, clip.duration);
    assert.equal(ATTACKS[i].contact, clip.contact);
    if (clip.link !== null) assert.equal(ATTACKS[i].link, clip.link);
  }
  assert.equal(DODGE.duration, native.dodges);
  assert.equal(DODGE.travelStart, native.dodgeTravel.start);
  assert.equal(DODGE.travelEnd, native.dodgeTravel.end);
  assert.equal(DODGE.distance, native.dodgeTravel.distance);
});
test("queued combo follows through before solo recovery ends, contact hold does not skip a hit", () => {
  const g = new CombatGame();
  g.start();
  g.attack();
  advance(g, 0.12);
  g.attack();
  advance(g, 0.42);
  assert.equal(g.player.combo, 2);
  assert.ok(g.player.time < 0.06);
  const solo = new CombatGame();
  solo.start();
  solo.attack();
  advance(solo, 0.54);
  assert.equal(solo.player.combo, 1);
  assert.equal(solo.player.mode, "attack");
  advance(solo, ATTACKS[0].duration - 0.54 + 0.06);
  assert.equal(solo.player.mode, "idle");
});
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
  assert.equal(g.player.mode, "idle");
  assert.equal(g.player.speed, 0);
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
test("roll compression and landing are planted, attacks cannot truncate the rotation", () => {
  const g = new CombatGame();
  g.start();
  const x = g.player.x;
  g.dodge({ x: 1, z: 0 });
  advance(g, DODGE.travelStart - 0.02);
  assert.equal(g.player.x, x);
  advance(g, 0.3);
  g.attack();
  assert.equal(g.player.mode, "dodge");
  advance(g, 0.25);
  const landed = g.player.x;
  assert.ok(Math.abs(landed - x - DODGE.distance) < 0.001);
  advance(g, 0.12);
  assert.equal(g.player.x, landed);
  advance(g, 0.1);
  assert.equal(g.player.mode, "idle");
});
test("a real killing blow selects back, front and side falls from the impact direction", () => {
  for (const [x, z, fall] of [
    [0, -2.4, "Back"],
    [0, -5.2, "Front"],
    [-1.4, -3.8, "Side"],
  ]) {
    const g = new CombatGame();
    g.start();
    g.player.x = x;
    g.player.z = z;
    g.enemy.mode = "windup";
    g.enemy.time = 0.6;
    g.enemy.combo = 1;
    g.enemy.hp = 1;
    g.attack();
    advance(g, 0.36);
    assert.equal(g.enemy.mode, "dead");
    assert.equal(g.enemy.death, fall);
    const pose = { x: g.enemy.x, z: g.enemy.z, yaw: g.enemy.yaw };
    advance(g, 2);
    assert.deepEqual({ x: g.enemy.x, z: g.enemy.z, yaw: g.enemy.yaw }, pose);
  }
});
test("three varied tours collect both secrets, equip the chest weapon and exit through collision", () => {
  const falls = new Set(),
    opponents = new Set(),
    chains = new Set();
  for (const location of ["chapel", "roofs", "courtyard"]) {
    const g = new CombatGame();
    g.start(DEMO_ENEMIES[location]);
    g.obstacles = [
      { x: CHEST.x, z: CHEST.z, hx: 0.7, hz: 0.49 },
      { x: -4.1, z: 0.4, hx: 0.85, hz: 0.58 },
      { x: 4.3, z: -4.8, hx: 0.5, hz: 0.5 },
      ...[-7, 0, 6.7].flatMap((z) =>
        [-4.2, 4.2].map((x) => ({ x, z, hx: 0.4, hz: 0.4 })),
      ),
    ];
    const tour = new Showcase(g, location),
      cameras = [];
    let block = false,
      roll = false,
      largestChain = 0,
      maxStep = 0;
    for (let n = 0; n < 120 * 30 && g.phase !== "finished"; n++) {
      const before = { x: g.player.x, z: g.player.z };
      g.update(1 / 120, tour.update(1 / 120));
      maxStep = Math.max(
        maxStep,
        Math.hypot(g.player.x - before.x, g.player.z - before.z),
      );
      block ||= g.player.recoil > 0;
      roll ||= g.player.mode === "dodge";
      largestChain = Math.max(largestChain, g.player.combo);
      cameras.push(tour.cameraYaw);
      if (g.player.combo) chains.add(g.player.combo);
    }
    assert.equal(g.phase, "finished", location + ": " + tour.label);
    assert.deepEqual([...g.secrets], ["inscription", "echo"]);
    assert.equal(g.player.weapon, "relic");
    assert.ok(g.chestOpened);
    assert.ok(block && roll && largestChain >= 2);
    assert.ok(maxStep < 0.09, "no teleports");
    assert.ok(
      Math.max(...cameras) - Math.min(...cameras) > 0.8,
      "camera explores the scene",
    );
    falls.add(g.enemy.death);
    opponents.add(g.enemy.kind);
    g.start(DEMO_ENEMIES[location]);
    assert.equal(g.player.weapon, "sword");
    assert.equal(g.chestOpened, false);
    assert.equal(g.secrets.size, 0);
  }
  assert.equal(opponents.size, 3);
  assert.ok(
    [...falls].every((fall) => ["Front", "Back", "Side"].includes(fall)),
  );
  assert.deepEqual([...chains].sort(), [1, 2, 3]);
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
  advance(g, ATTACKS[0].cancel - 0.08 + 0.03);
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
