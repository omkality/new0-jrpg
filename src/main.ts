import { ASSET_REVISION, CLIENT_REVISION } from "./assets";
import "./style.css";
import { BLOCK, ENEMIES, type EnemyKind } from "./game";
import { Campaign, SCENARIOS, type ScenarioId } from "./campaign";
import { WEAPONS } from "./weapon-spec";
import { Input } from "./input";
import { World } from "./world";
import { Sound } from "./audio";
import { API } from "./api";
import { CampaignShowcase } from "./journey";
import { LOCATIONS } from "./locations";
import {
  DeviceCheck,
  type DeviceReport,
  type ResourceMetrics,
} from "./device-check";
import type { FrameCapture } from "./recording";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        platform?: string;
        version?: string;
        ready(): void;
        expand(): void;
        disableVerticalSwipes?(): void;
        setHeaderColor?(s: string): void;
        setBackgroundColor?(s: string): void;
        onEvent?(s: string, f: () => void): void;
      };
    };
  }
}
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const visible = (s: string, v: boolean) => $(s).classList.toggle("hidden", !v);
const game = new Campaign(),
  input = new Input(),
  sound = new Sound(),
  api = new API();
const world = new World($<HTMLCanvasElement>("#world"), game);
const hud = $<HTMLCanvasElement>("#hud"),
  h = hud.getContext("2d")!;
const atmosphere = $<HTMLCanvasElement>("#atmosphere"),
  noiseCtx = atmosphere.getContext("2d", { alpha: false })!;
const noiseTile = document.createElement("canvas");
noiseTile.width = noiseTile.height = 128;
const noiseTileCtx = noiseTile.getContext("2d")!,
  noisePixels = noiseTileCtx.createImageData(128, 128);
let noiseSeed = 913;
for (let i = 0; i < noisePixels.data.length; i += 4) {
  noiseSeed ^= noiseSeed << 13;
  noiseSeed ^= noiseSeed >>> 17;
  noiseSeed ^= noiseSeed << 5;
  const v = (noiseSeed >>> 24) & 255;
  noisePixels.data.set([v, v, v, 255], i);
}
noiseTileCtx.putImageData(noisePixels, 0, 0);
const noisePattern = noiseCtx.createPattern(noiseTile, "repeat")!;
const params = new URLSearchParams(location.search),
  review = params.get("review") === "1";
const requestedScenario = params.get("scenario");
let selected: ScenarioId =
  requestedScenario && Object.hasOwn(SCENARIOS, requestedScenario)
    ? (requestedScenario as ScenarioId)
    : "journey";
let loaded = false,
  paused = false,
  autoplay = false;
let last = performance.now(),
  accumulator = 0,
  uiTick = 0,
  lastNoise = 0;
let demonstration: CampaignShowcase | null = null,
  deviceCheck: DeviceCheck | null = null;
let lastDeviceReport: DeviceReport | null = null;
let errors = 0,
  contextLosses = 0,
  errorBaseline = 0,
  contextBaseline = 0,
  controlsFit = true;
let frames: number[] = [],
  frameNumber = 0,
  performanceText = "",
  lastQualityChange = 0;
let toastUntil = 0,
  toastValue = "";
let capture: FrameCapture | null = null,
  recording = false;
let captureMarks: {
  seconds: number;
  label: string;
  area: string;
  phase: string;
  weapon: string;
  armour: number;
  hp: number;
  doors: number;
  chests: number;
  frame: number;
  player_action: string;
  combo: number;
  enemy_action: string;
  enemy_kind: string;
  enemy_hp: number;
  dodge_side: string;
}[] = [];
let captureMarkKey = "";
let recordCanvas: HTMLCanvasElement | null = null,
  recordCtx: CanvasRenderingContext2D | null = null;
let lastCapture = 0,
  finishedTail = 0;
const captureLimit = () =>
  selected === "journey" || selected === "escape"
    ? 300
    : selected === "locked" || selected === "chapel"
      ? 160
      : 90;
let raf = 0;
let soak: {
  runs: number;
  snapshots: ResourceMetrics[];
  completed: boolean[];
} | null = null;

function chooseScenario(id: ScenarioId) {
  selected = id;
  $<HTMLSelectElement>("#review-scenario").value = id;
}
chooseScenario(selected);
function toast(t: string) {
  toastValue = t;
  toastUntil = performance.now() + 2200;
  $("#toast").textContent = t;
  visible("#toast", true);
}
function startScenario(id: ScenarioId, auto = true) {
  game.startScenario(id);
  world.resetView();
  paused = false;
  autoplay = auto;
  demonstration = auto ? new CampaignShowcase(game, id) : null;
  input.reset();
  input.enabled = !auto;
  $("#touch-controls").inert = auto;
  $("#touch-controls").classList.toggle("measure-only", auto);
  for (const selector of ["#drop", "#heal", "#interact"])
    $(selector).classList.toggle("measure-only", auto);
  visible("#intro", false);
  visible("#toast", false);
  toastValue = "";
  $("#world").focus({ preventScroll: true });
  frames = [];
  accumulator = 0;
  finishedTail = 0;
  last = performance.now();
}
function beginShowcase() {
  if (!loaded || deviceCheck || soak) return;
  startScenario(selected);
}
function pause() {
  if (!loaded || game.phase === "intro" || paused) return;
  if (deviceCheck) {
    void finishDeviceCheck(true);
    return;
  }
  paused = true;
  input.reset();
  input.enabled = false;
  sound.suspend();
  visible("#intro", true);
}
input.onPause = pause;
input.onAttack = () => game.attack();
input.onInteract = () => game.interact();
input.onDodge = () => game.dodge(world.moveAxis(input.axis()));
input.onLock = () => {
  game.lock = !game.lock;
};
input.onLook = (x, y) => world.orbit(x, y);
input.bindLook($("#world"));
input.bindGuard($("#guard"));
$("#attack").onclick = () => game.attack();
$("#dodge").onclick = () => game.dodge(world.moveAxis(input.axis()));
$("#interact").onclick = () => game.interact();
$("#review-scenario").onchange = () =>
  chooseScenario($<HTMLSelectElement>("#review-scenario").value as ScenarioId);
$("#showcase").onclick = beginShowcase;
$("#manual").onclick = () => {
  if (deviceCheck || recording || soak) return;
  startScenario(selected, false);
};
$("#drop").onclick = () => game.dropWeapon();
$("#heal").onclick = () => game.heal();
$("#soak").onclick = () => {
  if (!loaded || recording || deviceCheck || soak) return;
  soak = { runs: 0, snapshots: [], completed: [] };
  visible("#soak-download", false);
  startScenario("journey");
};
$("#reload").onclick = () => location.reload();
function fatal(text: string) {
  $("#fatal-text").textContent = text;
  visible("#fatal", true);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pause();
    void stopRecording();
  }
});
window.addEventListener("error", () => errors++);
window.addEventListener("unhandledrejection", () => errors++);
window.addEventListener("game-context-lost", () => {
  contextLosses++;
  if (deviceCheck) void finishDeviceCheck(true);
  fatal("Графика приостановлена. Перезагрузи демку.");
});
function resizeHUD() {
  hud.width = atmosphere.width = innerWidth;
  hud.height = atmosphere.height = innerHeight;
  lastNoise = 0;
}
window.addEventListener("resize", resizeHUD);
resizeHUD();
function drawNoise(now: number) {
  if (now - lastNoise < 125) return;
  lastNoise = now;
  const step = Math.floor(now / 125);
  noiseCtx.setTransform(1, 0, 0, 1, (step * 29) % 128, (step * 47) % 128);
  noiseCtx.fillStyle = noisePattern;
  noiseCtx.fillRect(
    -128,
    -128,
    atmosphere.width + 256,
    atmosphere.height + 256,
  );
  noiseCtx.setTransform(1, 0, 0, 1, 0, 0);
}
function text(
  t: string,
  x: number,
  y: number,
  size = 11,
  color = "#e4eaf3",
  align: CanvasTextAlign = "left",
) {
  h.font = `${Math.max(12, size * 1.2)}px "Ebbe Black"`;
  h.textAlign = align;
  h.fillStyle = color;
  h.shadowColor = "#132232";
  h.shadowBlur = 5;
  h.lineWidth = 2;
  h.strokeStyle = "rgba(12,16,17,0.8)";
  h.strokeText(t, x, y);
  h.fillText(t, x, y);
  h.shadowBlur = 0;
}
function bar(
  x: number,
  y: number,
  width: number,
  value: number,
  color: string,
) {
  h.fillStyle = "#172638b0";
  h.fillRect(x - 1, y - 1, width + 2, 8);
  h.fillStyle = color;
  h.fillRect(x, y, width * Math.max(0, value), 6);
}
function drawHUD() {
  const w = hud.width,
    hh = hud.height,
    mobile = w < 700,
    p = game.player,
    e = game.enemy;
  h.clearRect(0, 0, w, hh);
  text("new0", mobile ? 20 : 30, mobile ? 43 : 45, 30);
  if (game.phase === "intro" || !$("#intro").classList.contains("hidden"))
    return;
  text(
    LOCATIONS[world.location].name.toUpperCase(),
    w - 20,
    35,
    mobile ? 8 : 10,
    "#d0dce7",
    "right",
  );
  const x = mobile ? 20 : 30,
    y = 75,
    bw = mobile ? 114 : 180;
  text("ПУТНИК", x, y - 8, 8);
  bar(x, y, bw, p.hp / 100, "#bd99ad");
  bar(x, y + 12, bw, p.stamina / 100, "#afbdcc");
  if (game.fighting || e.hp <= 0) {
    const ew = mobile ? 112 : 180,
      ex = w - ew - 20;
    text(ENEMIES[e.kind as EnemyKind].name, ex, y - 8, 8);
    bar(ex, y, ew, e.hp / e.maxHp, "#b9a8c1");
  }
  if (p.mode === "attack") text("I".repeat(p.combo), x, y + 34, 10, "#d1dae6");
  else if (p.mode === "guard") text("БЛОК", x, y + 34, 8);
  const weapon = WEAPONS[p.weapon];
  text(weapon.name.toUpperCase(), x, y + 50, 8, "#c9d7e7");
  text(
    `${p.armour ? "КИРАСА / защита 28%" : "ТКАНЬ"} / зелья ${game.flasks}/3`,
    x,
    y + 64,
    8,
    "#d7e0de",
  );
  text(
    `Монеты ${game.coins} / ключи ${game.keys.size}`,
    w - 20,
    hh - 20,
    9,
    "#c9d7e7",
    "right",
  );
  if (game.phase === "lost")
    text(
      "ПУТЬ ОБОРВАЛСЯ",
      w / 2,
      hh * 0.4,
      mobile ? 18 : 26,
      "#d2b9bc",
      "center",
    );
  if (toastValue)
    text(toastValue, w / 2, hh - 60, mobile ? 11 : 13, "#dae6f5", "center");
  if (autoplay && demonstration) {
    const progress = deviceCheck
      ? `${deviceCheck.index + 1}/4 / `
      : soak
        ? `Повтор ${soak.runs + 1}/6 / `
        : "";
    text(progress + demonstration.label, 20, hh - 39, mobile ? 9 : 11);
    if (deviceCheck)
      text(
        performanceText.split(" / ").slice(0, 2).join(" / "),
        20,
        hh - 56,
        9,
        "#b9c9dc",
      );
  }
}
function measureControlFit() {
  if (!input.touch) return;
  const boxes = [
    "#joystick",
    "#guard",
    "#dodge",
    "#attack",
    "#drop",
    "#heal",
    "#interact",
  ]
    .filter((s) => !$(s).classList.contains("hidden"))
    .map((s) => $(s).getBoundingClientRect());
  const inside = boxes.every(
    (r) =>
      r.width > 0 &&
      r.height > 0 &&
      r.left >= 0 &&
      r.top >= 0 &&
      r.right <= innerWidth + 1 &&
      r.bottom <= innerHeight + 1,
  );
  const overlap = boxes.some((a, i) =>
    boxes.some(
      (b, j) =>
        i < j &&
        Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
        Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top),
    ),
  );
  controlsFit = controlsFit && inside && !overlap;
}
function beginDeviceCheck() {
  if (!loaded || recording || deviceCheck || soak) return;
  errorBaseline = errors;
  contextBaseline = contextLosses;
  controlsFit = true;
  visible("#check-result", false);
  startScenario("journey");
  deviceCheck = new DeviceCheck();
}
$("#autoplay").onclick = beginDeviceCheck;
async function finishDeviceCheck(interrupted: boolean) {
  const current = deviceCheck;
  if (!current) return;
  if (interrupted)
    current.interrupt(
      game.completedAreas.has(game.location),
      world.resolution,
      world.resources(),
    );
  deviceCheck = null;
  paused = true;
  input.reset();
  input.enabled = false;
  const tg = window.Telegram?.WebApp;
  lastDeviceReport = {
    protocol: "device-check-3",
    asset_revision: ASSET_REVISION,
    client_revision: CLIENT_REVISION,
    platform:
      (tg?.initData ? tg.platform || "unknown" : "browser")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32) || "unknown",
    telegram_version: (tg?.version || "")
      .replace(/[^a-zA-Z0-9_.-]/g, "")
      .slice(0, 24),
    viewport_width: innerWidth,
    viewport_height: innerHeight,
    touch_points: navigator.maxTouchPoints,
    controls_fit: controlsFit,
    errors: errors - errorBaseline,
    context_losses: contextLosses - contextBaseline,
    interrupted,
    stages: current.stages,
  };
  const all =
    current.stages.length === 4 && current.stages.every((s) => s.completed);
  const summary = [
    interrupted
      ? "Проход прерван"
      : all
        ? "Четыре локации пройдены"
        : "Проход завершён не полностью",
    ...current.stages.map(
      (s) =>
        `${LOCATIONS[s.location].name}: ${s.fps.toFixed(1)} FPS / p95 ${s.p95_ms.toFixed(1)} мс${s.completed ? "" : " / не завершено"}`,
    ),
  ];
  $("#check-result").textContent = summary.join("\n");
  visible("#intro", true);
  visible("#check-result", true);
  visible("#touch-controls", false);
  const a = $<HTMLAnchorElement>("#check-download");
  if (a.href.startsWith("blob:")) URL.revokeObjectURL(a.href);
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(lastDeviceReport, null, 2)], {
      type: "application/json",
    }),
  );
  visible("#check-download", review && api.user.is_guest);
  try {
    await api.request("/diagnostics", lastDeviceReport);
    $("#check-result").textContent += "\nОтчёт сохранён";
  } catch {
    $("#check-result").textContent +=
      "\nОтчёт не отправлен. Повтори автопрохождение после проверки соединения.";
  }
}
async function stopRecording() {
  const current = capture;
  if (!current) return;
  capture = null;
  recording = false;
  paused = true;
  document.body.classList.remove("recording");
  $("#record").textContent = "Сохраняю…";
  try {
    const blob = await current.finish(),
      a = $<HTMLAnchorElement>("#download");
    if (a.href.startsWith("blob:")) URL.revokeObjectURL(a.href);
    a.href = URL.createObjectURL(blob);
    a.download = `new0-fixes2-${selected}-60fps.mp4`;
    visible("#download", true);
    const timeline = $<HTMLAnchorElement>("#record-timeline");
    if (timeline.href.startsWith("blob:")) URL.revokeObjectURL(timeline.href);
    timeline.href = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              protocol: "fixes2-capture-1",
              scenario: selected,
              asset_revision: ASSET_REVISION,
              client_revision: CLIENT_REVISION,
              accepted_frames: current.frames,
              simulation_hz: 60,
              real_time_fps_benchmark: false,
              marks: captureMarks,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    timeline.download = `new0-fixes2-${selected}-timeline.json`;
    visible("#record-timeline", true);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Запись прервана");
  }
  $("#record").textContent = "Записать проход";
}
async function beginRecording() {
  if (recording || deviceCheck || soak || !loaded) return;
  if (!("VideoEncoder" in window)) {
    toast("Для записи нужен браузер с WebCodecs");
    return;
  }
  $("#record").textContent = "Подготовка…";
  try {
    const { FrameCapture } = await import("./recording");
    recordCanvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / hud.width, 720 / hud.height);
    recordCanvas.width = Math.floor((hud.width * scale) / 2) * 2;
    recordCanvas.height = Math.floor((hud.height * scale) / 2) * 2;
    recordCtx = recordCanvas.getContext("2d", { alpha: false });
    capture = new FrameCapture(recordCanvas);
    await capture.start();
    startScenario(selected);
    captureMarks = [];
    captureMarkKey = "";
    recording = true;
    lastCapture = performance.now();
    document.body.classList.add("recording");
    visible("#download", false);
    visible("#record-timeline", false);
  } catch (error) {
    capture = null;
    recording = false;
    document.body.classList.remove("recording");
    $("#record").textContent = "Записать проход";
    toast(error instanceof Error ? error.message : "Кодек недоступен");
  }
}
$("#record").onclick = () => void beginRecording();
function frame(now: number) {
  raf = requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  const dt = recording
    ? capture && !capture.busy && now - lastCapture >= 1000 / 60
      ? 1 / 60
      : 0
    : Math.min(raw, 0.06);
  last = now;
  if (loaded && !paused && game.phase !== "intro") {
    accumulator += dt;
    while (accumulator >= 1 / 120) {
      const move = autoplay
        ? demonstration!.update(1 / 120)
        : { ...world.moveAxis(input.axis()), guard: input.guarding };
      game.update(1 / 120, move);
      accumulator -= 1 / 120;
    }
    if (autoplay && demonstration) {
      const a = 1 - Math.exp(-dt * 3.6);
      const delta = demonstration.cameraYaw - world.yaw;
      world.yaw += Math.atan2(Math.sin(delta), Math.cos(delta)) * a;
      world.pitch += (demonstration.cameraPitch - world.pitch) * a;
    }
    for (const e of game.events) {
      world.event(e);
      sound.play(
        e.type === "hit"
          ? "hit"
          : e.type === "block"
            ? "guard"
            : e.type === "win"
              ? "win"
              : e.type === "secret" || e.type === "weapon"
                ? "secret"
                : e.type === "dodge"
                  ? "step"
                  : "click",
      );
      if (e.label) toast(e.label);
    }
    game.events.length = 0;
    frames.push(raw * 1000);
    if (frames.length > 300) frames.shift();
    frameNumber++;
    if (demonstration?.done) finishedTail += dt;
  }
  world.render(paused ? 0 : dt);
  if (deviceCheck && !paused) {
    deviceCheck.update(
      raw * 1000,
      game.location,
      game.completedAreas,
      game.phase === "finished" && finishedTail > 0.35,
      world.resolution,
      world.resources(),
    );
    if (deviceCheck.done) void finishDeviceCheck(game.phase !== "finished");
  }
  if (soak && !paused && demonstration?.done && finishedTail > 1) {
    soak.snapshots.push(world.resources());
    soak.completed.push(
      game.phase === "finished" && game.completedAreas.size === 4,
    );
    soak.runs++;
    if (soak.runs < 6) startScenario("journey");
    else {
      const report = {
        protocol: "resource-soak-2",
        asset_revision: ASSET_REVISION,
        client_revision: CLIENT_REVISION,
        scenario: "journey",
        physical_phone_benchmark: false,
        runs: soak.runs,
        snapshots: soak.snapshots,
        completed: soak.completed,
        errors,
        context_losses: contextLosses,
      };
      const a = $<HTMLAnchorElement>("#soak-download");
      if (a.href.startsWith("blob:")) URL.revokeObjectURL(a.href);
      a.href = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        }),
      );
      soak = null;
      paused = true;
      visible("#soak-download", true);
      visible("#intro", true);
      $("#check-result").textContent =
        "Шесть полных повторов завершены. Отчёт ресурсов готов.";
      visible("#check-result", true);
    }
  }
  drawNoise(recording && capture ? (capture.frames / 60) * 1000 + 1000 : now);
  drawHUD();
  if (
    recording &&
    recordCanvas &&
    recordCtx &&
    capture &&
    !capture.busy &&
    dt > 0
  ) {
    lastCapture = now - ((now - lastCapture) % (1000 / 60));
    recordCtx.drawImage(
      world.renderer.domElement,
      0,
      0,
      recordCanvas.width,
      recordCanvas.height,
    );
    recordCtx.globalCompositeOperation = "soft-light";
    recordCtx.globalAlpha = 0.16;
    recordCtx.drawImage(
      atmosphere,
      0,
      0,
      recordCanvas.width,
      recordCanvas.height,
    );
    recordCtx.globalAlpha = 1;
    recordCtx.globalCompositeOperation = "source-over";
    recordCtx.drawImage(hud, 0, 0, recordCanvas.width, recordCanvas.height);
    const current = capture;
    const mark = {
      seconds: current.frames / 60,
      label: demonstration?.label ?? "",
      area: game.location,
      phase: game.phase,
      weapon: game.player.weapon,
      armour: game.player.armour,
      hp: game.player.hp,
      doors: game.openDoors.size,
      chests: game.lootedChests.size,
      frame: current.frames,
      player_action: game.player.mode,
      combo: game.player.combo,
      enemy_action: game.enemy.mode,
      enemy_kind: game.enemy.kind,
      enemy_hp: game.enemy.hp,
      dodge_side: game.player.mode === "dodge" ? game.player.dodgeSide : "",
    };
    const key = JSON.stringify({ ...mark, seconds: 0, frame: 0 });
    if (key !== captureMarkKey) {
      captureMarks.push(mark);
      captureMarkKey = key;
    }
    void current
      .add()
      .then(() => {
        if (
          current === capture &&
          (current.frames >= captureLimit() * 60 || finishedTail > 1.2)
        )
          void stopRecording();
      })
      .catch((error) => {
        toast(error instanceof Error ? error.message : "Запись прервана");
        void stopRecording();
      });
  }
  if (now - uiTick > 150) {
    uiTick = now;
    $("#world").setAttribute(
      "aria-label",
      `${LOCATIONS[world.location].name}. ${ENEMIES[game.enemy.kind as EnemyKind].name}. ${WEAPONS[game.player.weapon].name}. Здоровье ${Math.round(game.player.hp)}. Броня ${game.player.armour ? "кираса хранителя" : "нет"}. Зелья ${game.flasks}. Монеты ${game.coins}. Ключи ${game.keys.size}. Сундуки ${game.lootedChests.size}. ${game.phase === "finished" ? "Путь пройден" : game.phase === "lost" ? "Путник погиб" : "Демо"}`,
    );
    visible(
      "#touch-controls",
      input.touch &&
        !paused &&
        !["intro", "lost", "finished"].includes(game.phase),
    );
    visible(
      "#drop",
      input.touch &&
        (!autoplay || !!deviceCheck) &&
        !paused &&
        !["intro", "lost", "finished"].includes(game.phase) &&
        game.player.weapon !== "unarmed",
    );
    visible(
      "#interact",
      !!game.nearby && (!autoplay || !!deviceCheck) && !paused,
    );
    visible(
      "#heal",
      input.touch &&
        (!autoplay || !!deviceCheck) &&
        !paused &&
        !["intro", "lost", "finished"].includes(game.phase),
    );
    $<HTMLButtonElement>("#heal").disabled =
      game.flasks === 0 ||
      game.player.hp >= game.player.maxHp ||
      !["idle", "move", "guard"].includes(game.player.mode);
    $("#heal").textContent = `Выпить зелье / ${game.flasks}`;
    $("#interact").textContent = game.nearby;
    if (deviceCheck && game.phase !== "finished") measureControlFit();
    $("#guard").setAttribute(
      "aria-pressed",
      String(game.player.mode === "guard"),
    );
    $("#guard").classList.toggle(
      "locked",
      game.player.mode === "attack" || game.guardCooldown > 0,
    );
    $("#guard").setAttribute(
      "aria-label",
      game.guardCooldown > 0
        ? `Блок восстанавливается / ${game.guardCooldown.toFixed(1)} с`
        : "Блок",
    );
    $("#guard").style.setProperty(
      "--cooldown",
      String(Math.min(1, game.guardCooldown / BLOCK.cooldown)),
    );
    if (toastValue && now > toastUntil) {
      visible("#toast", false);
      toastValue = "";
    }
    if (frames.length > 30) {
      const sorted = [...frames].sort((a, b) => a - b),
        avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      performanceText = `${(1000 / avg).toFixed(1)} FPS / p95 ${sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(1)} мс / ${world.renderer.info.render.calls} calls / ${Math.round(world.renderer.info.render.triangles / 1000)}k tris`;
      if (review) {
        const r = world.resources();
        $("#performance").textContent =
          performanceText +
          ` / G${r.geometries} T${r.textures} P${r.programs} M${r.models}`;
      }
      if (
        !recording &&
        frameNumber > 180 &&
        now - lastQualityChange > 2500 &&
        avg > 19 &&
        world.resolution > 0.66
      ) {
        world.resolution = Math.max(0.65, world.resolution * 0.9);
        world.resize();
        lastQualityChange = now;
      }
    }
  }
}
async function boot() {
  let connecting = true;
  try {
    const tg = window.Telegram?.WebApp?.initData
      ? window.Telegram.WebApp
      : undefined;
    tg?.ready();
    tg?.expand();
    tg?.disableVerticalSwipes?.();
    tg?.setHeaderColor?.("#253442");
    tg?.setBackgroundColor?.("#253442");
    tg?.onEvent?.("deactivated", pause);
    if (tg?.platform === "ios" || tg?.platform === "android") {
      input.touch = true;
      document.body.classList.add("is-touch");
    }
    $("#autoplay").textContent = "Подключение…";
    await api.connect(tg?.initData ?? "");
    connecting = false;
    $("#autoplay").textContent = "Загрузка сцены…";
    const [, faces] = await Promise.all([
      world.load(),
      document.fonts.load('16px "Ebbe Black"'),
    ]);
    if (!faces.length) throw new Error("Не удалось загрузить шрифт игры");
    world.resetView();
    loaded = true;
    $("#performance").title = world.device;
    $<HTMLButtonElement>("#autoplay").disabled = false;
    $("#autoplay").textContent = "Автопрохождение";
    visible("#review", review && api.user.is_guest);
  } catch (error) {
    fatal(
      connecting
        ? `Не удалось завершить вход. ${error instanceof Error ? error.message : "Повтори подключение"}`
        : "Не удалось загрузить 3D-сцену. Проверь соединение и повтори загрузку.",
    );
  }
}
raf = requestAnimationFrame(frame);
window.addEventListener("pagehide", () => {
  cancelAnimationFrame(raf);
  void stopRecording().finally(() => world.dispose());
  for (const id of ["#download", "#check-download", "#soak-download"]) {
    const a = $<HTMLAnchorElement>(id);
    if (a.href.startsWith("blob:")) URL.revokeObjectURL(a.href);
  }
});
void boot();

window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
