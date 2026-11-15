import * as THREE from "three";
import {
  LocationStage,
  LOCATIONS,
  LOCATION_IDS,
  type LocationId,
} from "./locations";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Actor } from "./actor";
import { CombatGame, ATTACKS, type GameEvent } from "./game";

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.08, 110);
  player = new Actor();
  enemy = new Actor(true);
  yaw = 0;
  pitch = 0.08;
  resolution = 1;
  device = "";
  location: LocationId = "chapel";
  private stages = new Map<LocationId, LocationStage>();
  private get stage() {
    return this.stages.get(this.location)!;
  }
  private playerFill = new THREE.PointLight(0x8caaa8, 3.4, 5.2, 2);

  private aim = new THREE.Vector3(0, 1.2, 4.4);
  private position = new THREE.Vector3(0.35, 2.3, 8.8);
  private desiredAim = new THREE.Vector3();
  private desiredPosition = new THREE.Vector3();

  private elapsed = 0;
  private readyTextures: Promise<void>;
  private warning: THREE.Mesh;
  private swing: THREE.Mesh;
  private trailPoints: { base: THREE.Vector3; tip: THREE.Vector3 }[] = [];
  private lastTrailSample = 0;
  private trailStage = 0;
  private impact: THREE.Sprite;
  private impactLife = 0;
  private cameraKick = 0;
  private blobs: THREE.Mesh[] = [];
  constructor(
    private canvas: HTMLCanvasElement,
    public game: CombatGame,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(1);
    const gl = this.renderer.getContext(),
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    this.device = debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : "WebGL2";
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // No real-time shadow maps. Static vertex shading + soft contact patches.
    this.renderer.shadowMap.enabled = false;
    this.scene.add(this.playerFill);
    const manager = new THREE.LoadingManager();
    this.readyTextures = new Promise((resolve, reject) => {
      manager.onLoad = () => resolve();
      manager.onError = (url) =>
        reject(new Error(`Не удалось загрузить материал: ${url}`));
    });
    const loader = new THREE.TextureLoader(manager);
    for (const id of LOCATION_IDS) {
      const stage = new LocationStage(
        id,
        loader,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      this.stages.set(id, stage);
      this.scene.add(stage.group);
    }
    this.selectLocation("chapel");
    const shadow = new THREE.CanvasTexture(this.radial("#000000", 0.7));
    for (let i = 0; i < 2; i++) {
      const blob = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.3),
        new THREE.MeshBasicMaterial({
          map: shadow,
          transparent: true,
          depthWrite: false,
          opacity: 0.62,
        }),
      );
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.012;
      this.blobs.push(blob);
      this.scene.add(blob);
    }
    this.warning = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 2.45, 40, 1, Math.PI * 0.1, Math.PI * 0.8),
      new THREE.MeshBasicMaterial({
        color: 0xe3b675,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.warning.rotation.x = -Math.PI / 2;
    this.warning.position.y = 0.025;
    this.scene.add(this.warning);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(9 * 6 * 3), 3),
    );
    trailGeometry.setDrawRange(0, 0);
    this.swing = new THREE.Mesh(
      trailGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xd6e9e7,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.swing.frustumCulled = false;
    this.scene.add(this.swing);
    this.impact = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(this.radial("#fff2c9", 1)),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.impact.visible = false;
    this.scene.add(this.impact);
    this.scene.add(this.player.root, this.enemy.root);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      window.dispatchEvent(new Event("game-context-lost"));
    });
  }
  async load() {
    await Promise.all([
      this.readyTextures,
      this.player.load(),
      this.enemy.load(),
    ]);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = 0.12;
    room.dispose();
    pmrem.dispose();
    this.player.update(0.01, this.game.player);
    this.enemy.update(0.01, this.game.enemy);
    const selected = this.location;
    for (const id of LOCATION_IDS) {
      this.selectLocation(id);
      await this.renderer.compileAsync(this.scene, this.camera);
    }
    this.selectLocation(selected);
  }
  selectLocation(id: LocationId) {
    this.location = id;
    for (const [key, stage] of this.stages) stage.group.visible = key === id;
    const spec = LOCATIONS[id];
    this.scene.background = this.stage.background;
    this.scene.fog = new THREE.FogExp2(spec.fog, spec.density);
    this.playerFill.color.set(spec.fill);
    this.game.obstacles = this.stage.obstacles;
    this.stage.gate.position.y = 0;
    this.aim.set(0, 1.2, 4.4);
    this.position.set(0.35, 2.3, 8.8);
    this.trailPoints = [];
    this.trailStage = 0;
  }
  private radial(color: string, alpha: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!,
      g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    x.globalAlpha = alpha;
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return c;
  }
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.002, -0.2, 0.6);
  }
  moveAxis(axis: { x: number; y: number }) {
    return {
      x: axis.x * Math.cos(this.yaw) + axis.y * Math.sin(this.yaw),
      z: -axis.x * Math.sin(this.yaw) + axis.y * Math.cos(this.yaw),
    };
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const maxHeight = w < 700 ? 760 : 1080;
    const ratio = Math.min(1, maxHeight / h) * this.resolution;
    this.renderer.setSize(Math.round(w * ratio), Math.round(h * ratio), false);
  }
  event(e: GameEvent) {
    if (e.type === "hit" || e.type === "block" || e.type === "hurt") {
      this.cameraKick =
        e.type === "block"
          ? 0.018
          : this.game.player.combo === 3
            ? 0.055
            : 0.03;
      this.impact.position.set(
        e.x,
        e.type === "hit" && this.game.enemy.kind === "gaoler" ? 1.7 : 1.15,
        e.z,
      );
      this.impact.visible = true;
      this.impactLife = 0.18;
    }
  }
  render(dt: number) {
    this.elapsed += dt;
    this.stage.update(this.elapsed, dt, this.game.enemy.hp <= 0);
    const p = this.game.player,
      e = this.game.enemy;
    this.playerFill.position.set(p.x - 0.3, 2.5, p.z + 0.5);
    this.player.update(dt, p);
    this.enemy.update(dt, e);
    this.blobs[0].position.set(p.x, 0.012, p.z);
    this.blobs[1].position.set(e.x, 0.013, e.z);
    this.blobs[1].scale.setScalar(e.hp <= 0 ? 1.4 : 1);
    this.warning.position.set(e.x, 0.025, e.z);
    this.warning.rotation.set(-Math.PI / 2, 0, -e.yaw + Math.PI * 0.1);
    (this.warning.material as THREE.MeshBasicMaterial).opacity =
      e.mode === "windup" ? 0.13 + e.time * 0.12 : 0;
    const active =
      p.mode === "attack" &&
      p.time > ATTACKS[p.combo - 1].contact - 0.09 &&
      p.time < ATTACKS[p.combo - 1].contact + 0.13;
    if (active) {
      if (this.trailStage !== p.combo) {
        this.trailPoints = [];
        this.trailStage = p.combo;
      }
      if (this.elapsed - this.lastTrailSample >= 1 / 60) {
        this.lastTrailSample = this.elapsed;
        const point = { base: new THREE.Vector3(), tip: new THREE.Vector3() };
        if (this.player.sampleWeapon(point.base, point.tip))
          this.trailPoints.push(point);
        if (this.trailPoints.length > 10) this.trailPoints.shift();
        const attr = this.swing.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        let cursor = 0;
        for (let i = 1; i < this.trailPoints.length; i++) {
          const a = this.trailPoints[i - 1],
            b = this.trailPoints[i];
          for (const v of [a.base, a.tip, b.tip, a.base, b.tip, b.base])
            attr.setXYZ(cursor++, v.x, v.y, v.z);
        }
        attr.needsUpdate = true;
        this.swing.geometry.setDrawRange(0, cursor);
      }
      (this.swing.material as THREE.MeshBasicMaterial).opacity =
        p.combo === 3 ? 0.23 : 0.15;
    } else {
      const m = this.swing.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, m.opacity - dt * 2.5);
      if (p.mode !== "attack") {
        this.trailPoints = [];
        this.trailStage = 0;
      }
    }
    if (this.impactLife > 0) {
      this.impactLife -= dt;
      this.impact.scale.setScalar(0.4 + (0.18 - this.impactLife) * 3);
      (this.impact.material as THREE.SpriteMaterial).opacity = Math.max(
        0,
        this.impactLife / 0.18,
      );
    } else this.impact.visible = false;
    const d = this.camera.aspect < 0.85 ? 4.7 : 3.9;
    this.desiredAim.set(
      p.x - Math.sin(this.yaw) * 0.65,
      1.25,
      p.z - Math.cos(this.yaw) * 0.65,
    );
    this.desiredPosition.set(
      p.x + Math.sin(this.yaw) * d + 0.25,
      2.35 + this.pitch * 2,
      p.z + Math.cos(this.yaw) * d,
    );
    this.desiredPosition.x = THREE.MathUtils.clamp(
      this.desiredPosition.x,
      -5.7,
      5.7,
    );
    this.desiredPosition.z = THREE.MathUtils.clamp(
      this.desiredPosition.z,
      -8,
      8.4,
    );
    const alpha = 1 - Math.exp(-dt * 12);
    this.aim.lerp(this.desiredAim, alpha);
    this.position.lerp(this.desiredPosition, alpha);
    this.camera.position.copy(this.position);
    this.cameraKick *= Math.exp(-dt * 32);
    this.camera.position.x += Math.sin(this.elapsed * 73) * this.cameraKick;
    this.camera.position.y +=
      Math.cos(this.elapsed * 57) * this.cameraKick * 0.55;
    this.camera.lookAt(this.aim);
    this.renderer.render(this.scene, this.camera);
  }
}
