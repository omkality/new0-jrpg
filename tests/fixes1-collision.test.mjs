import test from "node:test";
import assert from "node:assert/strict";
import { Campaign } from "../src/campaign.ts";
import { floorHeight } from "../src/world-layout.ts";
import { CampaignShowcase } from "../src/journey.ts";
import { motionName, sourceAttackTime } from "../src/motion-policy.ts";
import { ATTACKS, dodgeTravelAt } from "../src/game.ts";
import { bodyPenetration } from "../src/body-collision.ts";

test("side corpse collision follows the actual leftward skinned fall", () => {
  const g = new Campaign();
  const corpse = {
    ...g.enemy,
    kind: "watcher",
    x: 0,
    z: 0,
    y: 0,
    yaw: 0,
    hp: 0,
    time: 3,
    death: "Side",
  };
  assert(bodyPenetration(g.player, -0.7, 0, corpse) > 0);
  assert(bodyPenetration(g.player, 0.95, 0, corpse) <= 0);
});

function quietCrypt() {
  const game = new Campaign();
  game.startScenario("crypt");
  for (const e of game.enemies.values()) {
    e.hp = 0;
    e.mode = "dead";
    e.time = 3;
  }
  game.phase = "won";
  game.player.hp = 100;
  return game;
}
function walk(game, x, z, seconds) {
  for (let i = 0; i < seconds * 120; i++)
    game.update(1 / 120, { x, z, guard: false });
}
test("the dead mimic remains a solid chest and the player can go around it", () => {
  const g = quietCrypt(),
    m = g.enemies.get("crypt");
  g.player.x = m.x;
  g.player.z = m.z + 2.5;
  g.player.y = m.y;
  walk(g, 0, -1, 1.3);
  assert(
    g.player.z > m.z + 0.8,
    "player walked inside or through the dead mimic",
  );
  walk(g, 1, 0, 1);
  walk(g, 0, -1, 1.4);
  assert(
    g.player.z < m.z - 1,
    "corpse blocks the route even after walking around it",
  );
});
test("crypt portal wings block a body while the central arch stays traversable", () => {
  const g = quietCrypt();
  g.player.x = -4;
  g.player.z = -76.8;
  g.player.y = floorHeight(-4, -76.8);
  walk(g, 0, -1, 1.4);
  assert(g.player.z > -77.1, "player walked through the visible entrance wall");
  g.player.x = 0;
  g.player.z = -76.8;
  walk(g, 0, -1, 1.5);
  assert(g.player.z < -79, "central doorway was incorrectly blocked");
});
test("living actors keep body separation during a dodge instead of overlapping", () => {
  const g = new Campaign();
  g.startScenario("roofs");
  const e = g.enemies.get("roofs");
  for (const other of g.enemies.values())
    if (other !== e) {
      other.hp = 0;
      other.x = 6;
      other.z = 11;
    }
  e.x = 0;
  e.z = -30;
  e.mode = "recover";
  e.time = -10;
  g.player.x = 0;
  g.player.z = -28.3;
  g.player.y = 2.4;
  g.dodge({ x: 0, z: -1 });
  let closest = Infinity;
  for (let i = 0; i < 120; i++) {
    g.update(1 / 120, { x: 0, z: 0, guard: false });
    closest = Math.min(closest, Math.hypot(g.player.x - e.x, g.player.z - e.z));
  }
  assert(closest >= 0.78, `living bodies overlapped: ${closest}`);
});

test("a watcher evades a telegraphed strike with continuous physical travel", () => {
  const g = new Campaign();
  g.startScenario("roofs");
  const e = g.enemies.get("roofs");
  for (const o of g.enemies.values())
    if (o !== e) {
      o.hp = 0;
      o.x = 6;
      o.z = 10;
    }
  Object.assign(g.player, {
    x: 0,
    z: -28,
    y: 2.4,
    yaw: Math.PI,
    mode: "attack",
    combo: 1,
    time: 0.14,
  });
  Object.assign(e, { x: 0, z: -29.8, y: 2.4, yaw: 0, mode: "idle", time: 0 });
  g.elapsed = 5;
  g.update(1 / 120, { x: 0, z: 0, guard: false });
  assert.equal(e.mode, "dodge");
  const start = { x: e.x, z: e.z };
  let maxStep = 0;
  for (let i = 0; i < 100; i++) {
    const x = e.x,
      z = e.z;
    g.update(1 / 120, { x: 0, z: 0, guard: false });
    maxStep = Math.max(maxStep, Math.hypot(x - e.x, z - e.z));
  }
  assert(
    Math.abs(
      Math.hypot(e.x - start.x, e.z - start.z) - dodgeTravelAt(e, 0.82),
    ) < 0.02,
  );
  assert(maxStep < 0.045);
  assert.equal(e.hp, e.maxHp);
});

test("weapon policy selects available enemy clips and preserves retimed contacts", () => {
  const g = new Campaign();
  g.startScenario("chapel");
  const heavy = g.enemies.get("chapel");
  Object.assign(heavy, { mode: "attack", combo: 2, weapon: "sword" });
  assert.equal(
    motionName(heavy),
    "Attack2",
    "monster must not fall back to Idle because of a sword-only clip",
  );
  g.player.weapon = "spear";
  g.player.mode = "dodge";
  g.player.dodgeSide = "Back";
  assert.equal(motionName(g.player), "EvadeBack");
  g.player.weapon = "unarmed";
  g.player.armour = 1;
  assert.equal(motionName(g.player), "EvadeBack");
  g.player.armour = 0;
  assert.equal(motionName(g.player), "EvadeBack");
  const contacts = [0.3, 0.27, 0.42];
  for (let i = 0; i < 3; i++) {
    assert(
      Math.abs(
        sourceAttackTime(`Attack${i + 1}`, ATTACKS[i].contact, i) - contacts[i],
      ) < 1e-8,
    );
    assert.equal(
      sourceAttackTime(`SwordAttack${i + 1}`, ATTACKS[i].contact, i),
      ATTACKS[i].contact,
    );
  }
});

test("the entire ordinary-input journey also completes when physics is updated at 60 Hz", () => {
  const g = new Campaign();
  g.startScenario("journey");
  const driver = new CampaignShowcase(g, "journey");
  let maxStep = 0;
  for (let i = 0; i < 60 * 300 && !driver.done; i++) {
    const x = g.player.x,
      z = g.player.z;
    g.update(1 / 60, driver.update(1 / 60));
    maxStep = Math.max(maxStep, Math.hypot(x - g.player.x, z - g.player.z));
    g.events.length = 0;
  }
  assert(driver.done, driver.label);
  assert.equal(g.phase, "finished");
  assert(maxStep < 0.15);
  assert.equal(g.lootedChests.size, 3);
  assert.equal(g.openDoors.size, 2);
});
