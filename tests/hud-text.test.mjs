import test from "node:test";
import assert from "node:assert/strict";
import { HUDTextCache } from "../src/hud-text.ts";
test("HUD text rasterizes once across frames and volatile counters cannot grow its backing store", () => {
  let strokes = 0,
    blits = 0;
  const make = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      measureText: (t) => ({ width: t.length * 8 }),
      strokeText() {
        strokes++;
      },
      fillText() {},
    }),
  });
  const cache = new HUDTextCache(make),
    target = {
      drawImage() {
        blits++;
      },
    };
  for (let frame = 0; frame < 100; frame++)
    for (const s of ["new0", "ПУТНИК", "ДЛИННЫЙ МЕЧ"])
      cache.draw(target, s, 20, 40, 14, "white", "left");
  assert.equal(strokes, 3);
  assert.equal(blits, 300);
  for (let i = 0; i < 2000; i++)
    cache.draw(target, "FPS " + i, 20, 40, 14, "white", "left");
  assert.ok(cache.size <= 96 && cache.pixelCount <= 524288);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.pixelCount, 0);
});
