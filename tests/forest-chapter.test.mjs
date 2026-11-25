import { test } from "node:test";
import { Matrix4, Vector3, PerspectiveCamera } from "three";
import { Duel } from "../src/chapter/duel.ts";
import { ATTACKS } from "../src/game.ts";
import { motionName } from "../src/motion-policy.ts";
import { Blood } from "../src/chapter/blood.ts";
import {
  CAIRN,
  VOTIVE,
  COFFER,
  REAR_PORTAL,
  MIRROR,
  TABLETS,
} from "../src/chapter/bell-quest.ts";
import assert from "node:assert/strict";
import {
  beginEncounter,
  SCOUT,
  KEEPER,
  MIMIC,
  force,
  weaponStats,
  takeTurn,
  unavailable,
} from "../src/chapter/encounter.ts";
import { ForestChapter } from "../src/chapter/forest.ts";
import { cameraClearance } from "../src/camera-clearance.ts";
import { CHOIR_PORTAL, RELIQUARY } from "../src/chapter/bell-quest.ts";
import motion from "../public/assets/motion/contract.json" with { type: "json" };

test("the choir grille closes the whole passage and a reliquary cannot be opened from below", () => {
  for (const x of [-1.63, 0, 1.63]) {
    const g = new ForestChapter(59);
    Object.assign(g.player, {
      x,
      y: CHOIR_PORTAL.base,
      z: CHOIR_PORTAL.z + 0.9,
    });
    for (let i = 0; i < 110; i++)
      g.update(1 / 60, { x: 0, z: -1, guard: false });
    assert.ok(g.player.z > CHOIR_PORTAL.z, "Slipped through the closed grille");
  }
  const g = new ForestChapter(59);
  g.quest = "vestry";
  g.openDoors.add("gallery");
  Object.assign(g.player, { x: RELIQUARY.x, z: RELIQUARY.z + 1.1, y: 2.4 });
  assert.doesNotMatch(g.nearby, /ларец/);
});
test("the mortuary gate bars the passage before the bell and the mirror cannot be used from its far side", () => {
  const g = new ForestChapter(59);
  Object.assign(g.player, { x: 0, y: 2.4, z: REAR_PORTAL.z + 1 });
  for (let i = 0; i < 140; i++) g.update(1 / 60, { x: 0, z: -1, guard: false });
  assert.ok(g.player.z > REAR_PORTAL.z);
  g.quest = "ossuary";
  Object.assign(g.player, { x: MIRROR.x, y: 2.4, z: MIRROR.z - 0.76 });
  assert.doesNotMatch(g.nearby, /зеркало/);
});
test("blood stays bounded on overlapping hits and a quiet frame does not upload a buffer", () => {
  const blood = new Blood();
  const wound = { dx: 0.6, dz: -0.8, y: 3.5, ground: 2.4, kind: "thrust" };
  for (let i = 0; i < 12; i++) blood.strike(2, -38, wound);
  blood.update(0.12);
  assert.equal(blood.mesh.count, blood.mesh.instanceMatrix.count);
  for (const value of blood.mesh.instanceMatrix.array)
    assert.ok(Number.isFinite(value));
  blood.update(1.2);
  assert.equal(blood.mesh.visible, false);
  assert.equal(blood.mesh.count, 0);
  const version = blood.mesh.instanceMatrix.version;
  blood.update(1 / 60);
  assert.equal(blood.mesh.instanceMatrix.version, version);
  blood.strike(2, -38, { ...wound, kind: "cut" });
  blood.update(1 / 60);
  assert.ok(blood.mesh.count >= 6 && blood.mesh.count <= 9);
  blood.update(0.36);
  assert.equal(blood.mesh.visible, false);
});
test("spear droplets leave the entry side of the armour through their visible flight", () => {
  const blood = new Blood();
  const dx = 0.72,
    dz = -Math.sqrt(1 - dx * dx);
  blood.strike(1, -38, { dx, dz, ground: 2.4, y: 3.75, kind: "thrust" });
  const matrix = new Matrix4(),
    p = new Vector3();
  for (const dt of [1 / 60, 0.1]) {
    blood.update(dt);
    assert.ok(blood.mesh.count >= 6 && blood.mesh.count <= 9);
    for (let i = 0; i < blood.mesh.count; i++) {
      blood.mesh.getMatrixAt(i, matrix);
      p.setFromMatrixPosition(matrix);
      assert.ok((p.x - 1) * dx + (p.z + 38) * dz < -0.3);
    }
  }
});
test("enemy criticals break past the pilgrim's visible flank in both duel cameras", () => {
  const g = new ForestChapter(59);
  for (const [enemy, kind, weapon] of [
    [g.scout, "rake", "sword"],
    [g.keeper, "hew", "spear"],
  ]) {
    g.player.weapon = weapon;
    const stage = new Duel(g.player, enemy);
    const { hero, foe } = stage.sample(g.player, enemy);
    const direction = new Vector3(
      hero.x - foe.x,
      0,
      hero.z - foe.z,
    ).normalize();
    const eye = new Vector3(
      stage.eye.x - hero.x,
      0,
      stage.eye.z - hero.z,
    ).normalize();
    const blood = new Blood();
    blood.strike(hero.x, hero.z, {
      dx: direction.x,
      dz: direction.z,
      ground: hero.y,
      y: hero.y + 1.14,
      kind,
    });
    blood.update(0.08);
    const matrix = new Matrix4(),
      point = new Vector3();
    for (let i = 0; i < blood.mesh.count; i++) {
      blood.mesh.getMatrixAt(i, matrix);
      point.setFromMatrixPosition(matrix);
      assert.ok((point.x - hero.x) * eye.x + (point.z - hero.z) * eye.z > 0.09);
    }
  }
});
test("both speaker portraits have a clear view across the forest and the bridge piers", () => {
  const g = new ForestChapter(59);
  for (const actor of [g.scout, g.keeper]) {
    const face = { x: actor.x - 0.1, y: actor.y + 1.43, z: actor.z - 0.1 };
    const eye = { x: actor.x - 1.16, y: actor.y + 1.72, z: actor.z + 1.72 };
    assert.equal(cameraClearance(face, eye, g.obstacles, g.openDoors), 1);
  }
});
const initial = { hp: 100, maxHp: 100, flasks: 0 };
const rest = { x: 0, z: 0, guard: false };
const play = (b, command) => takeTurn(SCOUT, b, command, b.attempt, b.turn);
function walk(g, x, z) {
  for (let i = 0; i < 900; i++) {
    const dx = x - g.player.x,
      dz = z - g.player.z,
      size = Math.hypot(dx, dz);
    if (size < 0.12 || g.screen === "ending") return;
    g.update(1 / 60, { x: dx / size, z: dz / size, guard: false });
  }
  assert.fail(
    "Path blocked at " + JSON.stringify([g.player.x, g.player.z, x, z]),
  );
}
function settle(g) {
  for (let i = 0; i < 245; i++) g.update(1 / 60, rest);
}
function choose(g, cmd) {
  g.choose(cmd, g.battle.attempt, g.battle.turn);
  settle(g);
}
function meet(g) {
  walk(g, 1.5, 4.35);
  assert.equal(g.nearby, "Заговорить");
  g.interact();
  g.advance();
}
test("both fighters stay in the portrait frame, with the camera behind the pilgrim and clear of stone", () => {
  const g = new ForestChapter(59);
  for (const foe of [g.scout, g.keeper])
    for (const weapon of ["sword", "spear"]) {
      g.player.weapon = weapon;
      const view = new Duel(g.player, foe).sample(g.player, foe),
        { hero, target, eye } = view;
      const norm = (p) => new Vector3(p.x, p.y, p.z);
      const backward = norm(hero).sub(norm(view.foe)).setY(0).normalize();
      const sight = norm(eye).sub(norm(target)).setY(0).normalize();
      assert.ok(
        sight.dot(backward) > 0.6,
        "camera is beside or in front of the hero",
      );
      for (const actor of [hero, view.foe]) {
        const head = { x: actor.x, y: actor.y + 1.5, z: actor.z };
        assert.equal(cameraClearance(head, eye, g.obstacles, g.openDoors), 1);
      }
      for (const aspect of [320 / 306, 388 / 435, 430 / 647]) {
        const c = new PerspectiveCamera(57, aspect, 0.08, 165);
        c.position.copy(norm(eye));
        c.lookAt(norm(target));
        c.updateMatrixWorld();
        const project = (actor, h) =>
          new Vector3(actor.x, actor.y + h, actor.z).project(c);
        view.sample(g.player, foe);
        const a = project(hero, 1.4),
          b = project(view.foe, 1.4);
        assert.ok(a.x + 0.33 < b.x, "heads overlap in screen space");
        for (const actor of [hero, view.foe])
          for (const h of [0, 1.82]) {
            const p = project(actor, h);
            assert.ok(
              Math.abs(p.x) < 0.89 && Math.abs(p.y) < 0.88,
              "head or feet outside picture",
            );
          }
        // Follow the visible actors through every strike, including the approach
        // and recovery of both spear jabs and of the longer, charged lunge.
        const distances = [];
        for (const combo of [1, 2, 3]) {
          const motion = ATTACKS[combo - 1];
          for (const attacking of ["hero", "foe"]) {
            for (let frame = 0; frame <= 60; frame++) {
              const mode = {
                mode: "attack",
                combo,
                time: (frame / 60) * motion.duration,
              };
              view.sample(
                attacking === "hero" ? { ...g.player, ...mode } : g.player,
                attacking === "foe" ? { ...foe, ...mode } : foe,
              );
              const left = project(view.hero, 1.45);
              const right = project(view.foe, 1.45);
              assert.ok(right.x - left.x > 0.2, "faces merge during an attack");
              for (const f of [view.hero, view.foe]) {
                assert.ok(Math.abs(project(f, 1.82).y) < 0.9);
                assert.ok(Math.abs(project(f, 0).y) < 0.9);
              }
            }
          }
          view.sample(
            { ...g.player, mode: "attack", combo, time: motion.contact },
            foe,
          );
          distances.push(
            Math.hypot(view.hero.x - view.foe.x, view.hero.z - view.foe.z),
          );
        }
        if (weapon === "spear") {
          assert.ok(
            distances[0] - distances[2] > 0.2,
            "a lunge must advance farther than a jab",
          );
          assert.equal(distances[0], distances[1]);
        }
      }
    }
});
test("a promise leaves the singer alive, the optional grave equips a spear once and a fourth light can be kept", () => {
  const g = new ForestChapter(59);
  walk(g, 1.5, 4.35);
  g.interact();
  g.select("name");
  assert.equal(g.screen, "cantorName");
  g.select("promise");
  assert.equal(g.scout.hp, SCOUT.hp);
  assert.equal(g.battle, undefined);
  g.advance();
  g.interact();
  assert.equal(g.screen, "remembrance");
  g.select("promise");
  g.advance();
  assert.equal(g.coins, 5);
  g.quest = "keeper";
  Object.assign(g.player, { x: CAIRN.x, y: CAIRN.y, z: CAIRN.z + 1.8 });
  g.interact();
  assert.equal(g.screen, "cairn");
  const ignorant = new ForestChapter(59);
  ignorant.quest = "keeper";
  Object.assign(ignorant.player, g.player);
  ignorant.interact();
  ignorant.select("speak");
  assert.equal(ignorant.screen, "cairn");
  assert.equal(ignorant.player.weapon, "sword");
  g.select("speak");
  g.advance();
  g.interact();
  assert.equal(g.screen, "cache");
  g.select("take");
  g.select("take");
  assert.equal(g.player.weapon, "spear");
  Object.assign(g.player, { x: 1, y: g.keeper.y, z: g.keeper.z + 1.4 });
  g.interact();
  g.select("fight");
  g.advance();
  const b = g.battle;
  g.choose("attack", b.attempt, b.turn);
  assert.equal(motionName(g.duel.hero), "SpearAttack1");
  assert.equal(g.shownTurn.enemyHp, KEEPER.hp);
  for (let i = 0; i < 20; i++) g.update(1 / 60, rest);
  assert.equal(g.shownTurn.enemyHp, KEEPER.hp - 20);
  const contact = g.events.filter((e) => e.type === "hit");
  assert.equal(contact.length, 1);
  assert.equal(contact[0].wound, undefined);
  assert.equal(contact[0].x, g.duel.foe.x);
  assert.equal(g.duel.foe.mode, "hit");
  settle(g);
  choose(g, "attack");
  g.choose("skill", b.attempt, g.battle.turn);
  assert.equal(g.result.interrupted, true);
  assert.equal(motionName(g.duel.hero), "SpearAttack3");
  settle(g);
  choose(g, "attack");
  g.advance();
  Object.assign(g.player, { x: VOTIVE.x, y: VOTIVE.y, z: VOTIVE.z + 1.05 });
  g.interact();
  assert.equal(g.screen, "votive");
  g.select("shelter");
  g.select("shelter");
  assert.equal(g.sheltered, true);
});
test("a seeded duel resolves critical damage once and wounds only at eligible contacts", () => {
  const g = new ForestChapter(90);
  meet(g);
  const strike = (cmd) => {
    g.events.length = 0;
    const before = g.battle;
    g.choose(cmd, before.attempt, before.turn);
    g.choose(cmd, before.attempt, before.turn);
    assert.equal(g.events.length, 0);
    settle(g);
    return g.events.filter((e) => e.type === "hit" || e.type === "hurt");
  };
  assert.equal(strike("attack")[0].wound, undefined);
  assert.deepEqual(g.result.strike, {
    damage: 14,
    critical: false,
    lethal: false,
  });
  const crit = strike("attack");
  assert.deepEqual(g.result.strike, {
    damage: 21,
    critical: true,
    lethal: false,
  });
  assert.deepEqual(
    crit.map((e) => [e.type, e.wound?.kind]),
    [
      ["hit", "cut"],
      ["hurt", undefined],
    ],
  );
  assert.equal(g.battle.enemyHp, 47);
  assert.equal(strike("skill")[0].wound, undefined);
  const finisher = strike("attack");
  assert.deepEqual(g.result.strike, {
    damage: 7,
    critical: false,
    lethal: true,
  });
  assert.deepEqual(
    finisher.map((e) => [e.type, e.wound?.kind]),
    [["hit", "cut"]],
  );
  assert.equal(g.screen, "victory");
});

test("the grave and the keeper's hand each supply one recoverable weapon, including after the mimic", () => {
  const g = new ForestChapter(59);
  const approach = (p, dz = 1.15) =>
    Object.assign(g.player, { x: p.x, y: p.y, z: p.z + dz });
  g.quest = "keeper";
  g.learnedName = true;
  approach(CAIRN, 1.8);
  g.interact();
  g.select("speak");
  assert.equal(g.offered, "spear");
  g.advance();
  assert.equal(g.equipped, "sword");
  g.interact();
  g.select("take");
  assert.equal(g.drops[0].weapon, "sword");
  approach(g.keeper, 1.5);
  g.interact();
  g.select("fight");
  g.advance();
  for (const cmd of ["attack", "attack", "skill", "attack"]) {
    if (g.screen === "choice") choose(g, cmd);
  }
  assert.equal(g.screen, "victory");
  g.advance();
  assert.equal(g.keeper.weapon, "unarmed");
  const loot = g.drops[1];
  const position = [loot.x, loot.y, loot.z];
  const compare = (ground, hand) => {
    approach(loot, 0.4);
    g.interact();
    assert.deepEqual(
      [g.screen, g.offered, g.equipped],
      ["weapon", ground, hand],
    );
  };
  compare("axe", "spear");
  g.advance();
  compare("axe", "spear");
  g.select("swap");
  g.select("swap");
  approach(VOTIVE);
  g.interact();
  g.select("takeRegen");
  g.select("takeRegen");
  assert.equal(g.regenFlasks, 1);
  g.advance();
  approach(COFFER, 1.65);
  g.interact();
  g.advance();
  assert.equal(g.mimicAwake, false);
  g.interact();
  g.select("uncatch");
  assert.equal(g.screen, "reveal");
  settle(g);
  g.advance();
  assert.equal(g.battle.weapon, "axe");
  g.openPotions();
  g.advance();
  assert.equal(g.battle.regenFlasks, 1);
  g.openPotions();
  g.select("drinkRegen");
  g.select("drinkRegen");
  settle(g);
  for (const cmd of ["attack", "attack", "skill", "attack"]) {
    if (g.screen === "choice") choose(g, cmd);
  }
  assert.equal(g.screen, "victory");
  const coins = g.coins;
  g.advance();
  g.advance();
  assert.equal(g.coins, coins + MIMIC.reward);
  assert.equal(g.regenFlasks, 0);
  assert.equal(g.mimic.hp, 0);
  assert.equal(g.quest, "vestry");
  approach(COFFER, 1.65);
  for (let i = 0; i < 90; i++) g.update(1 / 60, { x: 0, z: -1, guard: false });
  assert.ok(g.player.z > COFFER.z + 0.6);
  compare("spear", "axe");
  g.select("swap");
  assert.deepEqual([loot.weapon, g.equipped], ["axe", "spear"]);
  assert.deepEqual([loot.x, loot.y, loot.z], position);
  approach(g.drops[0], 0.35);
  g.interact();
  assert.equal(g.offered, "sword");
  g.select("swap");
  assert.deepEqual([g.equipped, ...g.drops.map((d) => d.weapon)].sort(), [
    "axe",
    "spear",
    "sword",
  ]);
});

test("pickup numbers follow the ordinary hit and charged technique against every target", () => {
  for (const [weapon, critical] of [
    ["sword", 16],
    ["spear", 12],
    ["axe", 20],
  ]) {
    const stats = weaponStats(weapon);
    assert.equal(stats.critical, critical);
    for (const [cmd, text] of [
      ["attack", stats.damage],
      ["skill", stats.skill],
    ]) {
      const amounts = [SCOUT, KEEPER, MIMIC].map((foe) =>
        force(foe, weapon, cmd),
      );
      assert.deepEqual(text.split("–").map(Number), [
        Math.min(...amounts),
        Math.max(...amounts),
      ]);
    }
  }
});

test("a regeneration draught heals on three committed turns, caps at full health and ends with the encounter", () => {
  const start = beginEncounter(
    MIMIC,
    { hp: 97, maxHp: 100, flasks: 0, regenFlasks: 2 },
    1,
    "sword",
    59,
  );
  const drink = takeTurn(MIMIC, start, "regen", 1, 1);
  assert.deepEqual(
    [
      drink.regenerated,
      drink.action.hp,
      drink.next.regenFlasks,
      drink.next.regenTurns,
    ],
    [3, 100, 1, 2],
  );
  assert.equal(start.regenTurns, 0);
  assert.equal(takeTurn(MIMIC, drink.next, "regen", 1, 2), undefined);
  assert.equal(takeTurn(MIMIC, drink.next, "attack", 1, 1), undefined);
  const second = takeTurn(MIMIC, drink.next, "attack", 1, 2);
  const third = takeTurn(MIMIC, second.next, "attack", 1, 3);
  assert.equal(second.regenerated, Math.min(12, 100 - drink.next.hp));
  assert.equal(third.regenerated, Math.min(12, 100 - second.next.hp));
  assert.deepEqual([second.next.regenTurns, third.next.regenTurns], [1, 0]);
  assert.equal(takeTurn(MIMIC, third.next, "skill", 1, 4).regenerated, 0);
  assert.equal(beginEncounter(KEEPER, drink.next, 2, "axe", 59).regenTurns, 0);
});

test("a critical reply wounds the hero; a critical finisher emits just one wound and cancels the reply", () => {
  for (const weapon of ["sword", "spear"]) {
    for (const finish of [false, true]) {
      const g = new ForestChapter(3600);
      g.player.weapon = weapon;
      meet(g);
      if (finish) g.battle.enemyHp = 1;
      choose(g, "attack");
      const wounds = g.events.filter((e) => e.wound);
      assert.equal(wounds.length, finish ? 1 : 2);
      assert.equal(wounds[0].wound.kind, weapon === "sword" ? "cut" : "thrust");
      assert.ok(g.result.strike.critical);
      if (finish) {
        assert.equal(g.result.strike.lethal, true);
        assert.equal(g.result.action.chanceState, g.result.next.chanceState);
      } else {
        assert.deepEqual(
          [g.result.reply.critical, g.result.reply.damage, g.battle.hp],
          [true, 27, 73],
        );
        assert.equal(wounds[1].wound.kind, "rake");
        assert.ok(
          wounds[0].wound.dx * wounds[1].wound.dx +
            wounds[0].wound.dz * wounds[1].wound.dz <
            -0.99,
        );
      }
    }
  }
});

test("every weapon has its own rare critical rate; actual HP loss is capped on a killing blow", () => {
  for (const [foe, weapon, heroChance, foeChance] of [
    [SCOUT, "sword", 0.16, 0.08],
    [KEEPER, "spear", 0.12, 0.2],
    [MIMIC, "axe", 0.2, 0.1],
  ]) {
    let heroCrits = 0,
      foeCrits = 0;
    const samples = 65000;
    for (let i = 0; i < samples; i++) {
      const b = beginEncounter(
        foe,
        initial,
        1,
        weapon,
        Math.imul(i, 0x9e3779b1),
      );
      const hit = takeTurn(foe, b, "attack", 1, 1);
      assert.equal(hit.strike.damage, b.enemyHp - hit.action.enemyHp);
      assert.equal(hit.reply.damage, b.hp - hit.next.hp);
      heroCrits += Number(hit.strike.critical);
      foeCrits += Number(hit.reply.critical);
      if (hit.strike.critical && heroCrits === 1) {
        assert.deepEqual(takeTurn(foe, b, "attack", 1, 1), hit);
        const finish = takeTurn(foe, { ...b, enemyHp: 1 }, "attack", 1, 1);
        assert.deepEqual(finish.strike, {
          damage: 1,
          critical: true,
          lethal: true,
        });
        assert.equal(finish.reply, null);
      }
    }
    assert.ok(Math.abs(heroCrits / samples - heroChance) < 0.008);
    assert.ok(Math.abs(foeCrits / samples - foeChance) < 0.008);
  }
});

test("commands validate inventory, charge, attempt and turn without consuming anything", () => {
  const first = beginEncounter(SCOUT, initial, 4, "sword", 59);
  assert.equal(unavailable(first, "item"), "Нет зелий");
  assert.equal(unavailable({ ...first, flasks: 1 }, "item"), "Здоровье полное");
  assert.equal(unavailable(first, "skill"), "Ещё 2 атаки");
  assert.equal(play(first, "skill"), undefined);
  const r = play(first, "attack");
  assert.deepEqual(
    [r.action.hp, r.action.enemyHp, r.next.hp, r.next.charge],
    [100, 68, 82, 1],
  );
  assert.equal(takeTurn(SCOUT, r.next, "attack", 4, 1), undefined);
  assert.equal(takeTurn(SCOUT, r.next, "attack", 3, 2), undefined);
  assert.equal(first.enemyHp, 82);
});
test("healing is capped, charges are capped, and a lethal skill gets no reply", () => {
  let b = beginEncounter(SCOUT, { ...initial, flasks: 1 }, 1, "sword", 59);
  b = play(b, "attack").next;
  const heal = play(b, "item");
  assert.equal(heal.action.hp, 100);
  assert.equal(heal.strike, null);
  assert.equal(heal.action.chanceState, b.chanceState);
  assert.equal(heal.next.flasks, 0);
  assert.equal(heal.reply.damage, 32);
  b = play(play(heal.next, "attack").next, "attack").next;
  assert.equal(b.charge, 2);
  const finisher = play(b, "skill");
  assert.equal(finisher.reply, null);
  assert.equal(finisher.next.outcome, "won");
  assert.equal(finisher.next.charge, 0);
  assert.equal(play(finisher.next, "attack"), undefined);
});
test("the same turn resolver reads damage, health and intent from another encounter", () => {
  const other = {
    ...SCOUT,
    hp: 11,
    strike: 6,
    intents: [{ label: "Шорох", damage: 3 }],
  };
  const battle = beginEncounter(other, initial, 8, "sword", 59);
  const first = takeTurn(other, battle, "attack", 8, 1);
  assert.deepEqual(
    [first.next.hp, first.next.enemyHp, first.reply.label],
    [97, 5, "Шорох"],
  );
  const second = takeTurn(other, first.next, "attack", 8, 2);
  assert.equal(second.next.outcome, "won");
  assert.equal(second.reply, null);
});
test("a blocked line of sight never opens a conversation", () => {
  const g = new ForestChapter(59);
  walk(g, 1.5, 4.35);
  g.obstacles.push({ x: 1.75, z: 3.5, hx: 0.7, hz: 0.1 });
  assert.notEqual(g.nearby, "Заговорить");
  g.interact();
  assert.equal(g.screen, "trail");
});
test("a living scout keeps the gate shut even with its key; rewards persist through a real crossing", () => {
  const g = new ForestChapter(59);
  assert.deepEqual(
    new Set(g.enemies.keys()),
    new Set([SCOUT.actor, KEEPER.actor, MIMIC.actor]),
  );
  walk(g, -2.8, 2.32);
  assert.equal(g.nearby, "Взять ключ");
  g.interact();
  walk(g, 0, 2.5);
  walk(g, 0, -12.8);
  g.interact();
  assert.equal(g.openDoors.size, 0);
  for (let i = 0; i < 120; i++) g.update(1 / 60, { ...rest, z: -1 });
  assert.ok(g.player.z > -14);
  walk(g, 0, 2.9);
  meet(g);
  const start = [g.player.x, g.player.z];
  const first = g.battle;
  for (let i = 0; i < 600; i++) g.update(1 / 60, { ...rest, z: 1 });
  assert.deepEqual(g.battle, first);
  assert.deepEqual([g.player.x, g.player.z], start);
  g.choose("attack", first.attempt, first.turn);
  g.choose("attack", first.attempt, first.turn);
  assert.equal(g.battle.turn, 2);
  settle(g);
  choose(g, "attack");
  choose(g, "skill");
  choose(g, "attack");
  assert.equal(g.screen, "victory");
  assert.ok(g.scout.time >= motion.DeathBack);
  g.advance();
  g.advance();
  g.interact();
  assert.equal(g.coins, SCOUT.reward);
  assert.deepEqual([g.player.hp, g.player.x, g.player.z], [32, ...start]);
  walk(g, 0, -12.8);
  g.interact();
  assert.ok(g.openDoors.has("gate"));
  assert.ok(!g.keys.has("gate"));
  settle(g);
  walk(g, 0, -15.1);
  assert.equal(g.screen, "trail");
  walk(g, 0, -16.32);
  assert.equal(g.screen, "trail");
  assert.equal(g.quest, "bell");
});
test("potion is found on the trail and a lost attempt restores the pre-fight checkpoint once", () => {
  const g = new ForestChapter(59);
  walk(g, -5.95, 5.52);
  assert.equal(g.nearby, "Взять лечебное зелье");
  g.interact();
  g.interact();
  assert.equal(g.flasks, 1);
  walk(g, -2.4, 7.2);
  walk(g, 0, 7);
  meet(g);
  const attempt = g.battle.attempt;
  choose(g, "attack");
  assert.deepEqual(
    g.events
      .filter((e) => ["hit", "hurt"].includes(e.type))
      .map((e) => [e.type, e.wound]),
    [
      ["hit", undefined],
      ["hurt", undefined],
    ],
  );
  g.events.length = 0;
  choose(g, "item");
  assert.equal(
    g.events.filter((e) => e.type === "hit").length,
    0,
    "Drinking a potion must not strike the enemy",
  );
  assert.equal(g.battle.flasks, 0);
  while (g.screen === "choice") choose(g, "attack");
  assert.equal(g.screen, "defeat");
  assert.equal(g.coins, 0);
  g.advance();
  g.advance();
  assert.deepEqual(
    [g.battle.turn, g.battle.hp, g.battle.flasks, g.battle.enemyHp],
    [1, 100, 1, SCOUT.hp],
  );
  g.choose("attack", attempt, 1);
  assert.equal(g.screen, "choice");
});

for (const [pass, vow] of [
  ["pay", "one"],
  ["pay", "all"],
  ["fight", "one"],
  ["fight", "all"],
]) {
  test(
    "the full walking route with " +
      pass +
      " and " +
      vow +
      " reaches the memorial beyond the bell",
    () => {
      const g = new ForestChapter(59);
      const use = (pattern) => {
        assert.match(g.nearby, pattern);
        g.interact();
      };
      meet(g);
      for (const command of ["attack", "attack", "skill", "attack"])
        choose(g, command);
      g.advance();
      walk(g, -2.8, 2.32);
      use(/ключ/);
      walk(g, 0, 2.5);
      walk(g, 0, -12.8);
      use(/Чёрные ворота/);
      settle(g);
      walk(g, 0, -21.8);
      walk(g, -4.4, -25.8);
      use(/колокол/);
      assert.equal(g.screen, "inscription");
      g.advance();
      walk(g, 1, -38.3);
      use(/сторожа/);
      g.advance();
      assert.ok(!g.openDoors.has("choir"));
      use(/сторожа/);
      g.select(pass);
      if (pass === "fight") {
        g.advance();
        for (const command of ["attack", "attack", "attack"])
          choose(g, command);
        assert.equal(g.screen, "defeat");
        g.advance();
        g.advance();
        for (const command of ["attack", "attack"]) choose(g, command);
        assert.ok(g.events.some((e) => e.type === "hurt" && !e.wound));
        g.choose("skill", g.battle.attempt, g.battle.turn);
        assert.ok(g.result.interrupted);
        assert.equal(g.result.reply, null);
        settle(g);
        choose(g, "attack");
        g.advance();
      }
      assert.equal(g.guardianOutcome, pass === "pay" ? "paid" : "won");
      assert.equal(g.coins, pass === "pay" ? 0 : 8);
      settle(g);
      walk(g, 0, -44.9);
      walk(g, -3.33, -45.78);
      use(/ключ/);
      walk(g, 0, -46);
      walk(g, 5, -46);
      walk(g, 5, -58.95);
      use(/Открыть/);
      settle(g);
      walk(g, 5, -63.55);
      use(/ларец/);
      g.select("thorn");
      assert.ok(g.wrongMark);
      assert.equal(g.marks, 0);
      g.select("wave");
      g.advance();
      use(/ларец/);
      assert.equal(g.marks, 1);
      g.select("thorn");
      g.select("sun");
      assert.equal(g.screen, "relic");
      g.advance();
      assert.ok(g.hasClapper);
      assert.equal(g.quest, "return");
      walk(g, 5, -46);
      walk(g, 0, -44.9);
      walk(g, 0, -38.8);
      walk(g, -4.55, -29.4);
      walk(g, -6.55, -29.4);
      walk(g, -6.55, -25.6);
      walk(g, -4.5, -25.7);
      use(/Вернуть/);
      g.advance();
      use(/Позвонить/);
      g.select(vow);
      g.select("all");
      for (let i = 0; i < 300; i++) g.update(1 / 60, rest);
      assert.equal(g.screen, "ending");
      assert.equal(g.vow, vow);
      assert.equal(g.presses, 4);
      assert.ok(g.openDoors.has("gallery"));
      assert.ok(g.openDoors.has("ossuary"));
      g.advance();
      assert.ok(g.hasClapper);
      walk(g, -3.05, -25.7);
      walk(g, -2.4, -29.4);
      walk(g, 0, -38.6);
      walk(g, 0, -65.3);
      walk(g, 0, -80);
      walk(g, 2.35, -88.95);
      use(/плиту/);
      g.select("inscribe");
      assert.equal(g.memorial, null, "The unlit name cannot be entered");
      g.advance();
      walk(g, 1.5, -84.55);
      walk(g, MIRROR.x, -84.55);
      use(/зеркало/);
      g.select("left");
      assert.equal(g.mirrorTurns, 0);
      g.select("right");
      g.select("left");
      g.select("right");
      g.select("right");
      g.select("right");
      assert.equal(g.mirrorIndex, 2);
      assert.equal(g.mirrorTurns, 4);
      g.advance();
      walk(g, 1.15, -84.65);
      walk(g, TABLETS[2].x, -88.95);
      use(/плиту/);
      const decision = vow === "one" ? "rest" : "inscribe";
      g.select(decision);
      g.select(decision === "rest" ? "inscribe" : "rest");
      assert.equal(g.memorial, decision);
      assert.equal(g.screen, "memorial");
    },
  );
}
