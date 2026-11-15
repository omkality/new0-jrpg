import "./style.css";
import { CombatGame, ENEMIES, type EnemyKind } from "./game";
import { Input } from "./input";
import { World } from "./world";
import { Sound } from "./audio";
import { API } from "./api";
import { Showcase } from "./showcase";
import type { FrameCapture } from "./recording";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
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
const game = new CombatGame(),
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
let lastNoise = 0;
let paused = false,
  loaded = false,
  last = performance.now(),
  accumulator = 0,
  uiTick = 0;
let recording = false,
  capture: FrameCapture | null = null,
  recordCanvas: HTMLCanvasElement | null = null,
  recordCtx: CanvasRenderingContext2D | null = null;
let autoplay = false;
let demonstration: Showcase | null = null;
let toastUntil = 0,
  toastValue = "";
let frames: number[] = [],
  frameNumber = 0;
let performanceText = "";
let lastCapture = 0,
  lastQualityChange = 0;
const review = new URLSearchParams(location.search).get("review") === "1";

function toast(t: string) {
  toastValue = t;
  toastUntil = performance.now() + 2800;
  $("#toast").textContent = t;
  visible("#toast", true);
}
function start() {
  game.start($<HTMLSelectElement>("#encounter").value as EnemyKind);
  paused = false;
  autoplay = false;
  demonstration = null;
  world.yaw = 0;
  world.pitch = 0.08;
  input.reset();
  input.enabled = true;
  visible("#intro", false);
  visible("#pause-panel", false);
  visible("#ending", false);
  $('#world').focus({preventScroll:true});
  frames = [];
  accumulator = 0;
  last = performance.now();
}
function pause() {
  if (!loaded || game.phase === "intro") return;
  paused = !paused;
  input.reset();
  input.enabled = !paused;
  visible("#pause-panel", paused);
  if (paused) sound.suspend();
  else sound.resume();
}
input.onPause = pause;
input.onAttack = () => game.attack();
input.onInteract = () => game.interact();
input.onDodge = () => game.dodge(world.moveAxis(input.axis()));
input.onLock = () => {
  game.lock = !game.lock;
  toast(game.lock ? "Цель захвачена" : "Свободное движение");
};
input.onLook = (x, y) => world.orbit(x, y);
input.bindLook($("#world"));
input.bindGuard($("#guard"));
$("#review-enemy").onchange = () => {
  $<HTMLSelectElement>("#encounter").value =
    $<HTMLSelectElement>("#review-enemy").value;
  start();
};
$("#encounter").onchange = () => {
  $<HTMLSelectElement>("#review-enemy").value =
    $<HTMLSelectElement>("#encounter").value;
  if (game.phase === "intro") {
    const kind = $<HTMLSelectElement>("#encounter").value as EnemyKind;
    game.enemy.kind = kind;
    game.enemy.hp = game.enemy.maxHp = ENEMIES[kind].hp;
  }
};
$("#start").onclick = start;
$("#pause").onclick = pause;
$("#resume").onclick = pause;
$("#restart").onclick = start;
$("#retry").onclick = start;
$("#attack").onclick = () => game.attack();
$("#dodge").onclick = () => game.dodge(world.moveAxis(input.axis()));
$("#interact").onclick = () => game.interact();
$<HTMLInputElement>("#brightness").oninput = (e) => {
  world.renderer.toneMappingExposure = Number(
    (e.target as HTMLInputElement).value,
  );
};
$("#sound").onclick = () =>
  void sound.toggle().then((on) => {
    $("#sound").setAttribute(
      "aria-label",
      on ? "Выключить звук" : "Включить звук",
    );
    $("#sound").textContent = on ? "♫" : "♪";
  });
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.phase !== "intro" && !paused) {
    pause();
    stopRecording();
  }
});
window.addEventListener("game-context-lost", () =>
  fatal("Графика была приостановлена. Перезагрузи страницу"),
);
function fatal(t: string) {
  $("#fatal-text").textContent = t;
  visible("#fatal", true);
}

function resizeHUD() {
  hud.width = innerWidth;
  hud.height = innerHeight;
  atmosphere.width = innerWidth;
  atmosphere.height = innerHeight;
  lastNoise = 0;
}
window.addEventListener("resize", resizeHUD);
resizeHUD();
function drawNoise(now: number) {
  if (now - lastNoise < 125) return;
  lastNoise = now;
  const step = Math.floor(now / 125),
    x = (step * 29) % 128,
    y = (step * 47) % 128;
  noiseCtx.setTransform(1, 0, 0, 1, x, y);
  noiseCtx.fillStyle = noisePattern;
  noiseCtx.fillRect(
    -128,
    -128,
    atmosphere.width + 256,
    atmosphere.height + 256,
  );
  noiseCtx.setTransform(1, 0, 0, 1, 0, 0);
}
function bar(x: number, y: number, w: number, value: number, color: string) {
  h.fillStyle = "#1e2b29b8";
  h.fillRect(x - 1, y - 1, w + 2, 9);
  h.fillStyle = color;
  h.fillRect(x, y, w * Math.max(0, value), 7);
}
function hudText(
  t: string,
  x: number,
  y: number,
  size = 12,
  color = "#f4f3e4",
  align: CanvasTextAlign = "left",
) {
  h.font = `${size}px Arial`;
  h.textAlign = align;
  h.fillStyle = color;
  h.shadowColor = "#152321a0";
  h.shadowBlur = 4;
  h.fillText(t, x, y);
  h.shadowBlur = 0;
}
function drawHUD() {
  const w = hud.width,
    hh = hud.height,
    mobile = input.touch || w < 700,
    p = game.player,
    e = game.enemy;
  h.clearRect(0, 0, w, hh);
  if (game.phase === "intro") return;
  const x = mobile ? 20 : 32,
    y = mobile ? 85 : 95,
    bw = mobile ? 136 : 215;
  hudText("ПУТНИК", x, y - 9, mobile ? 8 : 9);
  bar(x, y, bw, p.hp / 100, "#c3a8a0");
  bar(x, y + 14, bw, p.stamina / 100, "#bdcaa6");
  hudText(`${Math.ceil(p.hp)} / 100`, x + bw + 8, y + 7, mobile ? 8 : 10);
  if (game.fighting || e.hp <= 0) {
    const ew = mobile ? 110 : 205,
      ex = w - ew - (mobile ? 20 : 32);
    hudText(ENEMIES[e.kind as EnemyKind].name, ex, y - 9, mobile ? 8 : 9);
    bar(ex, y, ew, e.hp / e.maxHp, "#b99a85");
    if (e.mode === "windup")
      hudText("ЗАМАХ", ex, y + 27, mobile ? 8 : 10, "#ffe2a8");
  }
  if (p.mode === "attack")
    hudText(
      `ЦЕПОЧКА  ${"I".repeat(p.combo)}${p.chain > p.combo ? "  →  " + "I".repeat(p.chain) : ""}`,
      x,
      y + 39,
      mobile ? 8 : 10,
      "#ded8bd",
    );
  else if (p.mode === "guard")
    hudText("БЛОК", x, y + 39, mobile ? 8 : 10, "#bdcbb4");
  const hints = input.touch
    ? [
        "Сдвинь стик и пройди вперёд",
        "Коснись «Удар»",
        "Коснись «Шаг», чтобы уклониться",
        "Повторные удары продолжают цепочку. Блок удерживай",
      ]
    : [
        "WASD · движение. Потяни мышью для обзора",
        "Клик мышью · удар мечом",
        "Пробел · быстрый шаг в сторону движения",
        "До трёх кликов: комбо. Блок доступен после цепочки",
      ];
  let hint =
    game.phase === "won"
      ? "Путь открыт. Исследуй зал или пройди к арке"
      : hints[game.tutorial];
  if (game.phase === "lost") hint = "Сигнал гаснет…";
  if (hint && game.phase !== "finished") {
    const maxWidth = w - 35;
    h.font = `${mobile ? 10 : 12}px Arial`;
    const tw = Math.min(maxWidth, h.measureText(hint).width + 32),
      hy = mobile ? 156 : 148;
    h.fillStyle = "#263d34b8";
    h.fillRect((w - tw) / 2, hy - 18, tw, 31);
    hudText(hint, w / 2, hy + 2, mobile ? 10 : 12, "#f4f3df", "center");
  }
  if (!mobile) {
    hudText(
      "КЛИК  удар     ПРОБЕЛ  уклонение     ПКМ  блок     E  исследовать",
      w / 2,
      hh - 28,
      10,
      "#f3f2e1",
      "center",
    );
    hudText(
      `ОТГОЛОСКИ   ${game.secrets.size} / 2`,
      w - 32,
      hh - 28,
      10,
      "#e1e6d6",
      "right",
    );
  }
  if (review && autoplay && demonstration)
    hudText(
      demonstration.label,
      w / 2,
      hh - (mobile ? 190 : 51),
      mobile ? 10 : 12,
      "#d6d6c0",
      "center",
    );
  if (recording) {
    hudText("new0 · Нулевой архив", w - 25, hh - 10, 9, "#b9c3b1", "right");
  }
}

function autoControl(dt: number) {
  return demonstration?.update(dt) ?? { x: 0, z: 0, guard: false };
}
function beginShowcase() {
  start();
  autoplay = true;
  demonstration = new Showcase(game);
}
$("#showcase").onclick = beginShowcase;

async function stopRecording() {
  const current = capture;
  if (!current) return;
  capture = null;
  recording = false;
  $("#record").textContent = "Сохраняю запись…";
  try {
    const blob = await current.finish(),
      a = $<HTMLAnchorElement>("#download");
    if (a.href.startsWith("blob:")) URL.revokeObjectURL(a.href);
    a.href = URL.createObjectURL(blob);
    a.download = "new0-atmosphere-combo.mp4";
    visible("#download", true);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Запись прервана");
  }
  $("#record").textContent = "Записать 20 секунд";
}
async function beginRecording() {
  if (recording) return;
  if (!("VideoEncoder" in window)) {
    toast("Для записи нужен браузер с WebCodecs");
    return;
  }
  $("#record").textContent = "Подготовка записи…";
  try {
    const { FrameCapture } = await import("./recording");
    recordCanvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / hud.width, 720 / hud.height);
    recordCanvas.width = Math.floor((hud.width * scale) / 2) * 2;
    recordCanvas.height = Math.floor((hud.height * scale) / 2) * 2;
    recordCtx = recordCanvas.getContext("2d", { alpha: false });
    capture = new FrameCapture(recordCanvas);
    await capture.start();
    beginShowcase();
    recording = true;
    lastCapture = performance.now();
    $("#record").textContent = "Идёт запись…";
    visible("#download", false);
  } catch (error) {
    capture = null;
    recording = false;
    $("#record").textContent = "Записать 20 секунд";
    toast(error instanceof Error ? error.message : "Кодек недоступен");
  }
}
$("#record").onclick = () => void beginRecording();

function frame(now: number) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000,
    dt = recording
      ? capture && !capture.busy && now - lastCapture >= 1000 / 60
        ? 1 / 60
        : 0
      : Math.min(raw, 0.06);
  last = now;
  if (loaded && !paused && game.phase !== "intro") {
    accumulator += dt;
    while (accumulator >= 1 / 120) {
      const move = autoplay
        ? autoControl(1 / 120)
        : { ...world.moveAxis(input.axis()), guard: input.guarding };
      game.update(1 / 120, move);
      accumulator -= 1 / 120;
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
              : e.type === "secret"
                ? "secret"
                : e.type === "dodge"
                  ? "step"
                  : "click",
      );
      if (e.type === "secret") toast("Отголосок найден");
    }
    game.events.length = 0;
    frames.push(raw * 1000);
    if (frames.length > 300) frames.shift();
    frameNumber++;
  }
  world.render(paused ? 0 : dt);
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
    void current
      .add()
      .then(() => {
        if (current === capture && current.frames >= 1200) void stopRecording();
      })
      .catch((error) => {
        toast(error instanceof Error ? error.message : "Запись прервана");
        void stopRecording();
      });
  }
  if (now - uiTick > 150) {
    uiTick = now;
    if (recording && capture)
      $("#record").textContent =
        `Запись ${Math.floor(capture.frames / 60)} / 20 с`;
    visible(
      "#touch-controls",
      input.touch &&
        !paused &&
        game.phase !== "intro" &&
        game.phase !== "lost" &&
        game.phase !== "finished",
    );
    visible("#interact", !!game.nearby && !paused);
    $("#interact").textContent = (input.touch ? "✧ · " : "E · ") + game.nearby;
    $("#guard").setAttribute(
      "aria-pressed",
      String(game.player.mode === "guard"),
    );
    $("#guard").classList.toggle("locked", game.player.mode === "attack");
    if (toastValue && now > toastUntil) {
      visible("#toast", false);
      toastValue = "";
    }
    if (
      (game.phase === "lost" && game.player.time > 2) ||
      game.phase === "finished"
    ) {
      visible("#ending", true);
      input.enabled = false;
      const lost = game.phase === "lost";
      $("#ending-label").textContent = lost ? "СИГНАЛ ПОГАС" : "КОНЕЦ ДЕМКИ";
      $("#ending-title").textContent = lost ? "Ещё один шаг" : "Свет за аркой";
      $("#ending-text").textContent = lost
        ? "Перед ударом страж делает заметный замах. Можно отойти, уклониться или поставить блок."
        : "Ты прошёл зал и открыл путь. Следы ещё хранятся в камне.";
    }
    if (frames.length > 30) {
      const sorted = [...frames].sort((a, b) => a - b),
        avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      performanceText = `${(1000 / avg).toFixed(1)} FPS · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms · ${world.renderer.info.render.calls} calls · ${Math.round(world.renderer.info.render.triangles / 1000)}k tris`;
      if (review) $("#performance").textContent = performanceText;
      if (
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
  try {
    const tg = window.Telegram?.WebApp?.initData
      ? window.Telegram.WebApp
      : undefined;
    tg?.ready();
    tg?.expand();
    tg?.disableVerticalSwipes?.();
    tg?.setHeaderColor?.("#343d3b");
    tg?.setBackgroundColor?.("#343d3b");
    tg?.onEvent?.("deactivated", () => {
      if (!paused && game.phase !== "intro") pause();
    });
    await Promise.all([world.load(), api.connect(tg?.initData ?? "")]);
    loaded = true;
    $("#performance").title = world.device;
    $<HTMLButtonElement>("#start").disabled = false;
    $("#start").textContent = "Войти в архив ↗";
    visible("#review", review && api.user.is_guest);
  } catch (error) {
    fatal(
      error instanceof Error ? error.message : "Не удалось загрузить сцену",
    );
  }
}
requestAnimationFrame(frame);
void boot();
