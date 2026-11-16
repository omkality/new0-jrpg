// Lab only. Production source remains untouched. Do not call this an iPhone benchmark.
import * as T from "three";
import fixtureText from "./world-lab.ts?raw";
import fixturePage from "./world-lab.html?raw";
import { Campaign } from "../../../src/campaign";
import { CampaignShowcase } from "../../../src/journey";
import { World } from "../../../src/world";
import { ASSET_REVISION, CLIENT_REVISION } from "../../../src/assets";
declare const __RESOURCE_FIXTURE_REVISION__: string;
const fixtureRevision =
  typeof __RESOURCE_FIXTURE_REVISION__ === "string"
    ? __RESOURCE_FIXTURE_REVISION__
    : [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(fixturePage + fixtureText),
          ),
        ),
      ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 16);
const $ = <E extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<E>(s)!;
const flag = (s: string) => $<HTMLInputElement>(s).checked;
const game = new Campaign(),
  world = new World($<HTMLCanvasElement>("#view"), game);
type Buckets = Record<string, number[]>;
let current: Buckets = {},
  frameTotals: Record<string, number> = {},
  last = performance.now(),
  frame = 0,
  running = false,
  route: CampaignShowcase,
  run = 0,
  targetRuns = 1,
  tail = 0,
  accumulator = 0,
  lastUI = 0;
let simulatedSeconds = 0,
  renderedFrames = 0,
  lastReport = 0;
let started = 0,
  stage = game.location,
  stages: any[] = [],
  runs: any[] = [],
  startResources: any;
let matrixWorldCalls = 0,
  matrixLocalCalls = 0,
  runMatrixWorldCalls = 0,
  runMatrixLocalCalls = 0;
const originalWorld = T.Object3D.prototype.updateWorldMatrix,
  originalLocal = T.Object3D.prototype.updateMatrixWorld;
let counting = false;
const diagnostics = {
  errors: [] as { type: string; message: string }[],
  total_errors: 0,
  webgl_context_losses: 0,
  webgl_context_restores: 0,
};
const health = () => {
  $("#health").textContent = JSON.stringify(diagnostics);
};
function fault(type: string, value: unknown) {
  diagnostics.total_errors++;
  if (diagnostics.errors.length < 32)
    diagnostics.errors.push({ type, message: String(value) });
  health();
  $("#status").textContent =
    "Ошибка исполнения. Прогон не подтверждает стабильность.";
  if (running) {
    running = false;
    showReport();
  }
}
window.addEventListener("error", (event) => fault("javascript", event.message));
window.addEventListener("unhandledrejection", (event) =>
  fault("unhandled_rejection", event.reason?.stack ?? event.reason),
);
$("#view").addEventListener("webglcontextlost", () => {
  diagnostics.webgl_context_losses++;
  fault("webgl_context_lost", "WebGL context was lost");
});
$("#view").addEventListener("webglcontextrestored", () => {
  diagnostics.webgl_context_restores++;
  health();
});
health();
const actorFrustum = (world as any).actorFrustum as T.Frustum;
const originalIntersects = actorFrustum.intersectsSphere.bind(actorFrustum);
let previousActorRadius = false;
$("#previousRadius").onchange = () => {
  previousActorRadius = flag("#previousRadius");
};
actorFrustum.intersectsSphere = (sphere) =>
  previousActorRadius || originalIntersects(sphere);
$("#matrices").onchange = () => {
  counting = flag("#matrices");
  T.Object3D.prototype.updateWorldMatrix = counting
    ? function (...args) {
        matrixWorldCalls++;
        return originalWorld.apply(this, args);
      }
    : originalWorld;
  T.Object3D.prototype.updateMatrixWorld = counting
    ? function (...args) {
        matrixLocalCalls++;
        return originalLocal.apply(this, args);
      }
    : originalLocal;
};
const add = (key: string, n: number) => {
  const a = (current[key] ??= []);
  if (a.length < 15000) a.push(n);
};
const total = (key: string, n: number) => {
  frameTotals[key] = (frameTotals[key] ?? 0) + n;
};
const timing = (object: any, key: string, label: string) => {
  const original = object[key];
  object[key] = function (...args: any[]) {
    const a = performance.now();
    const result = original.apply(this, args);
    if (running) total(label, performance.now() - a);
    return result;
  };
};
// Optional asynchronous GPU timing, no gl.finish and at most three pending queries.
const gl = world.renderer.getContext() as WebGL2RenderingContext;
const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
const gpu: { q: WebGLQuery; run: number; stage: string }[] = [];
const originalDraw = world.renderer.render.bind(world.renderer);
world.renderer.render = (scene: T.Object3D, camera: T.Camera) => {
  const disabled: T.Light[] = [];
  if (flag("#lights"))
    world.scene.traverse((o) => {
      if (o instanceof T.PointLight || o instanceof T.SpotLight) {
        if (o.visible) {
          disabled.push(o);
          o.visible = false;
        }
      }
    });
  if (flag("#local"))
    for (const [id, actor] of (world as any).actors) {
      const f = game.enemies.get(id);
      if (f && f.area !== game.location && Math.abs(f.z - game.player.z) > 6.5)
        actor.root.visible = false;
    }
  let q: WebGLQuery | null = null;
  if (running && ext && frame % 30 === 0 && gpu.length < 3) {
    q = gl.createQuery();
    if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
  }
  const a = performance.now();
  originalDraw(scene, camera);
  if (running) add("renderer_submit_cpu_ms", performance.now() - a);
  if (q && ext) {
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gpu.push({ q, run, stage: game.location });
  }
  for (const light of disabled) light.visible = true;
};
function pollGPU() {
  for (let i = gpu.length - 1; i >= 0; i--) {
    const p = gpu[i];
    if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) continue;
    if (
      ext &&
      !gl.getParameter(ext.GPU_DISJOINT_EXT) &&
      p.run === run &&
      p.stage === game.location &&
      running
    )
      add("gpu_ms", gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(p.q);
    gpu.splice(i, 1);
  }
}
function summary(values: number[] = []) {
  const a = [...values].sort((x, y) => x - y);
  return {
    samples: a.length,
    mean: a.length ? a.reduce((s, v) => s + v, 0) / a.length : null,
    p50: a[Math.floor(a.length * 0.5)] ?? null,
    p95: a[Math.max(0, Math.ceil(a.length * 0.95) - 1)] ?? null,
    max: a.at(-1) ?? null,
  };
}
function flags() {
  return {
    current_area_only: flag("#local"),
    freeze_npc: flag("#freeze"),
    no_local_lights: flag("#lights"),
    matrix_counting: counting,
    previous_actor_radius: previousActorRadius,
    simulation_step: $<HTMLSelectElement>("#speed").value,
  };
}
function snapshot() {
  const f = (performance as any).memory;
  return {
    ...world.resources(),
    heap_limit_mb: f ? f.jsHeapSizeLimit / 1048576 : null,
    render_calls: world.renderer.info.render.calls,
    triangles: world.renderer.info.render.triangles,
  };
}
function commitStage() {
  const counters: any = {};
  for (const [k, v] of Object.entries(current))
    counters[k] = {
      unit: k.endsWith("_ms") ? "ms" : "calls_per_frame",
      ...summary(v),
    };
  stages.push({
    area: stage,
    counters,
    resources: snapshot(),
    matrix_world_calls: runMatrixWorldCalls,
    matrix_local_calls: runMatrixLocalCalls,
  });
  current = {};
  runMatrixWorldCalls = runMatrixLocalCalls = 0;
}
function report() {
  return {
    protocol: "fixes2-world-lab-2",
    fixture: "tracked-browser-resource-lab",
    fixture_revision: fixtureRevision,
    asset_revision: ASSET_REVISION,
    client_revision: CLIENT_REVISION,
    diagnostics,
    simulation_input_hz: 120,
    fast_simulation_seconds_per_render: 12,
    fast_sampling_policy:
      "Up to 12 simulated seconds per rendered frame, ending early at area/equipment/inspection/heal/door/chest/mimic/death/drop/light-anchor or range boundaries. Short combat poses can be skipped. Ordinary 120 Hz input and collision steps.",
    renderer: world.device,
    viewport: { width: innerWidth, height: innerHeight },
    backbuffer: {
      width: world.renderer.domElement.width,
      height: world.renderer.domElement.height,
    },
    physical_iphone_benchmark: false,
    mode: targetRuns > 1 ? "restart-resource-test" : "normal-input-tour",
    limits:
      "World and Campaign only, excludes main.ts HUD, noise soft-light compositing and audio. Accelerated modes are not realtime FPS benchmarks. CPU component values are sums per rendered frame and include probe overhead. GPU timing optional.",
    flags: flags(),
    gpu_timer_available: !!ext,
    heap_api_available: !!(performance as any).memory,
    forced_gc_available: typeof (window as any).gc === "function",
    start_resources: startResources,
    completed_runs: runs,
    current_run: running
      ? {
          number: run,
          area: stage,
          elapsed_wall_s: (performance.now() - started) / 1000,
          simulated_seconds: simulatedSeconds,
          rendered_frames: renderedFrames,
          route_label: route.label,
          route_step: (route as any).index,
          player: {
            x: game.player.x,
            y: game.player.y,
            z: game.player.z,
            hp: game.player.hp,
            weapon: game.player.weapon,
            mode: game.player.mode,
          },
          stages,
        }
      : null,
  };
}
function showReport() {
  const data = JSON.stringify(report(), null, 2);
  $("#report").textContent = data;
  $("#report").classList.add("open");
  const a = $<HTMLAnchorElement>("#download");
  if (a.href.startsWith("blob:")) URL.revokeObjectURL(a.href);
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = "fixes2-world-performance.json";
  a.hidden = false;
}
function lightBoundary() {
  const environment = (world as any).environment,
    p = game.player,
    area = game.location;
  const warm = environment.warm as {
    x: number;
    y: number;
    z: number;
    area: string;
    range: number;
  }[];
  const selected: number[] = [];
  for (let slot = 0; slot < environment.warmPool.length; slot++) {
    let best = -1,
      distance = Infinity;
    for (let i = 0; i < warm.length; i++) {
      const a = warm[i];
      if (selected.includes(i) || (a.area !== area && a.area !== "world"))
        continue;
      const d = (a.x - p.x) ** 2 + (a.z - p.z) ** 2 + (a.y - p.y - 1) ** 2;
      if (d < distance) {
        best = i;
        distance = d;
      }
    }
    const previous = environment.assignedWarm[slot],
      old = warm[previous];
    if (
      old &&
      (old.area === area || old.area === "world") &&
      !selected.includes(previous)
    ) {
      const d =
        (old.x - p.x) ** 2 + (old.z - p.z) ** 2 + (old.y - p.y - 1) ** 2;
      if (d < distance * 1.18 + 0.7) best = previous;
    }
    selected.push(best);
  }
  const hot = selected
    .map((i) => {
      const a = warm[i];
      return a
        ? `${i}:${Math.hypot(a.x - p.x, a.y - p.y - 1, a.z - p.z) < a.range ? 1 : 0}`
        : "none";
    })
    .sort();
  const cool = (
    environment.cool as {
      x: number;
      y: number;
      z: number;
      tx: number;
      tz: number;
      area: string;
    }[]
  )
    .map((a, i) => ({ a, i, d: (a.tx - p.x) ** 2 + (a.tz - p.z) ** 2 }))
    .filter((v) => v.a.area === area)
    .sort((a, b) => a.d - b.d)
    .slice(0, environment.coolPool.length)
    .map(
      ({ a, i }) =>
        `${i}:${Math.hypot(a.x - p.x, a.y - p.y - 1, a.z - p.z) < 20 ? 1 : 0}`,
    )
    .sort();
  return hot.join(",") + "/" + cool.join(",");
}
function startRun() {
  game.startScenario("journey");
  world.resetView();
  route = new CampaignShowcase(game, "journey");
  accumulator = 0;
  tail = 0;
  simulatedSeconds = 0;
  renderedFrames = 0;
  stage = game.location;
  stages = [];
  current = {};
  started = performance.now();
  last = started;
  runMatrixWorldCalls = runMatrixLocalCalls = 0;
}
function begin(count: number) {
  targetRuns = count;
  run = 1;
  runs = [];
  startResources = snapshot();
  running = true;
  $("#report").classList.remove("open");
  startRun();
  $<HTMLButtonElement>("#one").disabled = $<HTMLButtonElement>(
    "#soak",
  ).disabled = true;
  $<HTMLButtonElement>("#stop").disabled = false;
}
$("#one").onclick = () => {
  $<HTMLSelectElement>("#speed").value = "1";
  begin(1);
};
$("#soak").onclick = () => begin(6);
$("#stop").onclick = () => {
  if (running) {
    commitStage();
    running = false;
  }
  showReport();
  $<HTMLButtonElement>("#one").disabled = $<HTMLButtonElement>(
    "#soak",
  ).disabled = false;
  $<HTMLButtonElement>("#stop").disabled = true;
};
$("#json").onclick = showReport;
await world.load();
const actors = [world.player, ...(world as any).actors.values()];
for (const actor of actors) {
  const update = actor.update.bind(actor);
  actor.update = (dt: any, f: any) => {
    if (
      actor !== world.player &&
      (flag("#freeze") ||
        (flag("#local") &&
          f.area !== game.location &&
          Math.abs(f.z - game.player.z) > 6.5))
    ) {
      if (flag("#local")) actor.root.visible = false;
      return;
    }
    const a = performance.now();
    update(dt, f);
    if (running) {
      total(
        actor === world.player ? "player_cpu_ms" : "npc_cpu_ms",
        performance.now() - a,
      );
      if (actor !== world.player) total("npc_update_count", 1);
    }
  };
  for (const state of (actor as any).states.values()) {
    timing(state.mixer, "update", "mixer_cpu_ms");
    timing(state.continuity, "apply", "continuity_cpu_ms");
    timing(state.feet, "offset", "feet_cpu_ms");
    timing(state.gear, "apply", "gear_cpu_ms");
  }
}
timing((world as any).environment, "update", "environment_cpu_ms");
$<HTMLButtonElement>("#one").disabled = $<HTMLButtonElement>("#soak").disabled =
  false;
$("#status").textContent =
  "Готово. Первый полный повтор прогревает все зоны. Сравнивайте ресурсы повторов 2–6 при одинаковых настройках.";
function tick(now: number) {
  const raw = (now - last) / 1000;
  last = now;
  frame++;
  matrixWorldCalls = matrixLocalCalls = 0;
  pollGPU();
  if (running) {
    frameTotals = {};
    const speed = $<HTMLSelectElement>("#speed").value;
    let dt = 0;
    const a = performance.now();
    if (speed === "fast") {
      const stamp = () =>
        [
          game.location,
          game.player.weapon,
          game.player.armour,
          game.inspecting,
          game.player.mode === "heal",
          game.phase === "finished",
          game.phase === "lost",
          game.openedChests.size,
          game.lootedChests.size,
          game.flasks,
          game.openDoors.size,
          game.mimicAwake,
          [...game.enemies.values()].map((e) => (e.hp <= 0 ? 1 : 0)).join(""),
          lightBoundary(),
          game.drops
            .filter((d) => d.active)
            .map((d) => d.serial)
            .join(","),
        ].join("|");
      const before = stamp();
      for (let step = 0; step < 1440; step++) {
        game.update(1 / 120, route.update(1 / 120));
        dt += 1 / 120;
        if (stamp() !== before) break;
      }
    } else {
      dt = Math.min(0.06, raw) * Number(speed);
      accumulator += dt;
      while (accumulator >= 1 / 120) {
        game.update(1 / 120, route.update(1 / 120));
        accumulator -= 1 / 120;
      }
    }
    simulatedSeconds += dt;
    renderedFrames++;
    const blend = 1 - Math.exp(-dt * 3.6),
      delta = route.cameraYaw - world.yaw;
    world.yaw += Math.atan2(Math.sin(delta), Math.cos(delta)) * blend;
    world.pitch += (route.cameraPitch - world.pitch) * blend;
    for (const event of game.events) world.event(event);
    game.events.length = 0;
    add("simulation_route_cpu_ms", performance.now() - a);
    if (stage !== game.location) {
      commitStage();
      stage = game.location;
    }
    const b = performance.now();
    world.render(dt);
    add("world_total_cpu_ms", performance.now() - b);
    add("raf_ms", raw * 1000);
    for (const [key, value] of Object.entries(frameTotals)) add(key, value);
    for (const key of [
      "player_cpu_ms",
      "npc_cpu_ms",
      "npc_update_count",
      "mixer_cpu_ms",
      "continuity_cpu_ms",
      "feet_cpu_ms",
      "gear_cpu_ms",
      "environment_cpu_ms",
    ])
      if (!(key in frameTotals)) add(key, 0);
    runMatrixWorldCalls += matrixWorldCalls;
    runMatrixLocalCalls += matrixLocalCalls;
    add("matrix_world_call_count", matrixWorldCalls);
    add("matrix_local_call_count", matrixLocalCalls);
    if (route.done) tail += dt;
    if (route.done && tail > 1.2) {
      commitStage();
      if (typeof (window as any).gc === "function") (window as any).gc();
      runs.push({
        run,
        warmup: run === 1,
        simulated_seconds: simulatedSeconds,
        rendered_frames: renderedFrames,
        wall_seconds: (now - started) / 1000,
        game_phase: game.phase,
        hp: game.player.hp,
        completed_areas: [...game.completedAreas],
        resources: snapshot(),
        stages,
        flags: flags(),
      });
      if (game.phase !== "finished" || game.completedAreas.size !== 4) {
        running = false;
        showReport();
        $<HTMLButtonElement>("#one").disabled = $<HTMLButtonElement>(
          "#soak",
        ).disabled = false;
        $<HTMLButtonElement>("#stop").disabled = true;
        $("#status").textContent =
          "Маршрут не завершил четыре зоны. Этот прогон не подтверждает стабильность ресурсов всех локаций.";
      } else if (run < targetRuns) {
        run++;
        startRun();
      } else {
        running = false;
        showReport();
        $<HTMLButtonElement>("#one").disabled = $<HTMLButtonElement>(
          "#soak",
        ).disabled = false;
        $<HTMLButtonElement>("#stop").disabled = true;
        $("#status").textContent =
          `Завершены ${runs.length} повторов. Отчёт готов.`;
      }
    }
    if (running && now - lastReport > 5000) {
      lastReport = now;
      $("#report").textContent = JSON.stringify(report());
    }
    if (running && now - lastUI > 500) {
      lastUI = now;
      $("#status").textContent =
        `Повтор ${run}/${targetRuns} / ${game.location} / ${simulatedSeconds.toFixed(1)} с симуляции, ${renderedFrames} кадров / ${route.label} / G${world.resources().geometries} T${world.resources().textures} P${world.resources().programs}`;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
window.addEventListener("pagehide", () => {
  for (const p of gpu) gl.deleteQuery(p.q);
  T.Object3D.prototype.updateWorldMatrix = originalWorld;
  T.Object3D.prototype.updateMatrixWorld = originalLocal;
  actorFrustum.intersectsSphere = originalIntersects;
  void world.dispose();
});
