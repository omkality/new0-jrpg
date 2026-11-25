import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ChapterAutoplay,
  PORTRAIT_BENCHMARK_SEED,
} from "../src/chapter/autoplay.ts";
import { ForestChapter } from "../src/chapter/forest.ts";
import { MIMIC } from "../src/chapter/encounter.ts";

for (const fps of [60, 35, 12]) {
  test(`portrait autoplay reaches the memorial through the mimic at ${fps} fps`, () => {
    const game = new ForestChapter(PORTRAIT_BENCHMARK_SEED);
    const pilot = new ChapterAutoplay();
    const swaps = [];
    let usedRegen = false;
    const controls = {
      interact: () => game.interact(),
      advance: () => game.advance(),
      select(option) {
        if (option === "drinkRegen") {
          assert.equal(game.spec, MIMIC);
          assert.ok(game.battle.regenFlasks > 0);
          usedRegen = true;
        }
        game.select(option);
        if (option === "swap") swaps.push(game.equipped);
      },
      command(command) {
        const b = game.battle;
        if (command === "item" && b.regenFlasks > 0) game.openPotions();
        else game.choose(command, b.attempt, b.turn);
      },
      orbit() {},
    };
    let elapsed = 0;
    while (pilot.active && elapsed < 300) {
      const dt = 1 / fps;
      const movement = pilot.update(dt, game, controls);
      let remaining = dt;
      while (remaining > 0) {
        const step = Math.min(1 / 60, remaining);
        game.update(step, { ...movement, guard: false });
        remaining -= step;
      }
      game.events.length = 0;
      elapsed += dt;
    }
    assert.equal(
      game.screen,
      "memorial",
      JSON.stringify({
        elapsed,
        state: game.screen,
        quest: game.quest,
        nearby: game.nearby,
        x: game.player.x,
        z: game.player.z,
        step: pilot.index,
        failed: pilot.failed,
      }),
    );
    assert.equal(game.memorial, "inscribe");
    assert.equal(game.mimic.hp, 0);
    assert.deepEqual(swaps, ["axe", "spear", "axe"]);
    assert.equal(pilot.swaps, 3);
    assert.equal(usedRegen, true);
    assert.equal(game.regenFlasks, 0);
    assert.equal(pilot.failed, false);
  });
}
