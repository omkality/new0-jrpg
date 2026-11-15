import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Actor } from "./actor";
import { CombatGame, type GameEvent } from "./game";

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.08, 60);
  player = new Actor();
  enemy = new Actor(true);
  yaw = 0;
  pitch = 0.08;
  resolution = 1;
  device = "";
  private flickerLights: THREE.PointLight[] = [];
  private gate = new THREE.Group();
  private aim = new THREE.Vector3(0, 1.2, 4.4);
  private position = new THREE.Vector3(0.35, 2.3, 8.8);
  private desiredAim = new THREE.Vector3();
  private desiredPosition = new THREE.Vector3();
  private batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private elapsed = 0;
  private readyTextures: Promise<void>;
  private warning: THREE.Mesh;
  private swing: THREE.Mesh;
  private impact: THREE.Sprite;
  private impactLife = 0;
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
    this.renderer.toneMappingExposure = 1.1;
    // No real-time shadow maps. Static vertex shading + soft contact patches.
    this.renderer.shadowMap.enabled = false;
    this.scene.background = new THREE.Color(0x909c9d);
    this.scene.fog = new THREE.Fog(0x909c9d, 11, 32);
    this.scene.add(new THREE.HemisphereLight(0xdce8ea, 0x686b69, 1.35));
    const sun = new THREE.DirectionalLight(0xd8e9f0, 2.1);
    sun.position.set(-4, 8, 2);
    this.scene.add(sun);
    const warm = new THREE.DirectionalLight(0xf5d2a4, 0.85);
    warm.position.set(4, 3, -5);
    this.scene.add(warm);
    const manager = new THREE.LoadingManager();
    this.readyTextures = new Promise((resolve) => {
      manager.onLoad = () => resolve();
    });
    const loader = new THREE.TextureLoader(manager);
    const material = (name: string, rx: number, ry: number, tint: number) => {
      const map = loader.load(`/assets/dungeon/${name}.png`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(rx, ry);
      map.anisotropy = Math.min(
        4,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      return new THREE.MeshStandardMaterial({
        map,
        color: tint,
        roughness: 1,
        metalness: 0,
        vertexColors: true,
      });
    };
    const wall = material("TEX_Wall_03", 5, 3, 0xc2ccd2);
    const side = material("TEX_Wall_03", 7, 3, 0xb5c1cd);
    const stone = material("TEX_Arch_02", 1, 1, 0xe9e6da);
    const column = material("TEX_Pillar_01", 1, 2, 0xe0e5df);
    const floor = material("TEX_Ground_04", 12, 17, 0xc0c8cd);
    floor.bumpMap = floor.map;
    floor.bumpScale = 0.055;
    const metal = new THREE.MeshStandardMaterial({
      color: 0x6e7776,
      roughness: 0.8,
      metalness: 0.35,
      vertexColors: true,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x383c3c,
      roughness: 1,
      vertexColors: true,
    });
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(12.8, 24, 40, 70),
      floor,
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.z = -1.6;
    this.part(floorMesh);
    this.box(3.9, 8.5, 0.5, -4.4, 4.25, -8.5, wall);
    this.box(3.9, 8.5, 0.5, 4.4, 4.25, -8.5, wall);
    this.box(4.9, 3.3, 0.5, 0, 6.85, -8.5, wall);
    this.box(0.5, 8.5, 20, -6.25, 4.25, 0, side);
    this.box(0.5, 8.5, 20, 6.25, 4.25, 0, side);
    this.box(12.8, 8.5, 0.5, 0, 4.25, 9, wall);
    this.box(12.8, 0.3, 20, 0, 8.3, 0, dark);
    // Raised side aisles, rounded columns, capitals and double moulded arches.
    for (const x of [-4.2, 4.2])
      for (const z of [-7, 0, 6.7]) {
        this.cylinder(0.31, 0.36, 3.8, 24, x, 1.9, z, column);
        this.cylinder(0.52, 0.58, 0.22, 24, x, 0.11, z, stone);
        this.cylinder(0.52, 0.42, 0.2, 24, x, 3.78, z, stone);
        this.cylinder(0.45, 0.54, 0.13, 24, x, 0.28, z, stone);
        this.game.obstacles.push({ x, z, hx: 0.38, hz: 0.38 });
      }
    for (const z of [-7, 0, 6.7]) {
      this.arch(4.22, 3.85, 0.28, z, stone);
      this.arch(4.32, 3.85, 0.08, z + 0.18, stone);
      for (const x of [-5.3, 5.3]) this.box(2, 0.24, 0.85, x, 3.86, z, stone);
    }
    for (const x of [-5.97, 5.97])
      for (const z of [-5, 3.7]) {
        this.box(0.12, 2.7, 2.45, x, 1.55, z, dark);
        this.box(0.24, 0.19, 2.75, x, 2.97, z, stone);
        this.box(0.25, 0.18, 2.75, x, 0.2, z, stone);
      }
    // Pale clerestory openings make the room readable, with dark recesses below.
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xe0e6de });
    for (const sideSign of [-1, 1])
      for (const z of [-3.8, 4.7]) {
        const window = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2.6),
          lightMat,
        );
        window.position.set(sideSign * 5.96, 4.35, z);
        window.rotation.y = sideSign < 0 ? Math.PI / 2 : -Math.PI / 2;
        this.scene.add(window);
        for (const off of [-0.62, 0, 0.62])
          this.box(0.14, 2.9, 0.1, sideSign * 5.86, 4.35, z + off, stone);
        this.beam(sideSign, z);
      }
    this.arch(2.35, 2.6, 0.38, -8.35, stone);
    this.box(0.3, 3, 0.4, -2.15, 1.5, -8.35, stone);
    this.box(0.3, 3, 0.4, 2.15, 1.5, -8.35, stone);
    this.box(4.3, 0.14, 7, 0, -0.12, -11.6, floor);
    this.box(0.45, 5, 8, -2.55, 2.5, -12, wall);
    this.box(0.45, 5, 8, 2.55, 2.5, -12, wall);
    for (let x = -1.9; x < 2; x += 0.25) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 4, 6),
        metal.clone(),
      );
      bar.position.set(x, 2, 0);
      this.gate.add(bar);
    }
    for (const y of [0.45, 2.7, 3.6]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(4.1, 0.06, 0.07),
        metal.clone(),
      );
      rail.position.y = y;
      this.gate.add(rail);
    }
    this.gate.position.z = -8.2;
    this.scene.add(this.gate);
    this.box(1.5, 0.9, 0.85, -4.1, 0.45, 0.4, stone);
    this.box(1.7, 0.14, 1, -4.1, 0.96, 0.4, stone);
    this.box(0.9, 0.6, 0.9, 4.3, 0.3, -4.8, stone);
    this.cylinder(0.23, 0.34, 0.55, 18, 4.3, 0.85, -4.8, metal);
    this.game.obstacles.push(
      { x: -4.1, z: 0.4, hx: 0.85, hz: 0.58 },
      { x: 4.3, z: -4.8, hx: 0.5, hz: 0.5 },
    );
    for (const x of [-5.6, 5.6])
      for (const z of [-5.9, 2]) this.torch(x, z, metal);
    for (let i = 0; i < 22; i++) {
      const x = (i % 2 ? 1 : -1) * (4.9 + Math.sin(i * 9) * 0.45),
        z = -7 + ((i * 13) % 150) / 10;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.11 + (i % 3) * 0.06),
        stone,
      );
      rock.position.set(x, 0.09, z);
      rock.scale.y = 0.6;
      rock.rotation.set(0.1, i, 0.2);
      this.part(rock);
    }
    this.flush();
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
    this.swing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.03, 24, 1, 0, Math.PI * 1.1),
      new THREE.MeshBasicMaterial({
        color: 0xd6e9e7,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
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
    this.scene.environmentIntensity = 0.65;
    room.dispose();
    pmrem.dispose();
    this.player.update(0.01, this.game.player);
    this.enemy.update(0.01, this.game.enemy);
    await this.renderer.compileAsync(this.scene, this.camera);
  }
  private part(mesh: THREE.Mesh) {
    mesh.updateMatrix();
    let g = mesh.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(mesh.matrix);
    const pos = g.getAttribute("position"),
      norm = g.getAttribute("normal"),
      colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i),
        x = pos.getX(i),
        z = pos.getZ(i);
      let shade = Math.max(
        0.42,
        0.83 +
          norm.getY(i) * 0.09 +
          norm.getX(i) * 0.05 -
          Math.exp(-Math.max(0, y) * 1.8) * 0.15,
      );
      if (y < 0.03 && norm.getY(i) > 0.9) {
        shade = 0.7 - 0.33 * Math.pow(Math.min(1, Math.abs(x) / 6.2), 3);
        for (const cx of [-4.2, 4.2])
          for (const cz of [-7, 0, 6.7])
            shade -= 0.2 * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) * 1.5);
        shade += 0.2 * Math.exp(-((x + 1.6) ** 2 + (z - 3.7) ** 2) / 8);
      }
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const m = mesh.material as THREE.Material;
    const list = this.batches.get(m) ?? [];
    list.push(g);
    this.batches.set(m, list);
  }
  private flush() {
    for (const [mat, geos] of this.batches) {
      const g = mergeGeometries(geos);
      if (g) this.scene.add(new THREE.Mesh(g, mat));
      for (const old of geos) old.dispose();
    }
    this.batches.clear();
  }
  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    this.part(mesh);
  }
  private cylinder(
    rt: number,
    rb: number,
    h: number,
    n: number,
    x: number,
    y: number,
    z: number,
    m: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, n), m);
    mesh.position.set(x, y, z);
    this.part(mesh);
  }
  private arch(
    r: number,
    stem: number,
    width: number,
    z: number,
    m: THREE.Material,
  ) {
    const s = new THREE.Shape(),
      inner = r - width;
    s.moveTo(-r, 0);
    s.lineTo(-r, stem);
    s.absarc(0, stem, r, Math.PI, 0, true);
    s.lineTo(r, 0);
    s.lineTo(inner, 0);
    s.lineTo(inner, stem);
    s.absarc(0, stem, inner, 0, Math.PI, false);
    s.lineTo(-inner, 0);
    s.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(s, {
        depth: 0.35,
        bevelEnabled: true,
        bevelSize: 0.035,
        bevelThickness: 0.035,
        bevelSegments: 2,
        curveSegments: 28,
      }),
      m,
    );
    mesh.position.z = z;
    this.part(mesh);
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
  private beam(sign: number, z: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          sign * 5.8,
          5.6,
          z - 1,
          sign * 5.8,
          3.2,
          z + 1,
          sign * 0.4,
          0.05,
          z + 3.8,
          sign * 5.8,
          5.6,
          z - 1,
          sign * 0.4,
          0.05,
          z + 3.8,
          sign * 2,
          0.05,
          z + 1.5,
        ],
        3,
      ),
    );
    g.computeVertexNormals();
    this.scene.add(
      new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color: 0xe1e9dc,
          transparent: true,
          opacity: 0.045,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
  }
  private torch(x: number, z: number, m: THREE.Material) {
    this.box(0.15, 0.85, 0.17, x, 1.7, z, m);
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa459, toneMapped: false }),
    );
    flame.position.set(x, 2.2, z);
    flame.scale.y = 2.3;
    this.scene.add(flame);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(this.radial("#ffd59f", 0.7)),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.copy(flame.position);
    glow.scale.setScalar(0.8);
    this.scene.add(glow);
    if (z === 2) {
      const light = new THREE.PointLight(0xffba79, 8, 5.5, 2);
      light.position.set(x * 0.96, 2.15, z);
      this.scene.add(light);
      this.flickerLights.push(light);
    }
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
      this.impact.position.set(e.x, 1.15, e.z);
      this.impact.visible = true;
      this.impactLife = 0.18;
    }
  }
  render(dt: number) {
    this.elapsed += dt;
    for (let i = 0; i < this.flickerLights.length; i++)
      this.flickerLights[i].intensity =
        8 +
        Math.sin(this.elapsed * 12 + i * 3) * 0.45 +
        Math.sin(this.elapsed * 19 + i) * 0.2;
    const p = this.game.player,
      e = this.game.enemy;
    this.player.update(dt, p);
    this.enemy.update(dt, e);
    this.blobs[0].position.set(p.x, 0.012, p.z);
    this.blobs[1].position.set(e.x, 0.013, e.z);
    this.blobs[1].scale.setScalar(e.hp <= 0 ? 1.4 : 1);
    this.warning.position.set(e.x, 0.025, e.z);
    this.warning.rotation.set(-Math.PI / 2, 0, -e.yaw + Math.PI * 0.1);
    (this.warning.material as THREE.MeshBasicMaterial).opacity =
      e.mode === "windup" ? 0.13 + e.time * 0.12 : 0;
    this.swing.position.set(p.x, 1.05, p.z);
    this.swing.rotation.set(Math.PI / 2, 0, -p.yaw + Math.PI);
    (this.swing.material as THREE.MeshBasicMaterial).opacity =
      p.mode === "attack" && p.time > 0.17 && p.time < 0.34 ? 0.35 : 0;
    if (this.impactLife > 0) {
      this.impactLife -= dt;
      this.impact.scale.setScalar(0.4 + (0.18 - this.impactLife) * 3);
      (this.impact.material as THREE.SpriteMaterial).opacity = Math.max(
        0,
        this.impactLife / 0.18,
      );
    } else this.impact.visible = false;
    this.gate.position.y = THREE.MathUtils.damp(
      this.gate.position.y,
      e.hp <= 0 ? 4.4 : 0,
      2,
      dt,
    );
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
    this.camera.lookAt(this.aim);
    this.renderer.render(this.scene, this.camera);
  }
}
