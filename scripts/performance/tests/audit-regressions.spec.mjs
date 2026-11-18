import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

async function mockGuestApi(page) {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { allow_guest: true, bootstrap_attempts: 1 } }),
  );
  await page.route("**/api/auth/guest", (route) =>
    route.fulfill({
      json: { token: "test-session", user: { name: "Guest", is_guest: true } },
    }),
  );
}

test("WebGL2 failure shows a recovery action without aborting the app module", async ({
  page,
}) => {
  await mockGuestApi(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === "webgl2" ? null : getContext.call(this, kind, ...args);
    };
  });
  await page.goto("/index.html");
  await expect(page.locator("#fatal")).toBeVisible();
  await expect(page.locator("#fatal-text")).toContainText("WebGL 2");
  await expect(page.locator("#reload")).toBeEnabled();
  await expect(page.locator("#autoplay")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("asset failure shows a reload action and keeps autoplay disabled", async ({
  page,
}) => {
  await mockGuestApi(page);
  await page.route("**/assets/props-v7/chest.glb*", (route) => route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/index.html");
  await expect(page.locator("#fatal-text")).toContainText(
    "Не удалось загрузить 3D-сцену",
    { timeout: 30_000 },
  );
  await expect(page.locator("#reload")).toBeVisible();
  await expect(page.locator("#autoplay")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("attribution does not cover the start button in a short viewport", async ({
  page,
}) => {
  await mockGuestApi(page);
  await page.setViewportSize({ width: 320, height: 200 });
  await page.goto("/index.html");
  const start = page.locator("#autoplay");
  await expect(start).toBeEnabled({ timeout: 60_000 });
  await start.tap();
  await expect(page.locator("#intro")).toBeHidden();
});

async function point(locator, id, offset = 0) {
  const { x, y, width, height } = await locator.boundingBox();
  return { x: x + width / 2 + offset, y: y + height / 2, id };
}

test("secondary touches trigger attack and dodge once while the stick remains held", async ({
  page,
  context,
}) => {
  await page.goto("/scripts/performance/fixtures/audit-lab.html");
  await page.waitForFunction(() => !!window.auditLab);
  const session = await context.newCDPSession(page);
  const touch = (type, touchPoints) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints });
  const stick = await point(page.locator("#joystick"), 1, 15);
  await touch("touchStart", [stick]);
  for (const [action, id] of [
    ["attack", 2],
    ["dodge", 3],
  ]) {
    const finger = await point(page.locator(`#${action}`), id);
    await touch("touchStart", [stick, finger]);
    await touch("touchEnd", [finger]);
  }
  expect(
    await page.evaluate(() => window.auditLab.actions.map((a) => a.action)),
  ).toEqual(["attack", "dodge"]);
  expect(
    await page.evaluate(() =>
      window.auditLab.actions.every((a) => a.axis.x > 0.3),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.auditLab.axis().x)).toBeGreaterThan(
    0.3,
  );
  await touch("touchEnd", []);
  expect(await page.evaluate(() => window.auditLab.axis())).toEqual({
    x: 0,
    y: 0,
  });

  await page.locator("#attack").tap();
  await page.locator("#dodge").press("Enter");
  expect(
    await page.evaluate(() => window.auditLab.actions.map((a) => a.action)),
  ).toEqual(["attack", "dodge", "attack", "dodge"]);
  const cancelled = await point(page.locator("#attack"), 4);
  await touch("touchStart", [cancelled]);
  await touch("touchCancel", []);
  expect(await page.evaluate(() => window.auditLab.actions.length)).toBe(4);
});

test("review controls stay reachable in landscape and a paused resource check can restart", async ({
  page,
}) => {
  await mockGuestApi(page);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.addInitScript(() => {
    window.drawCount = 0;
    for (const name of [
      "drawElements",
      "drawArrays",
      "drawElementsInstanced",
      "drawArraysInstanced",
    ]) {
      const draw = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        window.drawCount++;
        return draw.apply(this, args);
      };
    }
  });
  await page.goto("/index.html?review=1");
  await expect(page.locator("#manual")).toBeVisible({ timeout: 60_000 });
  await page.locator("#manual").tap();
  await expect(page.locator("#heal")).toBeVisible();
  await expect(page.locator("#review")).toBeHidden();
  for (const viewport of [
    { width: 667, height: 375 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.locator("#heal").evaluate((button) => {
        const r = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
    ).toBe(true);
  }
  await page.locator("#review-menu").tap();
  await expect(page.locator("#review")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const pausedDraws = await page.evaluate(async () => {
    const before = window.drawCount;
    for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
    return window.drawCount - before;
  });
  expect(pausedDraws).toBe(0);
  const beforeResize = await page.evaluate(() => window.drawCount);
  await page.setViewportSize({ width: 667, height: 375 });
  await expect
    .poll(() => page.evaluate(() => window.drawCount))
    .toBeGreaterThan(beforeResize);

  await page.locator("#soak").tap();
  await expect(page.locator("#intro")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#check-result")).toContainText(
    "Проверка ресурсов прервана",
  );
  await page.locator("#manual").tap();
  await expect(page.locator("#joystick")).toBeVisible();
});

test("teardown releases every instance buffer in two real World lifecycles", async ({
  page,
}) => {
  await page.goto("/scripts/performance/fixtures/audit-lab.html");
  await page.waitForFunction(() => !!window.auditLab);
  const cycles = await page.evaluate(() => window.auditLab.disposeWorlds());
  expect(cycles).toHaveLength(2);
  for (const cycle of cycles) {
    expect(cycle.instances).toBeGreaterThan(0);
    expect(cycle.disposeEvents).toBe(cycle.instances);
    expect(cycle.buffersDeleted).toBeGreaterThanOrEqual(cycle.instances);
    expect(cycle.lateDeletes).toBe(0);
  }
});

test("a rejected encoder frame cancels the output and releases recording state", async ({
  page,
}) => {
  await page.goto("/scripts/performance/fixtures/audit-lab.html");
  await page.waitForFunction(() => !!window.auditLab);
  expect(
    await page.evaluate(() => window.auditLab.rejectRecordingFrame()),
  ).toEqual({
    rejectedAdd: true,
    rejectedFinish: true,
    cancelled: 1,
    frames: 0,
    busy: false,
  });
});
