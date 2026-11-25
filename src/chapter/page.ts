/// <reference types="vite/client" />
import markup from "./screen.html?raw";
import "./chapter.css";
import { API } from "../api";
import { Sound } from "../audio";
import { ASSET_REVISION, CLIENT_REVISION } from "../assets";
import { FrameSamples } from "../device-check";
import { Input } from "../input";
import { World } from "../world";
import { el, btn, commands, drawPanel, buildCourtOptions } from "./panel";
import { CourtScenery } from "./court-scenery";
import { STRIKES } from "./bell-quest";
import { ForestChapter } from "./forest";
import {
  ChapterAutoplay,
  PORTRAIT_BENCHMARK_SEED,
  type ChapterControls,
} from "./autoplay";
import { MIMIC } from "./encounter";

document.title = "new0 · У Чёрных ворот";
const app = document.getElementById("app")!;
const credits = app.querySelector("footer");
app.innerHTML = markup;
if (credits) app.querySelector("#credits")!.append(credits);
app.hidden = false;
const stage = el("chapter"),
  canvas = el<HTMLCanvasElement>("world");
const advance = btn("advance"),
  interact = btn("interact");
// Local captures can replay a real roll sequence using the same rules as a player.
const params = new URLSearchParams(location.search);
const routeProbe =
  ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) &&
  params.has("routeProbe");
const seed = routeProbe ? params.get("seed") : null;
const pilot = params.get("check") === "1" ? new ChapterAutoplay() : undefined;
const game = new ForestChapter(
    pilot
      ? PORTRAIT_BENCHMARK_SEED
      : seed !== null && /^\d{1,10}$/.test(seed) && Number(seed) <= 0xffffffff
        ? Number(seed)
        : undefined,
  ),
  input = new Input();
const sound = new Sound(false);
const api = new API();
let stepDistance = 0;
const tg = window.Telegram?.WebApp?.initData
  ? window.Telegram.WebApp
  : undefined;
const phone =
  tg?.platform === "ios" ||
  tg?.platform === "android" ||
  matchMedia("(pointer: coarse)").matches;
const measurements = {
  movement: new FrameSamples(),
  feedback: new FrameSamples(),
  combat: new FrameSamples(),
  mimic: new FrameSamples(),
};
let world: World | undefined,
  court: CourtScenery | undefined,
  ready = false,
  started = false,
  failed = false,
  leaving = false;
let frame = 0,
  last = 0,
  settling = 0,
  settleDirty = false;
let interrupted = tg?.isActive === false,
  blocked = false,
  wasPaused = false,
  orientationLocked = false;
let readingSince: number | undefined,
  readingMs = 0,
  pauses = 0;
let reportUrl = "",
  notice = "",
  noticeUntil = 0,
  previousView = "";
const paused = () => blocked || interrupted || document.hidden || leaving;
const activeBeat = () =>
  game.screen === "action" ||
  game.screen === "reply" ||
  game.screen === "reveal" ||
  game.screen === "ringing";
function render(dt: number) {
  court?.update(dt, game);
  world?.render(dt, game.speaker, game.shot, game.duel);
}
function updateReading() {
  const reading =
    ready &&
    started &&
    !paused() &&
    !activeBeat() &&
    game.screen !== "trail" &&
    game.screen !== "memorial";
  if (reading && readingSince === undefined) readingSince = performance.now();
  if (!reading && readingSince !== undefined) {
    readingMs += performance.now() - readingSince;
    readingSince = undefined;
  }
}
function autoplayReport(completed: boolean, controller: ChapterAutoplay) {
  return {
    protocol: "portrait-auto-1",
    client_revision: CLIENT_REVISION,
    asset_revision: ASSET_REVISION,
    platform: tg?.platform || "browser",
    telegram_version: tg?.version || "",
    viewport_width: innerWidth,
    viewport_height: Math.round(
      Math.min(innerHeight, tg?.viewportHeight || innerHeight),
    ),
    completed,
    weapon: game.equipped,
    weapon_swaps: controller.swaps,
    mimic_defeated: game.mimic.hp === 0,
    regen_used:
      game.foundRegen && (game.battle?.regenFlasks ?? game.regenFlasks) === 0,
    pauses,
    movement: measurements.movement.result(),
    combat: measurements.combat.result(),
    mimic: measurements.mimic.result(),
  };
}
let autoReport: ReturnType<typeof autoplayReport> | undefined;
let uploading = false,
  saved = false;
async function uploadReport() {
  if (!autoReport || uploading || saved) return;
  const status = el("auto-save"),
    retry = btn("retry-report");
  retry.hidden = true;
  if (!tg || api.user.is_guest) {
    status.textContent = "Замер готов";
    return;
  }
  uploading = true;
  status.textContent = "Сохранение отчёта…";
  try {
    const receipt = await api.request<{ id: string }>(
      "/diagnostics",
      autoReport,
    );
    if (!receipt.id) throw new Error("missing report receipt");
    saved = true;
    status.textContent = "Отчёт сохранён";
  } catch {
    status.textContent =
      "Не удалось отправить замер. Его можно отправить снова или скачать.";
    retry.hidden = false;
  } finally {
    uploading = false;
  }
}
btn("retry-report").onclick = () => void uploadReport();
function setReport(completed = true) {
  if (reportUrl) return;
  if (pilot) {
    autoReport = autoplayReport(completed, pilot);
    el("auto-result").hidden = false;
    el("auto-fps").textContent =
      `Движение ${Math.round(autoReport.movement.fps)} · Бой ${Math.round(autoReport.combat.fps)} · Мимик ${Math.round(autoReport.mimic.fps)} FPS`;
    el("report").hidden = false;
    void uploadReport();
  }
  const report = autoReport ?? {
    protocol: "bell-chapter-4",
    memorial: game.memorial,
    mirror_turns: game.mirrorTurns,
    weapon: game.player.weapon,
    mimic_defeated: game.mimic.hp === 0,
    regen_found: game.foundRegen,
    regen_remaining: game.regenFlasks,
    hidden_pike: game.foundPike,
    fourth_wick: game.sheltered,
    forest_oath: game.promised,
    completed: true,
    gatekeeper: game.guardianOutcome,
    ending: game.vow,
    seal_presses: game.presses,
    client_revision: CLIENT_REVISION,
    asset_revision: ASSET_REVISION,
    platform: tg?.platform || "browser",
    telegram_version: tg?.version || "",
    viewport: [
      innerWidth,
      Math.min(innerHeight, tg?.viewportHeight || innerHeight),
    ],
    stage: [stage.clientWidth, stage.clientHeight],
    renderer: world?.device,
    pauses,
    reading_seconds: readingMs / 1000,
    movement: measurements.movement.result(),
    feedback: measurements.feedback.result(),
  };
  reportUrl = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  el<HTMLAnchorElement>("report").href = reportUrl;
}
function show() {
  const { screen, battle } = game;
  const trail = screen === "trail";
  const nearby = trail ? game.nearby : "";
  if (
    stage.dataset.quest !== game.quest ||
    (stage.dataset.screen !== screen && !trail)
  )
    notice = "";
  const key = [
    screen,
    nearby,
    notice,
    game.flasks,
    game.coins,
    game.keys.has("gate"),
    game.openDoors.has("gate"),
    game.cleared,
    game.quest,
    game.location,
    game.player.y > 4.95,
    game.keys.has("gallery"),
    game.openDoors.has("gallery"),
    game.guardianOutcome,
    game.presses,
    game.mirrorIndex,
    game.tabletIndex,
    game.memorial,
    game.marks,
    game.wrongMark,
    game.clapperMounted,
    game.learnedName,
    game.cairnOpen,
    game.foundPike,
    game.foundRegen,
    game.regenFlasks,
    game.equipped,
    game.offered,
    game.sheltered,
    game.contacted,
    game.vow,
    battle?.attempt,
    battle?.turn,
  ].join("|");
  if (key === previousView) return;
  previousView = key;
  if (stage.dataset.screen !== screen) {
    if (screen === "victory") sound.play("win");
    input.reset();
    settling = 0.92;
    settleDirty = true;
  }
  stage.dataset.screen = screen;
  stage.dataset.quest = game.quest;
  input.enabled = started && trail && !pilot && !paused();
  drawPanel(game, nearby, notice);
  if (screen === "memorial") setReport();
  updateReading();
}
function requestFrame() {
  if (!frame && !paused() && !failed && ready && started)
    frame = requestAnimationFrame(tick);
}
function tick(now: number) {
  frame = 0;
  if (paused() || failed || !world) return;
  const raw = last ? now - last : 0;
  last = now;
  const dt = Math.min(0.1, raw / 1000);
  const wasTrail = game.screen === "trail";
  if (raw && activeBeat()) {
    measurements.feedback.add(raw);
    if (pilot && (game.screen === "action" || game.screen === "reply")) {
      measurements.combat.add(raw);
      if (game.spec === MIMIC) measurements.mimic.add(raw);
    }
  } else if (raw && wasTrail && game.player.speed > 0.1)
    measurements.movement.add(raw);
  const axis = pilot
    ? pilot.update(dt, game, controls)
    : world.moveAxis(input.axis());
  if (pilot?.failed) {
    fail("Маршрут прервался. Можно сохранить частичный замер и начать заново.");
    el("panel-title").textContent = "Автопрохождение остановилось";
    setReport(false);
    return;
  }
  const previousRing = game.ringTime;
  let remaining = dt;
  while (remaining > 0) {
    const step = Math.min(1 / 60, remaining);
    game.update(step, { ...axis, guard: false });
    remaining -= step;
  }
  for (const event of game.events.splice(0)) {
    if (event.type === "hit" || event.type === "hurt") {
      world.event(event);
      sound.play("hit");
    }
  }
  if (
    game.vow &&
    STRIKES[game.vow].some(
      (time) => time > previousRing && time <= game.ringTime,
    )
  )
    sound.bell();
  if (game.screen === "trail") {
    stepDistance += game.player.speed * dt;
    if (stepDistance >= 1.25) {
      stepDistance %= 1.25;
      sound.play("step");
    }
  }
  if (notice && game.elapsed >= noticeUntil) notice = "";
  show();
  if (game.screen === "trail" || activeBeat() || settling > 0 || settleDirty)
    render(dt);
  settling -= dt;
  if (game.screen === "trail" || activeBeat() || settling > 0 || pilot?.active)
    requestFrame();
  else last = 0;
  settleDirty = false;
}
function changed() {
  show();
  if (settleDirty || activeBeat() || game.screen === "trail") requestFrame();
}
function interactNow() {
  game.interact();
  readNotice();
  changed();
}
function readNotice() {
  for (const e of game.events.splice(0))
    if (e.label) {
      notice = e.label;
      noticeUntil = game.elapsed + 2.4;
      sound.play("secret");
    }
}
input.bindLook(canvas);
input.onLook = (x, y) => world?.orbit(x, y);
input.onInteract = interactNow;
input.bindAction(interact, interactNow);
const menuEnabled = () => ready && !failed && !paused() && !pilot;
const controls: ChapterControls = {
  interact: interactNow,
  orbit: (dx) => world?.orbit(dx, 0),
  advance() {
    game.advance();
    changed();
  },
  select(id) {
    game.select(id);
    if (game.events.length) readNotice();
    else
      sound.play(
        game.wrongMark && game.screen === "seals"
          ? "guard"
          : id === "takeRegen" || id === "drinkRegen" || id === "drinkHeal"
            ? "secret"
            : "click",
      );
    settling = 0.5;
    settleDirty = true;
    changed();
  },
  command(cmd) {
    if (!game.battle) return;
    if (cmd === "item" && game.battle.regenFlasks > 0) game.openPotions();
    else game.choose(cmd, game.battle.attempt, game.battle.turn);
    if (game.screen === "action") {
      sound.play(
        cmd === "skill" ? "pulse" : cmd === "item" ? "secret" : "click",
      );
    }
    changed();
  },
};
buildCourtOptions((button, id) =>
  input.bindAction(button, () => controls.select(id), menuEnabled),
);
for (const cmd of commands)
  input.bindAction(btn(cmd), () => controls.command(cmd), menuEnabled);
input.bindAction(
  advance,
  () => {
    if (failed || game.screen === "memorial") {
      location.reload();
      return;
    }
    if (!started) started = true;
    else game.advance();
    changed();
  },
  () => !paused() && (failed || (ready && (!started || !pilot?.active))),
);
function fail(message: string) {
  if (leaving) return;
  failed = true;
  input.reset();
  input.enabled = false;
  cancelAnimationFrame(frame);
  frame = 0;
  for (const id of ["vitals", "choices", "court-options", "walk", "report"])
    el(id).hidden = true;
  el("panel-title").textContent = "Не удалось открыть лес";
  el("line").textContent = message;
  advance.hidden = advance.disabled = false;
  advance.textContent = "Повторить загрузку";
}
function layout() {
  const height = Math.min(innerHeight, tg?.viewportHeight || innerHeight);
  stage.style.setProperty("--chapter-height", height + "px");
  const folded =
    phone &&
    tg?.isExpanded === false &&
    screen.width < screen.height &&
    (innerWidth >= height || height < 460);
  const landscape = phone && !folded && innerWidth > innerHeight;
  blocked = landscape || folded || (phone && height < 440);
  el("orientation").hidden = !blocked;
  el("orientation-title").textContent = landscape
    ? "Поверни телефон вертикально"
    : "Разверни окно игры";
  btn("expand").hidden = landscape || !tg;
  if (
    phone &&
    !blocked &&
    innerHeight > innerWidth &&
    !orientationLocked &&
    tg?.isVersionAtLeast?.("8.0") &&
    tg.lockOrientation
  ) {
    tg.lockOrientation();
    orientationLocked = true;
  }
  stage.inert = paused();
  // Telegram can send the settled viewport size while a finger is still down.
  // A live button already checks the release position against its current bounds.
  if (paused() || wasPaused) input.reset();
  input.enabled =
    ready &&
    !failed &&
    started &&
    game.screen === "trail" &&
    !pilot &&
    !paused();
  if (paused()) {
    sound.suspend();
    if (started && !wasPaused) pauses++;
    cancelAnimationFrame(frame);
    frame = 0;
  } else if (world && ready && !failed) {
    sound.resume();
    world.resize();
    render(0);
    settling = 0.23;
    requestFrame();
  }
  if (wasPaused !== paused()) last = 0;
  wasPaused = paused();
  updateReading();
}
btn("expand").onclick = () => tg?.expand();
btn("sound").onclick = async () => {
  if (!paused())
    btn("sound").setAttribute("aria-pressed", String(await sound.toggle()));
};
window.addEventListener("resize", layout);
document.addEventListener("visibilitychange", layout);
tg?.onEvent?.("viewportChanged", layout);
tg?.onEvent?.("safeAreaChanged", layout);
tg?.onEvent?.("contentSafeAreaChanged", layout);
tg?.onEvent?.("deactivated", () => {
  interrupted = true;
  layout();
});
tg?.onEvent?.("activated", () => {
  interrupted = false;
  layout();
});
window.addEventListener("game-context-lost", () =>
  fail("Графический контекст потерян. Повтори загрузку сцены."),
);
async function boot() {
  let errorText = "Не удалось выполнить вход.";
  try {
    tg?.ready();
    tg?.expand();
    if (tg?.isVersionAtLeast?.("7.7")) tg.disableVerticalSwipes?.();
    layout();
    await api.connect(tg?.initData ?? "");
    if (leaving) return;
    errorText =
      "Для игры нужен WebGL 2. Повтори загрузку или открой игру в поддерживаемом браузере.";
    world = new World(canvas, game, 2, true);
    if (routeProbe) {
      Object.assign(window, {
        readForestContact: () =>
          game.contacted
            ? game.screen === "action"
              ? game.result?.strike
              : game.screen === "reply"
                ? game.result?.reply
                : null
            : null,
        readForestTrail: () => ({
          x: game.player.x,
          z: game.player.z,
          y: game.player.y,
          right: world!.moveAxis({ x: 1, y: 0 }),
          down: world!.moveAxis({ x: 0, y: 1 }),
        }),
      });
    }
    errorText = "Не удалось загрузить материалы леса.";
    advance.textContent = "Загрузка леса…";
    const font = document.fonts.load('16px "Ebbe Black"');
    await Promise.all([
      font,
      world.load(async () => {
        if (!(await font).length) throw new Error("Шрифт недоступен");
        court = new CourtScenery();
        world!.scene.add(court.root);
      }),
    ]);
    if (leaving || failed) return;
    ready = true;
    advance.textContent = pilot ? "Автопрохождение" : "Играть";
    if (pilot) {
      el("line").textContent =
        "Паломница найдёт копьё, обменяет оружие у ворот и откроет сундук с мимиком. В конце появится замер FPS.";
      el("walk-help").textContent = "Автопрохождение";
      el("joystick").hidden = true;
    }
    advance.disabled = false;
    layout();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    fail(
      errorText === "Не удалось выполнить вход." && detail
        ? errorText + " " + detail
        : errorText,
    );
  }
}
const sceneResize = new ResizeObserver(() => {
  if (world && ready && !paused() && !failed) {
    world.resize();
    render(0);
  }
});
sceneResize.observe(canvas);
const booting = boot();
window.addEventListener("pagehide", () => {
  leaving = true;
  cancelAnimationFrame(frame);
  sceneResize.disconnect();
  sound.suspend();
  if (reportUrl) URL.revokeObjectURL(reportUrl);
  void booting.finally(() => world?.dispose());
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
