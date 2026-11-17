import { test } from "node:test";
import assert from "node:assert/strict";
import { Campaign } from "../src/campaign.ts";
import { CHESTS, POTIONS } from "../src/world-layout.ts";
const rest = { x: 0, z: 0, guard: false };
function tick(g, seconds, input = rest) {
  for (let i = 0; i < seconds * 120; i++) g.update(1 / 120, input);
}
function quiet(id = "forest") {
  const g = new Campaign();
  g.startScenario(id);
  for (const e of g.enemies.values()) {
    e.hp = 0;
    e.mode = "dead";
  }
  return g;
}

test("taking a hit cancels chest inspection immediately and leaves its loot available", () => {
  const g = new Campaign();
  g.startScenario("forest");
  const c = CHESTS[0];
  Object.assign(g.player, { x: c.x, y: c.y, z: c.z + 1.2 });
  g.interact();
  assert.equal(g.inspecting, c.id);
  const hp = g.player.hp;
  assert.ok(g.damagePlayer(12));
  assert.equal(g.inspecting, null);
  assert.equal(g.player.hp, hp - 12);
  assert.equal(g.player.mode, "hit");
  assert.ok(g.openedChests.has(c.id));
  assert.ok(!g.lootedChests.has(c.id));
  g.interact();
  assert.equal(g.inspecting, null); // The hit recovery must finish first.
});
test("a potion pickup does not heal, drinking heals once, full HP wastes no flask", () => {
  const g = quiet();
  g.phase = "playing";
  g.damagePlayer(60);
  tick(g, 0.6);
  const p = POTIONS[0];
  Object.assign(g.player, { x: p.x, y: p.y, z: p.z });
  g.interact();
  assert.equal(g.flasks, 1);
  assert.equal(g.player.hp, 40);
  tick(g, 6);
  assert.equal(g.player.hp, 40);
  assert.ok(g.heal());
  assert.equal(g.flasks, 0);
  tick(g, 1.4);
  assert.equal(g.player.hp, 85);
  assert.equal(g.healed, 1);
  tick(g, 10);
  assert.equal(g.player.hp, 85);
  g.player.hp = 100;
  g.flasks = 1;
  assert.equal(g.heal(), false);
  assert.equal(g.flasks, 1);
});
test("a hit interrupts a drink after the flask has been spent, with no delayed heal", () => {
  const g = quiet();
  g.phase = "playing";
  g.damagePlayer(40);
  tick(g, 0.6);
  g.flasks = 1;
  assert.ok(g.heal());
  tick(g, 0.4);
  g.damagePlayer(10);
  const hp = g.player.hp;
  tick(g, 3);
  assert.equal(g.player.hp, hp);
  assert.equal(g.flasks, 0);
  assert.equal(g.healed, 0);
  assert.equal(g.interruptedHeals, 1);
});
test("the armour found in the vestry visibly equips a real damage-reducing slot", () => {
  const bare = quiet("chapel"),
    armoured = quiet("chapel");
  const c = CHESTS[2];
  Object.assign(armoured.player, { x: c.x, y: c.y, z: c.z + 1.2 });
  armoured.interact();
  tick(armoured, 0.8);
  armoured.interact();
  assert.equal(armoured.player.armour, 1);
  bare.phase = armoured.phase = "playing";
  bare.damagePlayer(30);
  armoured.damagePlayer(30);
  assert.equal(bare.player.hp, 70);
  assert.equal(armoured.player.hp, 78);
});
test("the vestry has no back-stair or outside-wall bypass while its door is locked", () => {
  const back = quiet("chapel");
  Object.assign(back.player, { x: 5, y: 2.4, z: -74.5 });
  tick(back, 5, { ...rest, z: 1 });
  assert.ok(back.player.z <= -68);
  assert.equal(back.player.y, 2.4);
  assert.equal(back.openDoors.size, 0);
  const side = quiet("chapel");
  Object.assign(side.player, { x: 7, y: 2.4, z: -64.5 });
  tick(side, 3, { ...rest, x: -1 });
  assert.ok(side.player.x >= 6.54);
  assert.equal(side.player.y, 2.4);
});
test("the black gate blocks both flanks and only its own key opens the passage", () => {
  for (const x of [-6.9, 6.9]) {
    const g = quiet();
    Object.assign(g.player, { x, y: 0, z: -12.5 });
    tick(g, 2, { ...rest, z: -1 });
    assert.ok(g.player.z > -13.25);
  }
  const g = quiet();
  Object.assign(g.player, { x: 0, y: 0, z: -12.6 });
  g.keys.add("gallery");
  g.interact();
  assert.equal(g.openDoors.size, 0);
  g.keys.add("gate");
  g.interact();
  assert.ok(g.openDoors.has("gate"));
  assert.ok(g.keys.has("gallery"));
  assert.ok(!g.keys.has("gate"));
  tick(g, 2, { ...rest, z: -1 });
  assert.ok(g.player.z < -14.5);
});

test("court columns block movement instead of letting the player walk through stone", () => {
  const g = quiet("roofs");
  Object.assign(g.player, { x: 6.6, y: 2.4, z: -22 });
  tick(g, 3, { ...rest, z: -1 });
  assert.ok(g.player.z > -23.4);
});
test("crypt furnishings block their occupied bays while the inner aisle remains traversable", () => {
  const blocked = quiet("crypt"),
    aisle = quiet("crypt");
  Object.assign(blocked.player, { x: -5, y: 2.4, z: -78.5 });
  tick(blocked, 4, { ...rest, z: -1 });
  assert.ok(blocked.player.z > -79.2);
  Object.assign(aisle.player, { x: -4.3, y: 2.4, z: -78.5 });
  tick(aisle, 4, { ...rest, z: -1 });
  assert.ok(aisle.player.z < -87);
});
