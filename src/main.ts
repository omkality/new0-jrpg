import "./style.css";
import { CombatGame } from "./game";
import { Input } from "./input";
import { World } from "./world";
import { Sound } from "./audio";
import { API } from "./api";

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
let paused = false,
  loaded = false,
  last = performance.now(),
  accumulator = 0,
  uiTick = 0;
let recording = false,
  recorder: MediaRecorder | null = null,
  recordCanvas: HTMLCanvasElement | null = null,
  recordCtx: CanvasRenderingContext2D | null = null;
let autoplay = false,
  autoTime = 0,
  autoLastAttack = -5,
  autoLastDodge = -5,
  wonAt = 0;
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
  game.start();
  paused = false;
  autoplay = false;
  world.yaw = 0;
  world.pitch = 0.08;
  input.reset();
  input.enabled = true;
  visible("#intro", false);
  visible("#pause-panel", false);
  visible("#ending", false);
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
}
window.addEventListener("resize", resizeHUD);
resizeHUD();
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
    hudText("ХРАНИТЕЛЬ", ex, y - 9, mobile ? 8 : 9);
    bar(ex, y, ew, e.hp / 80, "#b99a85");
    if (e.mode === "windup")
      hudText("ЗАМАХ", ex, y + 27, mobile ? 8 : 10, "#ffe2a8");
  }
  const hints = input.touch
    ? [
        "Сдвинь стик и пройди вперёд",
        "Коснись «Удар»",
        "Коснись «Шаг», чтобы уклониться",
        "Подойди к стражу. Двигайся между ударами",
      ]
    : [
        "WASD · движение. Потяни мышью для обзора",
        "Клик мышью · удар мечом",
        "Пробел · быстрый шаг в сторону движения",
        "Подойди к стражу. Уклоняйся от замаха",
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
  if (recording) {
    hudText("new0 · Нулевой архив", w - 25, hh - 24, 11, "#f3f2e1", "right");
  }
}

function autoControl(dt: number) {
  autoTime += dt;
  const p = game.player,
    e = game.enemy;
  if (game.phase === "won") {
    if (!wonAt) wonAt = autoTime;
    if (autoTime - wonAt < 2.2) return { x: 0, z: 0, guard: false };
    const dx = -p.x,
      dz = -7 - p.z,
      d = Math.hypot(dx, dz);
    if (d < 0.5) {
      game.interact();
      return { x: 0, z: 0, guard: false };
    }
    return { x: dx / d, z: dz / d, guard: false };
  }
  if (autoTime < 1.0) return { x: 0, z: -1, guard: false };
  if (autoTime < 1.2) {
    if (autoLastAttack < 0) {
      game.attack();
      autoLastAttack = autoTime;
    }
    return { x: 0, z: 0, guard: false };
  }
  if (autoTime < 1.8) {
    if (autoLastDodge < 0) {
      game.dodge({ x: 1, z: 0 });
      autoLastDodge = autoTime;
    }
    return { x: 0, z: 0, guard: false };
  }
  const dx = e.x - p.x,
    dz = e.z - p.z,
    d = Math.hypot(dx, dz);
  if (e.mode === "windup" && e.time > 0.65 && autoTime - autoLastDodge > 1.2) {
    game.dodge({ x: 1, z: 0.15 });
    autoLastDodge = autoTime;
  }
  if (
    d < 1.9 &&
    autoTime - autoLastAttack > 1.02 &&
    e.mode !== "windup" &&
    p.mode !== "dodge"
  ) {
    game.attack();
    autoLastAttack = autoTime;
  }
  if (e.mode === "windup" || p.mode === "dodge" || p.mode === "attack")
    return { x: 0, z: 0, guard: false };
  return d > 1.55
    ? { x: dx / d, z: dz / d, guard: false }
    : { x: 0, z: 0, guard: false };
}
function beginShowcase() {
  start();
  autoplay = true;
  autoTime = 0;
  autoLastAttack = autoLastDodge = -5;
  wonAt = 0;
}
$("#showcase").onclick = beginShowcase;

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
}
function beginRecording() {
  if (recording) return;
  if (!("MediaRecorder" in window)) {
    toast("Этот браузер не поддерживает запись canvas");
    return;
  }
  recordCanvas = document.createElement("canvas");
  const scale = Math.min(1, 1280 / hud.width, 720 / hud.height);
  recordCanvas.width = Math.floor((hud.width * scale) / 2) * 2;
  recordCanvas.height = Math.floor((hud.height * scale) / 2) * 2;
  recordCtx = recordCanvas.getContext("2d", { alpha: false });
  const mime = [
    "video/mp4;codecs=avc1.42E01E",
    "video/webm;codecs=h264",
    "video/webm;codecs=vp8",
  ].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) {
    toast("Нет доступного видеокодека");
    return;
  }
  const chunks: Blob[] = [];
  recorder = new MediaRecorder(recordCanvas.captureStream(60), {
    mimeType: mime,
    videoBitsPerSecond: 7_000_000,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime }),
      a = $<HTMLAnchorElement>("#download");
    a.href = URL.createObjectURL(blob);
    a.download = `new0-realtime-demo.${mime.includes("mp4") ? "mp4" : "webm"}`;
    visible("#download", true);
    recording = false;
    $("#record").textContent = "Записать 20 секунд";
    recorder?.stream.getTracks().forEach((t) => t.stop());
  };
  beginShowcase();
  recording = true;
  $("#record").textContent = "Идёт запись…";
  visible("#download", false);
  recorder.start(1000);
  setTimeout(stopRecording, 20000);
}
$("#record").onclick = beginRecording;

function frame(now: number) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000,
    dt = Math.min(raw, 0.06);
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
  drawHUD();
  if (
    recording &&
    recordCanvas &&
    recordCtx &&
    now - lastCapture >= 1000 / 60
  ) {
    lastCapture = now - ((now - lastCapture) % (1000 / 60));
    recordCtx.drawImage(
      world.renderer.domElement,
      0,
      0,
      recordCanvas.width,
      recordCanvas.height,
    );
    recordCtx.drawImage(hud, 0, 0, recordCanvas.width, recordCanvas.height);
  }
  if (now - uiTick > 150) {
    uiTick = now;
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
    const tg = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : undefined;
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
