import * as THREE from "three";
import { Actor } from "./actor";
import type { GameState } from "./api";

type Obstacle = { x: number; z: number; halfX: number; halfZ: number };
export type Target = "keeper" | "inscription" | "echo" | "exit";

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 1, 0.08, 45);
  player = new Actor();
  keeper = new Actor(true);
  onStep = () => {};
  private obstacles: Obstacle[] = [];
  private gate = new THREE.Group();
  private portal: THREE.Mesh;
  private symbols = new Map<Target, THREE.Group>();
  private dust: THREE.Points;
  private state: GameState | null = null;
  private mode: "intro" | "explore" | "combat" = "intro";
  private elapsed = 0;
  private stepTime = 0;
  private battleAnimation = 0;
  private yaw = 0;
  private pitch = 0;
  private cameraAim = new THREE.Vector3(0, 1.1, 3.7);
  private cameraPosition = new THREE.Vector3(0, 2, 7.4);
  private flames: THREE.Mesh[] = [];
  constructor(
    private canvas: HTMLCanvasElement,
    private touch: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x15151a);
    this.scene.fog = new THREE.Fog(0x15151a, 7, 21);
    this.scene.add(new THREE.HemisphereLight(0x9dabb7, 0x292321, 0.95));
    const moon = new THREE.DirectionalLight(0xa9b9c8, 1.8);
    moon.position.set(-3, 5, 5);
    moon.target.position.set(0, 0, -2);
    moon.castShadow = true;
    moon.shadow.mapSize.set(touch ? 512 : 1024, touch ? 512 : 1024);
    moon.shadow.camera.left = -8;
    moon.shadow.camera.right = 8;
    moon.shadow.camera.top = 10;
    moon.shadow.camera.bottom = -10;
    moon.shadow.normalBias = 0.025;
    this.scene.add(moon, moon.target);
    const loader = new THREE.TextureLoader();
    const material = (file: string, rx = 1, ry = 1, tint = 0xaaa59d) => {
      const map = loader.load(`/assets/dungeon/${file}.png`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestMipmapNearestFilter;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(rx, ry);
      return new THREE.MeshLambertMaterial({ map, color: tint });
    };
    const floor = material("TEX_Ground_04", 8, 11, 0x9e9b95),
      wall = material("TEX_Wall_03", 6, 3, 0x989597);
    const side = material("TEX_Wall_03", 8, 3, 0x969395),
      archMat = material("TEX_Arch_02", 1, 2, 0xb3aaa2);
    const column = material("TEX_Pillar_01", 1, 3, 0xb1aaa1),
      stone = material("TEX_Wall_03", 2, 1, 0xb0a79c);
    const iron = material("TEX_Rusty_Metal_01", 1, 2, 0x92877d);
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(10.4, 15.2),
      floor,
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.z = 0.7;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.box(0.4, 5.5, 15.4, -5.25, 2.7, 0.7, side);
    this.box(0.4, 5.5, 15.4, 5.25, 2.7, 0.7, side);
    this.box(10.8, 5.5, 0.4, 0, 2.7, 8.4, wall);
    this.box(3.9, 5.5, 0.5, -3.4, 2.7, -6.8, wall);
    this.box(3.9, 5.5, 0.5, 3.4, 2.7, -6.8, wall);
    this.box(
      10.8,
      0.3,
      15.5,
      0,
      5.45,
      0.7,
      new THREE.MeshLambertMaterial({ color: 0x25252a }),
    ).castShadow = false;
    for (const z of [-6.5, -1.8, 3.8]) {
      for (const x of [-2.9, 2.9]) {
        this.box(0.46, 3.1, 0.55, x, 1.55, z, column);
        this.box(0.72, 0.22, 0.8, x, 0.11, z, stone);
        this.box(0.68, 0.22, 0.75, x, 3, z, stone);
        this.obstacles.push({ x, z, halfX: 0.36, halfZ: 0.4 });
      }
      this.arch(2.66, 3.05, 0.26, z, archMat);
      for (const x of [-4, 4]) this.box(2.15, 0.3, 0.55, x, 3.13, z, stone);
    }
    this.arch(1.48, 2, 0.4, -6.65, archMat);
    this.portal = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 3.6),
      new THREE.MeshBasicMaterial({ color: 0x475557 }),
    );
    this.portal.position.set(0, 1.8, -6.87);
    this.scene.add(this.portal);
    for (let x = -1.1; x <= 1.11; x += 0.24) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 3.1, 0.075),
        iron,
      );
      bar.position.set(x, 1.55, 0);
      bar.castShadow = true;
      this.gate.add(bar);
    }
    for (const y of [0.3, 2.4]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.1), iron);
      rail.position.y = y;
      this.gate.add(rail);
    }
    this.gate.position.z = -6.55;
    this.scene.add(this.gate);
    for (const side of [-1, 1])
      for (const z of [-4.5, 0.7, 5.4]) {
        this.box(
          0.2,
          2.5,
          1.5,
          side * 4.96,
          1.25,
          z,
          new THREE.MeshLambertMaterial({ color: 0x15151a }),
        );
        this.box(0.28, 0.18, 1.7, side * 4.82, 0.22, z, stone);
      }
    this.box(1.45, 0.75, 0.9, -3.65, 0.38, -0.4, stone);
    this.box(1.7, 0.14, 1.05, -3.65, 0.83, -0.4, archMat);
    this.obstacles.push({ x: -3.65, z: -0.4, halfX: 0.85, halfZ: 0.6 });
    this.box(0.8, 0.66, 0.8, 3.7, 0.33, 1.5, stone);
    const urn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.28, 0.45, 7),
      iron,
    );
    urn.position.set(3.7, 0.9, 1.5);
    urn.castShadow = true;
    this.scene.add(urn);
    this.obstacles.push({ x: 3.7, z: 1.5, halfX: 0.47, halfZ: 0.47 });
    for (let i = 0; i < 28; i++) {
      const rock = this.box(
        0.16 + (i % 4) * 0.11,
        0.11 + (i % 3) * 0.08,
        0.18 + (i % 5) * 0.08,
        (i % 2 ? 1 : -1) * (3.7 + Math.sin(i * 7) * 0.6),
        0.06,
        -5.9 + ((i * 17) % 120) / 10,
        stone,
      );
      rock.rotation.y = i * 0.91;
      rock.rotation.z = Math.sin(i) * 0.17;
    }
    for (const z of [-4.6, 1.8, 6.1])
      for (const x of [-4.75, 4.75]) this.torch(x, z, iron);
    const gateLight = new THREE.PointLight(0xaebfc3, 8, 6, 2);
    gateLight.position.set(0, 2, -6);
    this.scene.add(gateLight);
    this.addSymbol("keeper", 0, 2.18, -3.2, 0xb5a090);
    this.addSymbol("inscription", -3.65, 1.22, -0.4, 0xa2b4b8);
    this.addSymbol("echo", 3.7, 1.3, 1.5, 0xc3ac8d);
    this.addSymbol("exit", 0, 3.5, -6.5, 0xc8d3cc);
    this.symbols.get("exit")!.visible = false;
    const dustGeo = new THREE.BufferGeometry(),
      positions = new Float32Array(300);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = Math.sin(i * 31.4) * 4.8;
      positions[i + 1] = ((i * 17) % 100) / 24 + 0.1;
      positions[i + 2] = Math.cos(i * 13.7) * 6;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xb2b0a2,
        size: 0.019,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    this.scene.add(this.dust, this.player.root, this.keeper.root);
    this.player.root.position.set(0, 0.025, 4);
    this.player.root.rotation.set(0, Math.PI, 0);
    this.keeper.root.position.set(0, 0.025, -3.2);
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraAim);
    window.addEventListener("resize", () => this.resize());
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      window.dispatchEvent(new Event("game-context-lost"));
    });
    this.resize();
  }
  async load() {
    await this.renderer.compileAsync(this.scene, this.camera);
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
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
        bevelEnabled: false,
        curveSegments: 10,
      }),
      m,
    );
    mesh.position.z = z;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }
  private torch(x: number, z: number, m: THREE.Material) {
    this.box(0.18, 0.8, 0.16, x, 1.7, z, m);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.065, 0.27, 5),
      new THREE.MeshBasicMaterial({ color: 0xe7b37a }),
    );
    flame.position.set(x, 2.24, z);
    this.scene.add(flame);
    this.flames.push(flame);
    const light = new THREE.PointLight(0xe5ad78, 8, 6, 2);
    light.position.set(x * 0.96, 2.3, z);
    this.scene.add(light);
  }
  private addSymbol(
    id: Target,
    x: number,
    y: number,
    z: number,
    color: number,
  ) {
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        new THREE.OctahedronGeometry(0.045),
        new THREE.MeshBasicMaterial({ color }),
      ),
    );
    group.add(
      new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.005, 3, 12),
        new THREE.MeshBasicMaterial({ color }),
      ),
    );
    group.position.set(x, y, z);
    group.userData.baseY = y;
    this.scene.add(group);
    this.symbols.set(id, group);
  }
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.003, -0.3, 0.5);
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const rh = Math.min(h, this.touch ? 440 : 360);
    this.renderer.setSize(Math.round((rh * w) / h), rh, false);
  }
  setState(state: GameState) {
    const wasCombat = this.mode === "combat";
    this.state = state;
    if (state.phase === "combat") {
      if (!wasCombat) {
        this.player.root.position.set(-0.75, 0.025, -1.2);
        this.keeper.root.position.set(0.8, 0.025, -3.05);
      }
      this.mode = "combat";
    } else {
      this.mode = "explore";
      if (state.phase === "won" && wasCombat) {
        this.keeper.play("die", true);
        this.player.play("emote-yes", true);
      }
    }
    this.symbols.get("keeper")!.visible = state.phase === "explore";
    this.symbols.get("inscription")!.visible =
      !state.secrets.includes("inscription");
    this.symbols.get("echo")!.visible =
      state.phase === "won" && !state.secrets.includes("echo");
    this.symbols.get("exit")!.visible = state.phase === "won";
  }
  reset(state: GameState) {
    this.mode = "explore";
    this.yaw = 0;
    this.pitch = 0;
    this.keeper.root.visible = true;
    this.keeper.root.scale.setScalar(1.13);
    this.keeper.root.position.set(0, 0.025, -3.2);
    this.player.root.position.set(0, 0.025, 4);
    this.player.root.rotation.set(0, Math.PI, 0);
    this.keeper.root.rotation.set(0, 0, 0);
    this.player.play("idle");
    this.keeper.play("idle");
    this.battleAnimation = 0;
    this.setState(state);
  }
  animateAction(action: string) {
    this.battleAnimation = 1;
    this.player.play(
      action === "guard" ? "interact-right" : "attack-melee-right",
      true,
    );
  }
  nearest(): { id: Target; title: string } | null {
    if (this.mode !== "explore" || !this.state) return null;
    const targets: {
      id: Target;
      title: string;
      x: number;
      z: number;
      active: boolean;
    }[] = [
      {
        id: "keeper",
        title: "Хранитель архива",
        x: 0,
        z: -3.2,
        active: this.state.phase === "explore",
      },
      {
        id: "inscription",
        title: this.state.secrets.includes("inscription")
          ? "Знакомая надпись"
          : "Надпись без имени",
        x: -3.65,
        z: -0.4,
        active: true,
      },
      { id: "echo", title: "Тихое эхо", x: 3.7, z: 1.5, active: true },
      {
        id: "exit",
        title: this.state.phase === "won" ? "Путь открыт" : "Закрытая арка",
        x: 0,
        z: -6,
        active: true,
      },
    ];
    let nearest = null,
      distance = 1.7;
    for (const t of targets) {
      const d = Math.hypot(
        this.player.root.position.x - t.x,
        this.player.root.position.z - t.z,
      );
      if (t.active && d < distance) {
        nearest = { id: t.id, title: t.title };
        distance = d;
      }
    }
    return nearest;
  }
  update(dt: number, axis: { x: number; y: number }, allowMove: boolean) {
    this.elapsed += dt;
    const p = this.player.root.position;
    if (allowMove && this.mode === "explore") {
      if (Math.hypot(axis.x, axis.y) > 0.01) {
        const dx =
            (axis.x * Math.cos(this.yaw) + axis.y * Math.sin(this.yaw)) *
            dt *
            2.5,
          dz =
            (-axis.x * Math.sin(this.yaw) + axis.y * Math.cos(this.yaw)) *
            dt *
            2.5;
        const clear = (x: number, z: number) =>
          !this.obstacles.some(
            (o) =>
              Math.abs(x - o.x) < o.halfX + 0.22 &&
              Math.abs(z - o.z) < o.halfZ + 0.22,
          );
        const nx = THREE.MathUtils.clamp(p.x + dx, -4.7, 4.7),
          nz = THREE.MathUtils.clamp(p.z + dz, -5.9, 6.9);
        if (clear(nx, p.z)) p.x = nx;
        if (clear(p.x, nz)) p.z = nz;
        const angle = Math.atan2(dx, dz);
        this.player.root.rotation.y +=
          Math.atan2(
            Math.sin(angle - this.player.root.rotation.y),
            Math.cos(angle - this.player.root.rotation.y),
          ) * Math.min(1, dt * 14);
        this.player.play("walk");
        this.stepTime += dt;
        if (this.stepTime > 0.36) {
          this.stepTime = 0;
          this.onStep();
        }
      } else {
        this.player.play("idle");
        this.stepTime = 0;
      }
    }
    if (this.mode === "combat") {
      // Keep the characters upright. Object3D.lookAt can decompose a turn into
      // X/Z rotations of PI, which reverses subsequent movement-facing updates.
      const direction = Math.atan2(
        this.keeper.root.position.x - p.x,
        this.keeper.root.position.z - p.z,
      );
      this.player.root.rotation.set(0, direction, 0);
      this.keeper.root.rotation.set(0, direction + Math.PI, 0);
    }
    if (this.battleAnimation > 0) {
      this.battleAnimation -= dt;
      if (
        this.battleAnimation < 0.5 &&
        this.battleAnimation + dt >= 0.5 &&
        this.state?.phase !== "won"
      )
        this.keeper.play("attack-melee-right", true);
    }
    if (this.state?.phase === "won") {
      this.gate.position.y = THREE.MathUtils.damp(
        this.gate.position.y,
        3.7,
        2,
        dt,
      );
      this.keeper.root.scale.setScalar(
        THREE.MathUtils.damp(this.keeper.root.scale.x, 0, 1.5, dt),
      );
      if (this.keeper.root.scale.x < 0.015) this.keeper.root.visible = false;
      (this.portal.material as THREE.MeshBasicMaterial).color.lerp(
        new THREE.Color(0xadb5a8),
        dt * 0.8,
      );
    } else {
      this.gate.position.y = THREE.MathUtils.damp(
        this.gate.position.y,
        0,
        5,
        dt,
      );
      (this.portal.material as THREE.MeshBasicMaterial).color.set(0x475557);
    }
    this.player.update(dt);
    this.keeper.update(dt);
    for (const g of this.symbols.values()) {
      g.position.y = g.userData.baseY + Math.sin(this.elapsed * 1.7) * 0.035;
      g.rotation.y = this.elapsed * 0.25;
    }
    for (let i = 0; i < this.flames.length; i++)
      this.flames[i].scale.y = 0.9 + Math.sin(this.elapsed * 13 + i) * 0.12;
    this.dust.rotation.y = Math.sin(this.elapsed * 0.08) * 0.025;
    let aim: THREE.Vector3, position: THREE.Vector3;
    if (this.mode === "combat") {
      aim = new THREE.Vector3(0.05, 1.05, -2.15);
      position =
        this.camera.aspect < 0.85
          ? new THREE.Vector3(3.6, 2.2, 3.6)
          : new THREE.Vector3(3.5, 2.1, 2.4);
    } else {
      aim = new THREE.Vector3(
        p.x - Math.sin(this.yaw) * 0.35,
        1.13,
        p.z - Math.cos(this.yaw) * 0.35,
      );
      const d = this.camera.aspect < 0.85 ? 3.9 : 3.7;
      position = new THREE.Vector3(
        p.x + Math.sin(this.yaw) * d,
        2.02 + this.pitch * 2,
        p.z + Math.cos(this.yaw) * d,
      );
      position.x = THREE.MathUtils.clamp(position.x, -4.8, 4.8);
      position.z = THREE.MathUtils.clamp(position.z, -6.4, 7.8);
    }
    const alpha = 1 - Math.exp(-dt * 6);
    this.cameraAim.lerp(aim, alpha);
    this.cameraPosition.lerp(position, alpha);
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraAim);
    this.renderer.render(this.scene, this.camera);
  }
}
