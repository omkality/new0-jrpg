import { expect, test } from "@playwright/test";
import { playBellRoute } from "../bell-route.mjs";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 393, height: 720 },
});
// This suite checks input and outcomes. Keep each presentation tick below the
// game's 100 ms clamp; the simulation still substeps all movement at 60 Hz.
async function elapse(page, milliseconds) {
  for (let left = milliseconds; left > 0; left -= 80)
    await page.clock.fastForward(Math.min(left, 80));
}
async function enter(page, signed = false, seed = 59, autoplay = false) {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  if (signed)
    await page.addInitScript(() => {
      const events = new Map();
      window.telegramTestEvents = events;
      window.Telegram = {
        WebApp: {
          initData: "fixture-signed-by-test",
          isExpanded: true,
          platform: "ios",
          ready() {},
          expand() {},
          isVersionAtLeast() {
            return true;
          },
          lockOrientation() {
            window.lockCount = (window.lockCount || 0) + 1;
          },
          onEvent(name, cb) {
            events.set(name, cb);
          },
        },
      };
    });
  const requests = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === "/api/config")
      return route.fulfill({
        json: { allow_guest: true, bootstrap_attempts: 1 },
      });
    if (path === (signed ? "/api/auth/telegram" : "/api/auth/guest"))
      return route.fulfill({
        json: { token: "fixture", user: { name: "Test", is_guest: !signed } },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(
    autoplay
      ? "/index.html?chapter=forest&check=1"
      : "/index.html?chapter=forest&routeProbe=1&seed=" + seed,
  );
  await expect(page.locator("#advance")).toHaveText(
    autoplay ? "Автопрохождение" : "Играть",
    {
      timeout: 90_000,
    },
  );
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  const session = await page.context().newCDPSession(page);
  const touch = (type, touchPoints) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints });
  async function at(id, x = 0.5, y = 0.5, finger = 1) {
    const r = await page.locator(id).boundingBox();
    if (!r) throw new Error("Hidden control " + id);
    return { x: r.x + r.width * x, y: r.y + r.height * y, id: finger };
  }
  async function tap(id) {
    await touch("touchStart", [await at(id)]);
    await touch("touchEnd", []);
  }
  async function walk(x, y, stop, max = 5000) {
    const p = await at("#joystick", 0.5 + 0.34 * x, 0.5 + 0.34 * y);
    await touch("touchStart", [p]);
    let elapsed = 0;
    while (elapsed < max) {
      if (stop && (await stop())) break;
      const t = Math.min(80, max - elapsed);
      await elapse(page, t);
      elapsed += t;
    }
    await touch("touchEnd", []);
    if (stop) expect(await stop()).toBe(true);
  }
  const near = (text) =>
    page
      .locator("#interact")
      .evaluate((b, t) => !b.hidden && b.textContent.includes(t), text);
  return { requests, touch, at, tap, walk, near, session };
}
test("portrait autoplay shows the weapon exchange, fights the mimic and retries the same device report", async ({
  page,
}) => {
  const { tap } = await enter(page, true, 90, true);
  const reports = [];
  await page.route("**/api/diagnostics", async (route) => {
    expect(await route.request().headerValue("authorization")).toBe(
      "Bearer fixture",
    );
    reports.push(route.request().postDataJSON());
    await route.fulfill(
      reports.length === 1
        ? { status: 503, json: {} }
        : { json: { id: "fixture-receipt" } },
    );
  });
  await tap("#advance");
  const seen = new Set();
  for (let i = 0; i < 100 && reports.length === 0; i++) {
    await elapse(page, 2400);
    seen.add(await page.locator("#chapter").getAttribute("data-screen"));
  }
  expect(seen.has("weapon")).toBe(true);
  expect(seen.has("coffer")).toBe(true);
  await expect(page.locator("#chapter")).toHaveAttribute(
    "data-screen",
    "memorial",
  );
  await expect(page.locator("#retry-report")).toBeVisible();
  await tap("#retry-report");
  await expect(page.locator("#auto-save")).toHaveText("Отчёт сохранён");
  expect(reports).toHaveLength(2);
  expect(reports[0]).toEqual(reports[1]);
  expect(reports[0]).toMatchObject({
    protocol: "portrait-auto-1",
    platform: "ios",
    completed: true,
    weapon: "axe",
    weapon_swaps: 3,
    mimic_defeated: true,
    regen_used: true,
  });
  for (const segment of ["movement", "combat", "mimic"]) {
    expect(reports[0][segment].frames).toBeGreaterThan(0);
    expect(reports[0][segment].p95_ms).toBeGreaterThan(0);
  }
});
test("portrait play: concurrent taps, camera, rotation, inactive webview, retry and a won encounter", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 844, height: 390 });
  const { requests, touch, at, tap, walk, near, session } = await enter(
    page,
    true,
  );
  await expect(page.locator("#orientation")).toBeVisible();
  expect(await page.evaluate(() => window.lockCount || 0)).toBe(0);
  await page.setViewportSize({ width: 393, height: 720 });
  await page.clock.runFor(64);
  expect(await page.evaluate(() => window.lockCount)).toBe(1);
  await page.evaluate(() => {
    const tg = window.Telegram.WebApp;
    tg.isExpanded = false;
    tg.viewportHeight = 365;
    window.telegramTestEvents.get("viewportChanged")();
  });
  await expect(page.locator("#orientation")).toBeVisible();
  await expect(page.locator("#orientation-title")).toHaveText(
    "Разверни окно игры",
  );
  await page.evaluate(() => {
    const tg = window.Telegram.WebApp;
    tg.isExpanded = true;
    tg.viewportHeight = undefined;
    window.telegramTestEvents.get("viewportChanged")();
  });
  const play = await at("#advance");
  await touch("touchStart", [play]);
  await page.evaluate(() => window.telegramTestEvents.get("viewportChanged")());
  await touch("touchEnd", []);
  await expect(page.locator("#chapter")).toHaveAttribute(
    "data-screen",
    "trail",
  );
  await walk(0.37, -0.93, () => near("Заговорить"));
  // Touch the conversation with a second finger while keeping the movement stick held.
  const stick = await at("#joystick", 0.51, 0.28),
    talk = await at("#interact", 0.5, 0.5, 2);
  await touch("touchStart", [stick]);
  await touch("touchStart", [stick, talk]);
  await touch("touchEnd", [stick]);
  await touch("touchEnd", []);
  const state = () => page.locator("#chapter").getAttribute("data-screen");
  expect(await state()).toBe("dialogue");
  await tap("#advance");
  for (const size of [
    { width: 320, height: 568 },
    { width: 430, height: 932 },
    { width: 393, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.clock.runFor(64);
    for (const id of ["attack", "item", "skill"]) {
      expect(
        await page.locator("#" + id).evaluate((b) => {
          const r = b.getBoundingClientRect();
          return (
            r.width >= 44 &&
            r.height >= 44 &&
            [2, r.width / 2, r.width - 2].every((dx) =>
              b.contains(
                document.elementFromPoint(r.x + dx, r.y + r.height / 2),
              ),
            )
          );
        }),
      ).toBe(true);
    }
    await expect
      .poll(() =>
        page
          .locator("#world")
          .evaluate((c) =>
            [
              Math.abs(c.clientWidth / 2 - c.width),
              Math.abs(c.clientHeight / 2 - c.height),
            ].map(Math.floor),
          ),
      )
      .toEqual([0, 0]);
  }
  await page.clock.fastForward(10_000);
  await expect(page.locator("#hero-hp")).toHaveText("100 / 100");
  await expect(page.locator("#skill")).toBeDisabled();
  await expect(page.locator("#skill strong")).toHaveText("Тяжёлый удар");
  await expect(page.locator("#skill small")).toHaveText("Ещё 2 атаки");
  await expect(page.locator("#item")).toBeDisabled();
  const a = await at("#attack"),
    b = await at("#attack", 0.65, 0.5, 2);
  await touch("touchStart", [a]);
  await touch("touchStart", [a, b]);
  await touch("touchEnd", [b]);
  await touch("touchEnd", []);
  expect(await state()).toBe("action");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.fastForward(2500);
  expect(await state()).toBe("action");
  await page.evaluate(() => window.telegramTestEvents.get("deactivated")());
  await page.setViewportSize({ width: 393, height: 720 });
  await page.clock.fastForward(2500);
  expect(await state()).toBe("action");
  await page.evaluate(() => window.telegramTestEvents.get("activated")());
  await elapse(page, 3450);
  expect(await state()).toBe("choice");
  await expect(page.locator("#hero-hp")).toHaveText("82 / 100");
  await expect(page.locator("#skill small")).toHaveText("Ещё 1 атака");
  for (let i = 0; i < 4; i++) {
    await tap("#attack");
    await elapse(page, 3450);
  }
  expect(await state()).toBe("defeat");
  await tap("#advance");
  await tap("#advance");
  await expect(page.locator("#hero-hp")).toHaveText("100 / 100");
  for (const cmd of ["attack", "attack", "skill", "attack"]) {
    await tap("#" + cmd);
    await elapse(page, 3450);
  }
  expect(await state()).toBe("victory");
  await tap("#advance");
  await expect(page.locator("#hero-hp")).toHaveText("32 / 100");
  await expect(page.locator("#stock")).toContainText("Монеты 5");
  expect(await state()).toBe("trail");
  await walk(-0.82, -0.57, () => near("Взять ключ"));
  await tap("#interact");
  await walk(0.98, 0.18, null, 690);
  await walk(0.18, -0.98, () => near("Чёрные ворота"), 7200);
  await tap("#interact");
  // Play the whole courtyard on the smallest supported screen. The actual
  // compositor frame also verifies the browser has presented the new viewport.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.runFor(64);
  await page.screenshot();
  const report = await playBellRoute(
    page,
    session,
    async (frames) => {
      // Coarser presentation ticks still use the ordinary 60 Hz locomotion substeps.
      for (let n = frames; n > 0; n -= 5)
        await page.clock.fastForward(Math.round((Math.min(n, 5) * 1000) / 60));
    },
    async (phase) => {
      if (!["warden", "seals", "vow", "palm", "name-of-singer"].includes(phase))
        return;
      for (const action of await page
        .locator("#court-options button:visible")
        .all()) {
        expect(
          await action.evaluate((button) => {
            const r = button.getBoundingClientRect();
            return (
              r.height >= 44 &&
              r.width >= 44 &&
              [3, r.width / 2, r.width - 3].every((x) =>
                button.contains(
                  document.elementFromPoint(r.left + x, r.top + r.height / 2),
                ),
              )
            );
          }),
        ).toBe(true);
      }
    },
    { afterGate: true, pass: "pay", vow: "one" },
  );
  expect(report.completed).toBe(true);
  expect(report.memorial).toBe("rest");
  expect(report.viewport).toEqual([320, 568]);
  expect(report.pauses).toBe(1);
  expect(report.feedback.frames).toBeGreaterThan(0);
  expect(report.movement.frames).toBeGreaterThan(0);
  expect(requests).toEqual(["/api/config", "/api/auth/telegram"]);
  expect(errors).toEqual([]);
});
test("a guest can take the forest potion and drink it during a turn", async ({
  page,
}) => {
  const { requests, tap, walk, near } = await enter(page);
  await tap("#advance");
  await walk(-0.72, -0.7, () => near("лечебное зелье"), 5200);
  await tap("#interact");
  await expect(page.locator("#stock")).toContainText("Зелья 1");
  await walk(0.86, 0.51, null, 1550);
  await walk(0.95, -0.31, null, 730);
  await walk(0.45, -0.89, () => near("Заговорить"), 5000);
  await tap("#interact");
  await tap("#advance");
  await expect(page.locator("#item")).toBeDisabled();
  await tap("#attack");
  await elapse(page, 3450);
  await tap("#item");
  await expect(page.locator("#hero-hp")).toHaveText("82 / 100");
  await elapse(page, 650);
  await expect(page.locator("#hero-hp")).toHaveText("100 / 100");
  await elapse(page, 3450);
  await expect(page.locator("#hero-hp")).toHaveText("68 / 100");
  await expect(page.locator("#item")).toBeDisabled();
  expect(requests).toEqual(["/api/config", "/api/auth/guest"]);
});
test("compare, leave and recover weapons, drink a timed potion and finish three duels on a compact phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { session } = await enter(page, false, 90);
  const seen = [];
  const contacts = [];
  const report = await playBellRoute(
    page,
    session,
    async (frames) => {
      for (let n = frames; n > 0; n -= 5)
        await page.clock.fastForward(Math.round((Math.min(n, 5) * 1000) / 60));
    },
    async (phase) => {
      if (["pike", "axe-offer", "recover-pike", "axe-retake"].includes(phase)) {
        const axe = "Урон 20–22 · Крит 20% · Приём 44–48";
        const spear = "Урон 18–20 · Крит 12% · Приём 39–43";
        const sword = "Урон 14–16 · Крит 16% · Приём 36–40";
        const groundIsAxe = phase === "axe-offer" || phase === "axe-retake";
        await expect(page.locator("#find-stats")).toHaveText(
          groundIsAxe ? axe : spear,
        );
        await expect(page.locator("#held-stats")).toHaveText(
          phase === "pike" ? sword : groundIsAxe ? spear : axe,
        );
        const readable = await page
          .locator("#weapon-compare")
          .evaluate((card) => {
            const r = card.getBoundingClientRect();
            return (
              r.top > 0 &&
              r.bottom <= innerHeight &&
              r.right <= innerWidth &&
              card.scrollWidth === card.clientWidth
            );
          });
        expect(readable).toBe(true);
        for (const button of [
          "#advance",
          phase === "pike" ? "#court-take" : "#court-swap",
        ]) {
          const reachable = await page.locator(button).evaluate((b) => {
            const r = b.getBoundingClientRect();
            return (
              r.height >= 44 &&
              r.width >= 44 &&
              b.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              )
            );
          });
          expect(reachable).toBe(true);
        }
      }
      if (phase === "regen-first") {
        await expect(page.locator("#hero-hp")).toHaveText("30 / 100");
        await expect(page.locator("#stock")).toContainText("Реген. 2 х.");
      }
      if (phase === "axe-1-normal") {
        await expect(page.locator("#line")).toContainText(
          "Урон 21. Регенерация +12 HP",
        );
        await expect(page.locator("#attack strong")).toHaveText("Рубануть");
      }
      const expected = {
        "sword-1-normal": ["Клинок попал в цель. Урон 14.", "68 / 82"],
        "sword-2-critical": ["Критический удар. Урон 21.", "47 / 82"],
        "sword-4-finish": ["Добивание. Урон 7.", "0 / 82"],
        "pike-2-critical": ["Критический удар. Урон 30.", "30 / 80"],
        "pike-3-finish": ["Добивание. Урон 30.", "0 / 80"],
      }[phase];
      if (expected) {
        await expect(page.locator("#line")).toHaveText(expected[0]);
        await expect(page.locator("#foe-hp")).toHaveText(expected[1]);
        contacts.push(phase);
      }
      if (phase === "unlit-palm") {
        await expect(page.locator("#line")).toContainText("В косом свете");
        await expect(page.locator("#court-inscribe")).toBeHidden();
        await expect(page.locator("#court-rest")).toBeHidden();
      }
      if (phase === "name-of-singer")
        await expect(page.locator("#court-inscribe")).toBeVisible();
      if (!["sword-attack", "pike-attack", "pike-skill"].includes(phase))
        return;
      const label = page.locator("#skill strong");
      await expect(page.locator("#attack strong")).toHaveText(
        phase === "sword-attack" ? "Рассечь" : "Укол",
      );
      await expect(label).toHaveText(
        phase === "sword-attack" ? "Тяжёлый удар" : "Выпад",
      );
      expect(
        await label.evaluate((strong) => {
          const range = document.createRange();
          range.selectNodeContents(strong);
          const button = strong.parentElement.getBoundingClientRect();
          return [...range.getClientRects()].every(
            (r) =>
              r.left >= button.left &&
              r.right <= button.right &&
              r.bottom <= button.bottom,
          );
        }),
      ).toBe(true);
      seen.push(phase);
    },
    { pass: "fight", vow: "all" },
  );
  expect(seen).toEqual(["sword-attack", "pike-attack", "pike-skill"]);
  expect(contacts).toEqual([
    "sword-1-normal",
    "sword-2-critical",
    "sword-4-finish",
    "pike-2-critical",
    "pike-3-finish",
  ]);
  expect(report.memorial).toBe("inscribe");
  expect(report.hidden_pike && report.fourth_wick && report.completed).toBe(
    true,
  );
  expect([
    report.weapon,
    report.mimic_defeated,
    report.regen_found,
    report.regen_remaining,
  ]).toEqual(["axe", true, true, 0]);
});
