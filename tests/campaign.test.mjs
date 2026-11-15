import { test } from "node:test";
import assert from "node:assert/strict";
import { Campaign, SCENARIOS } from "../src/campaign.ts";
import { CampaignShowcase } from "../src/journey.ts";
import { CHESTS, DOORS, floorHeight } from "../src/world-layout.ts";
import { WEAPONS } from "../src/weapon-spec.ts";
const still = { x: 0, z: 0, guard: false };
const advance = (g, s) => {
  for (let i = 0; i < Math.ceil(s * 120); i++) g.update(1 / 120, still);
};

test("a chest really replaces the held weapon and leaves the previous one on the ground", () => {
  const g = new Campaign();
  g.startScenario("forest");
  const c = CHESTS[0];
  Object.assign(g.player, { x: c.x, z: c.z + 1.2, y: 0 });
  g.interact();
  assert.equal(g.player.weapon, "sword");
  assert.ok(g.openedChests.has(c.id));
  g.interact();
  assert.equal(g.player.weapon, "sword");
  advance(g, 0.8);
  g.interact();
  assert.equal(g.player.weapon, "axe");
  assert.ok(g.lootedChests.has(c.id));
  assert.equal(
    g.drops.filter((d) => d.active && d.weapon === "sword").length,
    1,
  );
  const count = g.drops.filter((d) => d.active).length;
  g.interact();
  assert.equal(g.drops.filter((d) => d.active).length, count);
});
test("there is one held item and a bounded drop pool, without a backpack", () => {
  const g = new Campaign();
  g.startScenario("roofs");
  for (let i = 0; i < 40; i++) {
    g.player.weapon = i % 2 ? "axe" : "spear";
    assert.ok(g.dropWeapon());
    assert.equal(g.player.weapon, "unarmed");
  }
  assert.equal(g.drops.length, 12);
  assert.equal(g.drops.filter((d) => d.active).length, 12);
  assert.equal(g.dropWeapon(), false);
  g.player.weapon = "axe";
  g.attack();
  assert.equal(g.dropWeapon(), false);
});
test("keys unlock only their door and never from another floor", () => {
  const g = new Campaign();
  g.startScenario("chapel");
  const d = DOORS[1];
  Object.assign(g.player, { x: d.x, z: d.z + 1.5, y: d.y });
  g.interact();
  assert.equal(g.openDoors.size, 0);
  g.keys.add("gate");
  g.interact();
  assert.equal(g.openDoors.size, 0);
  g.keys.add("gallery");
  g.player.y = 2.4;
  g.interact();
  assert.equal(g.openDoors.size, 0);
  g.player.y = 5.2;
  g.interact();
  assert.ok(g.openDoors.has("gallery"));
  assert.ok(!g.keys.has("gallery"));
  assert.ok(g.keys.has("gate"));
});
test("the three physical weapons have different damage, reach and stamina cost", () => {
  assert.ok(WEAPONS.axe.damage > WEAPONS.sword.damage);
  assert.ok(WEAPONS.spear.reach > WEAPONS.sword.reach);
  assert.ok(WEAPONS.axe.tempo < WEAPONS.sword.tempo);
  const costs = [];
  for (const weapon of ["sword", "axe", "spear"]) {
    const g = new Campaign();
    g.startScenario("forest");
    g.player.weapon = weapon;
    g.attack();
    costs.push(100 - g.player.stamina);
  }
  assert.equal(new Set(costs).size, 3);
});
for (const scenario of Object.keys(SCENARIOS))
  test(`actual input route: ${scenario}`, () => {
    const g = new Campaign();
    g.startScenario(scenario);
    const driver = new CampaignShowcase(g, scenario);
    let frames = 0,
      maxY = g.player.y,
      maxStep = 0,
      hurts = 0,
      prev = { x: g.player.x, z: g.player.z },
      previousHP = 100;
    const weapons = new Set(),
      areas = new Set();
    while (!driver.done && frames++ < 120 * 160) {
      const input = driver.update(1 / 120);
      g.update(1 / 120, input);
      maxStep = Math.max(
        maxStep,
        Math.hypot(g.player.x - prev.x, g.player.z - prev.z),
      );
      prev = { x: g.player.x, z: g.player.z };
      assert.ok(g.player.hp <= previousHP);
      previousHP = g.player.hp;
      assert.ok(
        Math.abs(g.player.y - floorHeight(g.player.x, g.player.z)) < 1e-6,
      );
      maxY = Math.max(maxY, g.player.y);
      weapons.add(g.player.weapon);
      areas.add(g.location);
      hurts += g.events.filter((e) => e.type === "hurt").length;
      g.events.length = 0;
    }
    assert.ok(driver.done, `${scenario} stalled at ${driver.label}`);
    assert.ok(maxStep < 0.08, `teleport ${maxStep}`);
    if (scenario === "defeat") {
      assert.equal(g.phase, "lost");
      assert.equal(g.player.hp, 0);
      assert.equal(g.enemy.hp, g.enemy.maxHp);
      assert.equal(hurts, 4);
    } else {
      assert.equal(g.phase, "finished");
      assert.ok(g.player.hp > 0);
    }
    if (scenario === "journey") {
      assert.equal(areas.size, 4);
      assert.equal(g.completedAreas.size, 4);
      assert.equal(g.lootedChests.size, 3);
      assert.equal(g.coins, 19);
      assert.equal(g.openDoors.size, 2);
      assert.ok(maxY >= 5.2);
      assert.deepEqual([...weapons].sort(), [
        "axe",
        "spear",
        "sword",
        "unarmed",
      ]);
      assert.ok(frames / 120 > 90 && frames / 120 < 150);
    }
    if (scenario === "chapel") assert.ok(maxY >= 5.2);
  });

test("mimic remains a harmless closed chest until interacted with, then delivers real damage", () => {
  const g = new Campaign();
  g.startScenario("crypt");
  Object.assign(g.player, { x: -2, z: -83.6, y: 2.4 });
  advance(g, 3);
  assert.equal(g.player.hp, 100);
  assert.ok(g.enemyDormant);
  assert.equal(g.mimicAwake, false);
  g.interact();
  assert.ok(g.mimicAwake);
  assert.equal(g.enemyDormant, false);
  advance(g, 5);
  assert.ok(g.player.hp < 100);
  assert.equal(g.enemy.hp, g.enemy.maxHp);
});
