// Every interaction below goes through the same touch targets as manual play.
// Loopback telemetry steers the walk and labels contacts after the rules resolve.
export async function playBellRoute(
  page,
  session,
  advance,
  mark,
  {
    pass = "fight",
    vow = "all",
    afterGate = false,
    inspectStairs = false,
    discoveries = !afterGate && pass === "fight",
    promise = !afterGate && pass === "pay",
  } = {},
) {
  const touch = (type, touchPoints) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints });
  async function box(id) {
    const b = await page.locator(id).boundingBox();
    if (!b)
      throw new Error(
        "Hidden control " +
          id +
          " during " +
          (await page.locator("#panel-title").textContent()),
      );
    return b;
  }
  function point(b, x = 0.5, y = 0.5) {
    return { x: b.x + b.width * x, y: b.y + b.height * y, id: 1 };
  }
  async function tap(id) {
    const b = await box(id);
    if (await page.locator(id).isDisabled())
      throw new Error("Disabled control " + id);
    await touch("touchStart", [point(b)]);
    await touch("touchEnd", []);
  }
  async function use(term) {
    const label = await page.locator("#interact").innerText();
    if (!label.includes(term))
      throw new Error("Expected " + term + ", got " + label);
    await tap("#interact");
  }
  async function walk(x, z) {
    const b = await box("#joystick");
    let active = false;
    try {
      for (let i = 0; i < 260; i++) {
        const pos = await page.evaluate(() => window.readForestTrail());
        const dx = x - pos.x,
          dz = z - pos.z,
          dist = Math.hypot(dx, dz);
        if (dist < 0.115) return;
        const gain = Math.min(1, dist * 2.4) / dist;
        const p = point(
          b,
          0.5 + 0.34 * gain * (dx * pos.right.x + dz * pos.right.z),
          0.5 + 0.34 * gain * (dx * pos.down.x + dz * pos.down.z),
        );
        await touch(active ? "touchMove" : "touchStart", [p]);
        active = true;
        await advance(dist > 0.7 ? 8 : 3);
        if (i === 259)
          throw new Error("Walking stalled " + JSON.stringify({ x, z, pos }));
      }
    } finally {
      if (active) await touch("touchEnd", []);
    }
  }
  async function swipe(dx, dy) {
    const start = point(await box("#world"), dx < 0 ? 0.83 : 0.18, 0.46);
    await touch("touchStart", [start]);
    try {
      for (let i = 1; i <= 12; i++) {
        await touch("touchMove", [
          { ...start, x: start.x + (dx * i) / 12, y: start.y + (dy * i) / 12 },
        ]);
        await advance(2);
      }
    } finally {
      await touch("touchEnd", []);
    }
  }
  const screen = () => page.locator("#chapter").getAttribute("data-screen");
  async function fight(scene, drinkRegen = false) {
    await advance(140);
    await tap("#advance");
    await advance(88);
    if (drinkRegen) {
      await tap("#item");
      await advance(84);
      await mark("potion-choice");
      await tap("#court-drinkRegen");
      await advance(41);
      await mark("regen-first");
      for (
        let n = 0;
        n < 18 && ["action", "reply"].includes(await screen());
        n++
      )
        await advance(10);
      await mark("regen-next-turn");
      await advance(52);
    }
    for (const [i, cmd] of ["attack", "attack", "skill", "attack"].entries()) {
      if ((await screen()) === "victory") break;
      await tap("#" + cmd);
      await advance(cmd === "skill" ? 36 : 15);
      if (i === 0 || cmd === "skill") await mark(scene + "-" + cmd);
      await advance(7);
      let hit = await page.evaluate(() => window.readForestContact());
      for (let n = 0; !hit && n < 25; n++) {
        await advance(2);
        hit = await page.evaluate(() => window.readForestContact());
      }
      if (!hit || (await screen()) !== "action")
        throw new Error(
          "Missing player contact for " + scene + " turn " + (i + 1),
        );
      const kind = hit.lethal
        ? hit.critical
          ? "critical-finish"
          : "finish"
        : hit.critical
          ? "critical"
          : "normal";
      await mark(scene + "-" + (i + 1) + "-" + kind);
      await advance(50);
      if (i === 0 || cmd === "skill") await mark(scene + "-response-" + cmd);
      if ((await screen()) === "reply") {
        let reply = await page.evaluate(() => window.readForestContact());
        for (let n = 0; !reply && n < 12; n++) {
          await advance(2);
          reply = await page.evaluate(() => window.readForestContact());
        }
        if (reply)
          await mark(
            scene +
              "-" +
              (i + 1) +
              "-reply-" +
              (reply.critical ? "critical" : "normal"),
          );
      }
      for (
        let n = 0;
        n < 18 && ["action", "reply"].includes(await screen());
        n++
      )
        await advance(9);
      await advance(30);
    }
    if (
      (await page.locator("#chapter").getAttribute("data-screen")) !== "victory"
    )
      throw new Error("Fight did not reach victory");
    await advance(35);
    await tap("#advance");
    await advance(36);
  }
  if (!afterGate) {
    await advance(48);
    await tap("#sound");
    await tap("#advance");
    await advance(26);
    await walk(1.5, 4.35);
    await use("Заговорить");
    await mark("cantor");
    if (discoveries || promise) {
      await tap("#court-name");
      await advance(115);
      await mark("name");
      if (promise) {
        await tap("#court-promise");
        await advance(120);
        await mark("oath");
      }
      await tap("#advance");
      await advance(40);
    }
    if (!promise) await fight("sword");
    await walk(-2.8, 2.32);
    await use("ключ");
    await advance(34);
    await walk(0, 2.5);
    await walk(0, -6.6);
    await swipe(0, -115);
    await advance(52);
    await mark("gatehouse");
    await swipe(0, 115);
    await walk(0, -12.8);
    await advance(48);
    await use("ворота");
  }
  await advance(70);
  await walk(0, -15.9);
  await advance(18);
  await mark("stairs");
  if (inspectStairs) {
    await walk(0, -18.8);
    for (const [side, name] of [
      [-1, "west"],
      [1, "east"],
    ]) {
      await walk(side * 5.7, -18.8);
      await swipe(-side * 125, -20);
      await advance(28);
      await mark("stairs-" + name);
      await swipe(side * 125, 20);
      await walk(0, -18.8);
    }
  }
  await walk(0, -21.8);
  await walk(-4.4, -25.8);
  await advance(36);
  await use("колокол");
  await advance(88);
  await mark("inscription");
  await advance(112);
  await tap("#advance");
  if (discoveries) {
    await walk(-2.35, -26.5);
    await walk(-2.35, -30.25);
    await walk(-4.5, -30.31);
    await use("зарубки");
    await advance(92);
    await mark("grave");
    await tap("#court-speak");
    await advance(98);
    await mark("pike");
    await tap("#court-take");
    await advance(48);
    await walk(-2.35, -30.4);
  }
  await walk(1, -38.3);
  await use("сторожа");
  await advance(132);
  await mark("warden");
  await advance(60);
  if (discoveries) {
    await tap("#court-ask");
    await advance(100);
    await mark("story");
    await tap("#advance");
    await advance(45);
  }
  await tap("#court-" + pass);
  if (pass === "fight") await fight(discoveries ? "pike" : "blade");
  await advance(54);
  if (discoveries && pass === "fight") {
    await walk(2.15, -38.35);
    const inspect = async (finding, held, phase) => {
      await use("оружие");
      await advance(65);
      if (
        (await page.locator("#find-weapon").innerText()) !== finding ||
        (await page.locator("#held-weapon").innerText()) !== held
      )
        throw new Error("Incorrect weapons before " + phase);
      await mark(phase);
    };
    const axe = "Секира палача",
      spear = "Погребальное копьё";
    await inspect(axe, spear, "axe-offer");
    await tap("#advance");
    await inspect(axe, spear, "axe-left");
    await tap("#court-swap");
    await inspect(spear, axe, "recover-pike");
    await tap("#court-swap");
    await inspect(axe, spear, "axe-retake");
    await tap("#court-swap");
    await advance(30);
    await walk(0, -38.15);
  }
  await walk(0, -44.9);
  await mark("chapel");
  await walk(-3.33, -45.78);
  await use("ключ");
  await advance(70);
  if (discoveries) {
    await walk(-2.38, -46.5);
    await walk(-2.38, -51.9);
    await walk(-3.55, -52.13);
    await use("огарок");
    await advance(60);
    await tap("#court-shelter");
    await advance(75);
    await mark("wick");
    await tap("#court-takeRegen");
    await advance(50);
    await tap("#advance");
    await walk(-2.38, -51.9);
    if (pass === "fight") {
      await walk(-2.35, -55.65);
      await walk(-3.31, -55.76);
      await use("сундук");
      await advance(100);
      await mark("coffer");
      await tap("#advance");
      await use("сундук");
      await tap("#court-uncatch");
      await advance(39);
      await mark("mimic-reveal");
      await fight("axe", true);
      await mark("mimic-defeated");
      await walk(-2.35, -55.65);
      await walk(-2.38, -51.9);
    }
    await walk(-2.38, -46.5);
  }
  await walk(0, -46);
  await walk(5, -46);
  await walk(5, -58.95);
  await advance(26);
  await mark("vestry-closed");
  await use("Открыть");
  await advance(70);
  await mark("vestry-open");
  await walk(5, -63.55);
  await use("ларец");
  await advance(96);
  await mark("seals");
  for (const id of ["wave", "thorn", "sun"]) {
    await tap("#court-" + id);
    await advance(57);
  }
  await advance(52);
  await mark("relic");
  await tap("#advance");
  await advance(40);
  for (let i = 0; i < 3; i++) await swipe(-246, 0);
  await walk(5, -54.5);
  await mark("descent");
  await walk(5, -46);
  await walk(0, -44.9);
  await walk(0, -38.8);
  await walk(-4.55, -29.4);
  await walk(-6.55, -29.4);
  await walk(-6.55, -25.6);
  await walk(-4.5, -25.7);
  await use("Вернуть");
  await advance(125);
  await mark("vow");
  await advance(60);
  await tap("#court-" + vow);
  await advance(310);
  await mark("ending");
  await advance(85);
  const finalScreen = await page
    .locator("#chapter")
    .getAttribute("data-screen");
  if (finalScreen !== "ending")
    throw new Error("The final bell did not finish. Screen: " + finalScreen);
  await tap("#advance");
  await advance(40);
  for (let i = 0; i < 3; i++) await swipe(246, 0);
  await walk(-3.05, -25.7);
  await walk(-2.4, -29.4);
  await walk(0, -38.6);
  await walk(0, -45.0);
  await walk(0, -65.3);
  await walk(0, -72.2);
  await advance(45);
  await mark("crypt-passage");
  await walk(0, -80.4);
  await walk(-0.8, -84.55);
  await use("зеркало");
  await advance(94);
  await mark("mirror");
  if (pass === "fight") {
    await tap("#advance");
    await walk(-2.45, -84.55);
    await walk(-2.45, -88.98);
    await use("плиту");
    await advance(95);
    await mark("chalice");
    await tap("#advance");
    await walk(2.35, -88.95);
    await use("плиту");
    await advance(65);
    await mark("unlit-palm");
    await tap("#advance");
    await walk(1.15, -84.55);
    await walk(-0.8, -84.55);
    await use("зеркало");
  }
  await tap("#court-right");
  await advance(65);
  await mark("feather");
  await tap("#court-right");
  await advance(92);
  await mark("palm");
  await tap("#advance");
  await walk(1.15, -84.65);
  await walk(2.35, -88.94);
  await use("плиту");
  await advance(126);
  await mark("name-of-singer");
  const memorial = pass === "fight" ? "inscribe" : "rest";
  await tap("#court-" + memorial);
  await advance(123);
  await mark("memorial");
  await advance(37);
  if ((await screen()) !== "memorial")
    throw new Error("The ossuary finale did not resolve");
  const report = await page
    .locator("#report")
    .evaluate(async (a) => (await fetch(a.href)).json());
  if (
    report.gatekeeper !== (pass === "fight" ? "won" : "paid") ||
    report.ending !== vow ||
    report.seal_presses !== 3 ||
    report.hidden_pike !== discoveries ||
    report.fourth_wick !== discoveries ||
    report.mimic_defeated !== (discoveries && pass === "fight") ||
    report.regen_found !== discoveries ||
    report.regen_remaining !== (discoveries && pass !== "fight" ? 1 : 0) ||
    report.forest_oath !== promise ||
    report.memorial !== memorial ||
    report.mirror_turns !== 2 ||
    !report.completed
  )
    throw new Error("Unexpected chapter result " + JSON.stringify(report));
  return report;
}
