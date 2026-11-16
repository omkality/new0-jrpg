import * as THREE from "three";
import { ConnectedEnvironment, LOCATIONS, type LocationId } from "./locations";
import { Actor } from "./actor";
import { Campaign } from "./campaign";
import { ENCOUNTERS, type AreaId } from "./world-layout";
import type { GameEvent } from "./game";
import { LevelProps } from "./level-props";
import { cameraClearance, FollowCameraClearance } from "./camera-clearance";
import {
  loadProps,
  modelCacheSize,
  disposeModels,
  releaseTexture,
} from "./asset-store";

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(57, 1, 0.08, 165);
  player = new Actor();
  private actors = new Map<string, Actor>();
  private props: LevelProps;
  private environment: ConnectedEnvironment;
  private readyTextures: Promise<void>;
  yaw = 0;
  pitch = 0.08;
  resolution = 1;
  device = "";
  location: AreaId = "forest";
  private elapsed = 0;
  private aim = new THREE.Vector3(0, 1.2, 3);
  private position = new THREE.Vector3(0.7, 2.5, 9);
  private desiredAim = new THREE.Vector3();
  private desiredPosition = new THREE.Vector3();
  private cameraFocus = new THREE.Vector3();
  private cameraSolver = new FollowCameraClearance();
  private cameraBounds = { minX: -7.1, maxX: 7.1, maxY: Infinity };
  private fogColor = new THREE.Color();
  private playerFill = new THREE.PointLight(0xcdd8e4, 2.2, 4.2, 2);
  private shadows: THREE.Mesh[] = [];
  private impact: THREE.Sprite;
  private impactLife = 0;
  private cameraKick = 0;
  private wasInspecting = false;
  private resizeHandler = () => this.resize();
  private contextHandler = (e: Event) => {
    e.preventDefault();
    window.dispatchEvent(new Event("game-context-lost"));
  };
  constructor(
    private canvas: HTMLCanvasElement,
    public game: Campaign,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = false;
    const gl = this.renderer.getContext(),
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    this.device = debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : "WebGL2";
    this.scene.background = new THREE.Color(0x7e8b94);
    this.scene.fog = new THREE.FogExp2(0x526166, 0.018);
    const manager = new THREE.LoadingManager();
    this.readyTextures = new Promise((resolve, reject) => {
      manager.onLoad = () => resolve();
      manager.onError = (url) => reject(new Error(`Material failed: ${url}`));
    });
    this.environment = new ConnectedEnvironment(
      new THREE.TextureLoader(manager),
    );
    this.scene.add(this.environment.root, this.playerFill, this.player.root);
    for (const spec of ENCOUNTERS)
      if (spec.kind !== "mimic") {
        const kind = spec.kind;
        const actor = new Actor(true, kind);
        this.actors.set(spec.id, actor);
        this.scene.add(actor.root);
      }
    this.props = new LevelProps(game);
    this.scene.add(this.props.root);
    const shadowTexture = new THREE.CanvasTexture(this.radial("#000000", 0.75));
    for (let i = 0; i <= ENCOUNTERS.length; i++) {
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(
          i > 0 && ENCOUNTERS[i - 1].kind === "mimic" ? 2 : 1.35,
          i > 0 && ENCOUNTERS[i - 1].kind === "mimic" ? 1.7 : 1.2,
        ),
        new THREE.MeshBasicMaterial({
          map: shadowTexture,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      this.shadows.push(shadow);
      this.scene.add(shadow);
    }
    this.impact = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(this.radial("#f5f5ef", 1)),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.impact.visible = false;
    this.scene.add(this.impact);
    this.resize();
    window.addEventListener("resize", this.resizeHandler);
    canvas.addEventListener("webglcontextlost", this.contextHandler);
  }
  async load() {
    await loadProps();
    await Promise.all([
      this.readyTextures,
      this.player.load(),
      ...[...this.actors.values()].map((a) => a.load()),
    ]);
    this.props.build();
    this.resetView();
    this.render(0.01);
    // Warm every area's material/light variants before the input tour begins.
    await this.renderer.compileAsync(this.scene, this.camera);
  }
  resetView() {
    const p = this.game.player;
    this.yaw = 0;
    this.pitch = 0.08;
    this.position.set(p.x + 0.7, p.y + 2.6, p.z + 4.5);
    this.aim.set(p.x, p.y + 1.2, p.z - 0.6);
    this.props.reset();
    this.player.reset();
    for (const actor of this.actors.values()) actor.reset();
  }
  selectLocation(id: LocationId) {
    this.location = id === "courtyard" ? "forest" : id;
    this.resetView();
  }
  private radial(color: string, alpha: number) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!,
      g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return canvas;
  }
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.002, -0.2, 0.65);
  }
  moveAxis(axis: { x: number; y: number }) {
    const viewYaw = Math.atan2(
      this.camera.position.x - this.aim.x,
      this.camera.position.z - this.aim.z,
    );
    return {
      x: axis.x * Math.cos(viewYaw) + axis.y * Math.sin(viewYaw),
      z: -axis.x * Math.sin(viewYaw) + axis.y * Math.cos(viewYaw),
    };
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const scale = Math.min(1, (w < 700 ? 800 : 1080) / h) * this.resolution;
    this.renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
  }
  event(e: GameEvent) {
    if (e.type !== "hit" && e.type !== "hurt" && e.type !== "block") return;
    this.cameraKick =
      e.type === "block" ? 0.015 : this.game.player.combo === 3 ? 0.045 : 0.025;
    this.impact.position.set(
      e.x,
      (e.type === "hit" ? this.game.enemy.y : this.game.player.y) +
        (this.game.enemy.kind === "gaoler" && e.type === "hit" ? 1.7 : 0.9),
      e.z,
    );
    this.impact.visible = true;
    this.impactLife = 0.13;
  }
  render(dt: number) {
    this.elapsed += dt;
    const p = this.game.player;
    this.location = this.game.location;
    this.environment.update(this.elapsed, p, this.location);
    this.playerFill.position.set(p.x - 0.5, p.y + 2.1, p.z + 0.6);
    const fog = this.scene.fog as THREE.FogExp2,
      spec = LOCATIONS[this.location],
      blend = 1 - Math.exp(-dt * 2.3);
    fog.color.lerp(this.fogColor.set(spec.fog), blend);
    fog.density = THREE.MathUtils.lerp(fog.density, spec.density, blend);
    this.player.update(dt, p);
    this.shadows[0].position.set(p.x, p.y + 0.014, p.z);
    let shadowIndex = 1;
    for (const [id, e] of this.game.enemies) {
      const shadow = this.shadows[shadowIndex++];
      const visible = Math.abs(e.z - p.z) < 36;
      shadow.visible = visible;
      shadow.position.set(e.x, e.y + 0.015, e.z);
      const actor = this.actors.get(id);
      if (actor) {
        actor.root.visible = visible;
        if (visible) actor.update(dt, e);
      }
    }
    this.props.update(dt, this.elapsed);
    const d = this.camera.aspect < 0.85 ? 4.5 : 3.9;
    this.desiredAim.set(
      p.x - Math.sin(this.yaw) * 0.7,
      p.y + 1.2,
      p.z - Math.cos(this.yaw) * 0.7,
    );
    this.desiredPosition.set(
      p.x + Math.sin(this.yaw) * d + Math.cos(this.yaw) * 0.7,
      p.y + 2.45 + this.pitch * 2.6,
      p.z + Math.cos(this.yaw) * d - Math.sin(this.yaw) * 0.7,
    );
    const inspect = this.props.inspect();
    if (inspect) {
      this.desiredAim.set(inspect.x, inspect.y + 0.3, inspect.z);
      this.desiredPosition.set(
        inspect.x + 0.65,
        inspect.y + 2.9,
        inspect.z + 1.3,
      );
    }
    if (inspect) {
      this.playerFill.position.set(
        inspect.x + 0.45,
        inspect.y + 1.4,
        inspect.z + 0.7,
      );
      this.playerFill.intensity = 7;
    } else this.playerFill.intensity = 2.2;
    const alpha = 1 - Math.exp(-dt * 8);
    // Cast from head height so a waist-high chest cannot pull the camera
    // into the hero's shoulder while walking around it.
    this.cameraFocus.set(p.x, p.y + 1.55, p.z);
    if (inspect) this.cameraFocus.copy(this.desiredAim);
    this.cameraBounds.minX =
      p.y > 4.9 && this.location === "chapel" ? 3.7 : -7.1;
    this.cameraBounds.maxX =
      // The east window's 32 cm frame projects into the upper room.
      p.y > 4.9 && this.location === "chapel" ? 5.9 : 7.1;
    this.cameraBounds.maxY =
      p.y > 4.9 && this.location === "chapel"
        ? 8.6
        : this.location === "crypt"
          ? 6.35
          : Infinity;
    this.cameraSolver.resolve(
      this.cameraFocus,
      this.desiredPosition,
      this.desiredPosition,
      this.game.obstacles,
      this.game.openDoors,
      this.cameraBounds,
      this.position,
    );
    if (this.wasInspecting && !inspect && p.mode === "hit") {
      this.aim.copy(this.desiredAim);
      this.position.copy(this.desiredPosition);
    }
    this.wasInspecting = !!inspect;
    this.aim.lerp(this.desiredAim, alpha);
    this.position.lerp(this.desiredPosition, alpha);
    this.position.lerpVectors(
      this.cameraFocus,
      this.position,
      cameraClearance(
        this.cameraFocus,
        this.position,
        this.game.obstacles,
        this.game.openDoors,
      ),
    );
    if (this.position.distanceTo(this.cameraFocus) < 1.6)
      this.position.copy(this.desiredPosition);
    this.camera.position.copy(this.position);
    this.cameraKick *= Math.exp(-dt * 30);
    this.camera.position.x += Math.sin(this.elapsed * 67) * this.cameraKick;
    this.camera.position.y +=
      Math.cos(this.elapsed * 53) * this.cameraKick * 0.45;
    this.camera.lookAt(this.aim);
    if (this.impactLife > 0) {
      this.impactLife -= dt;
      this.impact.scale.setScalar(0.35 + (0.13 - this.impactLife) * 2);
      (this.impact.material as THREE.SpriteMaterial).opacity = Math.max(
        0,
        this.impactLife / 0.13,
      );
    } else this.impact.visible = false;
    this.renderer.render(this.scene, this.camera);
  }
  resources() {
    const memory = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;
    return {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      models: modelCacheSize(),
      js_heap_mb: memory
        ? Math.round((memory.usedJSHeapSize / 1048576) * 100) / 100
        : null,
    };
  }
  async dispose() {
    window.removeEventListener("resize", this.resizeHandler);
    this.canvas.removeEventListener("webglcontextlost", this.contextHandler);
    this.player.dispose();
    for (const actor of this.actors.values()) actor.dispose();
    this.props.dispose();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          for (const value of Object.values(m))
            if (value instanceof THREE.Texture) textures.add(value);
        }
      } else if (o instanceof THREE.Sprite) {
        materials.add(o.material);
        if (o.material.map) textures.add(o.material.map);
      }
    });
    for (const t of textures) releaseTexture(t);
    for (const m of materials) m.dispose();
    for (const g of geometries) g.dispose();
    await disposeModels();
    this.renderer.dispose();
    this.scene.clear();
  }
}
