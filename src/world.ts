import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GameState } from "./api";

type Obstacle = { x: number; z: number; halfX: number; halfZ: number };
export type Target = "keeper" | "inscription" | "echo" | "exit";

class Actor {
  root = new THREE.Group();
  model!: THREE.Group;
  mixer!: THREE.AnimationMixer;
  actions = new Map<string, THREE.AnimationAction>();
  current = "";
  async load(url: string, height: number, tint: number) {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.model = gltf.scene;
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const scale = height / (box.max.y - box.min.y);
    this.model.scale.setScalar(scale);
    this.model.position.y = -box.min.y * scale;
    this.model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      const converted = materials.map((original) => {
        const mat = original as THREE.MeshStandardMaterial;
        const copy = new THREE.MeshLambertMaterial({
          map: mat.map,
          color: mat.color.clone().multiply(new THREE.Color(tint)),
        });
        if (copy.map) {
          copy.map.magFilter = THREE.NearestFilter;
          copy.map.minFilter = THREE.NearestMipmapNearestFilter;
        }
        return copy;
      });
      node.material = Array.isArray(node.material) ? converted : converted[0];
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations)
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.play("idle");
  }
  play(name: string, once = false) {
    if (name === this.current && !once) return;
    const next = this.actions.get(name) ?? this.actions.get("idle");
    if (!next) return;
    const previous = this.actions.get(this.current);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (previous && previous !== next)
      next.crossFadeFrom(previous, 0.12, false);
    this.current = name;
  }
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  player = new Actor();
  keeper = new Actor();
  onStep = () => {};
  private obstacles: Obstacle[] = [];
  private gate = new THREE.Group();
  private portal: THREE.Mesh;
  private symbols = new Map<Target, THREE.Group>();
  private lights: THREE.PointLight[] = [];
  private dust: THREE.Points;
  private state: GameState | null = null;
  private mode: "intro" | "explore" | "combat" = "intro";
  private elapsed = 0;
  private stepTime = 0;
  private battleAnimation = 0;
  private lastAction = "";
  private cameraAim = new THREE.Vector3(0, 0.5, -0.7);
  private lightColor = new THREE.Color(0xc4d4b3);
  private canvas: HTMLCanvasElement;
  private touch: boolean;

  constructor(canvas: HTMLCanvasElement, touch: boolean) {
    this.canvas = canvas;
    this.touch = touch;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x17231d);
    this.scene.fog = new THREE.FogExp2(0x17231d, 0.028);
    this.scene.add(new THREE.HemisphereLight(0xcbd6b7, 0x253227, 2.3));
    const sun = new THREE.DirectionalLight(0xffe0af, 3.2);
    sun.position.set(-3, 9, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(touch ? 512 : 1024, touch ? 512 : 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 25;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);

    const stoneMap = this.texture();
    const stone = new THREE.MeshStandardMaterial({
      map: stoneMap,
      color: 0x8d9981,
      roughness: 1,
      flatShading: true,
    });
    const darkStone = stone.clone();
    darkStone.color.set(0x64725d);
    const trim = stone.clone();
    trim.color.set(0xb9b59a);
    this.box(12.4, 0.48, 10.8, 0, -0.32, 0, darkStone);
    const tileMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.95, 0.12, 0.95),
      stone,
      120,
    );
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let index = 0;
    for (let x = -5.5; x <= 5.5; x++)
      for (let z = -4.5; z <= 4.5; z++) {
        matrix.makeTranslation(x, -0.035 + Math.sin(x * 7 + z * 11) * 0.014, z);
        tileMesh.setMatrixAt(index, matrix);
        color.setScalar(0.72 + ((index * 17) % 23) / 100);
        tileMesh.setColorAt(index++, color);
      }
    tileMesh.receiveShadow = true;
    this.scene.add(tileMesh);
    // A cutaway room keeps its near walls from obscuring the player.
    this.box(4.65, 4.1, 0.55, -3.825, 2, -5, stone);
    this.box(4.65, 4.1, 0.55, 3.825, 2, -5, stone);
    this.box(0.5, 3.5, 10.7, -6, 1.7, 0, stone);
    this.box(12.4, 0.18, 0.7, 0, -0.45, 5.65, trim);
    this.box(10.7, 0.18, 0.6, 0, -0.62, 6.13, darkStone);
    for (const x of [-5.55, -3.4, 3.4, 5.55]) {
      this.box(0.22, 4.4, 0.8, x, 2.05, -4.75, trim);
      this.box(0.5, 0.16, 1, x, 0.15, -4.75, trim);
      this.box(0.5, 0.22, 0.9, x, 4.15, -4.75, trim);
    }
    // Individual mortar rows give the walls depth at deliberately low texture resolution.
    for (let row = 0; row < 9; row++) {
      for (const side of [-1, 1])
        this.box(
          4.4,
          0.026,
          0.06,
          side * 3.8,
          row * 0.45 + 0.1,
          -4.7,
          darkStone,
        );
    }
    const arch = new THREE.Shape();
    arch.moveTo(-1.58, 0);
    arch.lineTo(-1.58, 1.75);
    arch.absarc(0, 1.75, 1.58, Math.PI, 0, true);
    arch.lineTo(1.58, 0);
    arch.lineTo(1.17, 0);
    arch.lineTo(1.17, 1.75);
    arch.absarc(0, 1.75, 1.17, 0, Math.PI, false);
    arch.lineTo(-1.17, 0);
    arch.closePath();
    const archMesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(arch, {
        depth: 0.55,
        bevelEnabled: false,
        curveSegments: 9,
      }),
      trim,
    );
    archMesh.position.set(0, 0, -5.1);
    archMesh.castShadow = true;
    this.scene.add(archMesh);
    this.portal = new THREE.Mesh(
      new THREE.PlaneGeometry(2.45, 3.2),
      new THREE.MeshBasicMaterial({ color: 0x456753 }),
    );
    this.portal.position.set(0, 1.6, -5.07);
    this.scene.add(this.portal);
    const iron = new THREE.MeshStandardMaterial({
      color: 0x28372e,
      metalness: 0.6,
      roughness: 0.8,
    });
    for (let x = -1; x <= 1.01; x += 0.25) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 2.9, 0.08), iron);
      bar.position.set(x, 1.45, 0);
      bar.castShadow = true;
      this.gate.add(bar);
    }
    for (const y of [0.4, 2.2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.09, 0.08), iron);
      bar.position.y = y;
      this.gate.add(bar);
    }
    this.gate.position.set(0, 0, -4.88);
    this.scene.add(this.gate);
    this.point(0xa8cfac, 7, 4, 0, 1.4, -4.1);

    const red = new THREE.MeshStandardMaterial({
      color: 0x5d3f36,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    for (const x of [-3.35, 3.35]) {
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(0.75, 1.65, 1, 4),
        red,
      );
      banner.position.set(x, 2.3, -4.64);
      this.scene.add(banner);
      const sigil = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.18, 5),
        new THREE.MeshBasicMaterial({
          color: 0xc3a27c,
          side: THREE.DoubleSide,
        }),
      );
      sigil.position.set(x, 2.4, -4.62);
      this.scene.add(sigil);
    }
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(2.45, 7.5),
      new THREE.MeshStandardMaterial({ color: 0x424d3d, roughness: 1 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.045, -0.4);
    rug.receiveShadow = true;
    this.scene.add(rug);
    for (const x of [-1.13, 1.13])
      this.box(
        0.02,
        0.008,
        7.4,
        x,
        0.052,
        -0.4,
        new THREE.MeshBasicMaterial({ color: 0x8b8d64 }),
      );

    this.addSymbol("keeper", 0, 2.45, -2.45, 0xd1a485);
    this.addSymbol("inscription", -3.65, 1.35, -0.8, 0x93c6aa);
    this.addSymbol("echo", 3.55, 1.2, 1.5, 0xd1a485);
    this.addSymbol("exit", 0, 3.6, -4.7, 0xd1d8b6);
    this.symbols.get("exit")!.visible = false;
    const dustGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(150 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = Math.sin(i * 31.4) * 5.7;
      positions[i + 1] = ((i * 17) % 100) / 25 + 0.1;
      positions[i + 2] = Math.cos(i * 13.7) * 4.7;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xd3d8b4,
        size: 0.027,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    this.scene.add(this.dust);
    this.scene.add(this.player.root, this.keeper.root);
    this.player.root.position.set(0, 0.04, 3.25);
    this.keeper.root.position.set(0, 0.04, -2.45);
    this.keeper.root.rotation.y = Math.PI;
    window.addEventListener("resize", () => this.resize());
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      window.dispatchEvent(new Event("game-context-lost"));
    });
    this.resize();
  }

  async load() {
    await Promise.all([
      this.player.load("/assets/kenney/character-keeper.glb", 1.45, 0xb5bd9f),
      this.keeper.load("/assets/kenney/character-skeleton.glb", 1.65, 0xb9ab96),
      this.decor("altar-stone", -3.65, -0.8, 1, 0),
      this.decor("candle-multiple", -3.65, -0.8, 0.4, 0, 1),
      this.decor("column-large", -4.6, 2.5, 2.6),
      this.decor("column-large", 4.6, -2.6, 2.6),
      this.decor("urn-round", 3.55, 1.5, 0.95),
      this.decor("bench", 3.5, 3.8, 0.9, -0.18),
    ]);
    this.point(0xe7b77b, 3, 3, -3.65, 1.3, -0.8);
    this.obstacles.push(
      { x: -3.65, z: -0.8, halfX: 0.65, halfZ: 0.52 },
      { x: -4.6, z: 2.5, halfX: 0.48, halfZ: 0.48 },
      { x: 4.6, z: -2.6, halfX: 0.48, halfZ: 0.48 },
      { x: 3.55, z: 1.5, halfX: 0.38, halfZ: 0.38 },
      { x: 3.5, z: 3.8, halfX: 1, halfZ: 0.38 },
    );
  }

  private async decor(
    name: string,
    x: number,
    z: number,
    height: number,
    rotation = 0,
    y = 0,
  ) {
    const { scene } = await new GLTFLoader().loadAsync(
      `/assets/kenney/${name}.glb`,
    );
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const scale = height / (box.max.y - box.min.y);
    scene.scale.setScalar(scale);
    scene.position.set(x, y - box.min.y * scale, z);
    scene.rotation.y = rotation;
    scene.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        n.castShadow = true;
        n.receiveShadow = true;
      }
    });
    this.scene.add(scene);
  }

  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }
  private point(
    color: number,
    intensity: number,
    distance: number,
    x: number,
    y: number,
    z: number,
  ) {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    this.scene.add(light);
    this.lights.push(light);
  }
  private addSymbol(
    id: Target,
    x: number,
    y: number,
    z: number,
    color: number,
  ) {
    const group = new THREE.Group();
    const shape = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshBasicMaterial({ color }),
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.009, 3, 16),
      new THREE.MeshBasicMaterial({ color }),
    );
    group.add(shape, ring);
    group.position.set(x, y, z);
    group.userData.baseY = y;
    this.symbols.set(id, group);
    this.scene.add(group);
  }
  private texture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(64, 64);
    for (let i = 0; i < 4096; i++) {
      const n = ((i * 1103515245 + 12345) >>> 16) % 29;
      const edge = i % 64 < 2 || Math.floor(i / 64) < 2 ? -18 : 0;
      image.data.set(
        [148 + n + edge, 151 + n + edge, 133 + n + edge, 255],
        i * 4,
      );
    }
    context.putImageData(image, 0, 0);
    context.strokeStyle = "#75816a";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(45, 0);
    context.lineTo(39, 18);
    context.lineTo(45, 22);
    context.lineTo(35, 37);
    context.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapNearestFilter;
    return texture;
  }

  resize() {
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const scale = this.touch ? 0.85 : Math.min(1, 1100 / width);
    this.renderer.setSize(
      Math.round(width * scale),
      Math.round(height * scale),
      false,
    );
  }

  setState(state: GameState) {
    const wasCombat = this.mode === "combat";
    this.state = state;
    if (state.phase === "combat") {
      if (!wasCombat) {
        this.player.root.position.set(-0.85, 0.04, 0.45);
        this.keeper.root.position.set(0.8, 0.04, -1.1);
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
    this.keeper.root.visible = true;
    this.keeper.root.scale.setScalar(1);
    this.keeper.root.position.set(0, 0.04, -2.45);
    this.player.root.position.set(0, 0.04, 3.25);
    this.player.play("idle");
    this.keeper.play("idle");
    this.battleAnimation = 0;
    this.setState(state);
  }
  animateAction(action: string) {
    this.lastAction = action;
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
        z: -2.45,
        active: this.state.phase === "explore",
      },
      {
        id: "inscription",
        title: this.state.secrets.includes("inscription")
          ? "Знакомая надпись"
          : "Надпись без имени",
        x: -3.65,
        z: -0.8,
        active: true,
      },
      { id: "echo", title: "Тихое эхо", x: 3.55, z: 1.5, active: true },
      {
        id: "exit",
        title: this.state.phase === "won" ? "Путь открыт" : "Закрытая арка",
        x: 0,
        z: -4.3,
        active: true,
      },
    ];
    let nearest = null,
      distance = 1.65;
    for (const target of targets) {
      const d = Math.hypot(
        this.player.root.position.x - target.x,
        this.player.root.position.z - target.z,
      );
      if (target.active && d < distance) {
        nearest = { id: target.id, title: target.title };
        distance = d;
      }
    }
    return nearest;
  }

  update(dt: number, axis: { x: number; y: number }, allowMove: boolean) {
    this.elapsed += dt;
    const p = this.player.root.position;
    if (allowMove && this.mode === "explore") {
      const moving = Math.hypot(axis.x, axis.y) > 0.01;
      if (moving) {
        // Screen-relative directions on the room's XZ plane.
        const dx = (axis.x * 0.82 + axis.y * 0.57) * dt * 2.8;
        const dz = (axis.x * -0.57 + axis.y * 0.82) * dt * 2.8;
        const clear = (x: number, z: number) =>
          !this.obstacles.some(
            (o) =>
              Math.abs(x - o.x) < o.halfX + 0.25 &&
              Math.abs(z - o.z) < o.halfZ + 0.25,
          );
        const nx = THREE.MathUtils.clamp(p.x + dx, -5.5, 5.45);
        const nz = THREE.MathUtils.clamp(p.z + dz, -4.3, 4.6);
        if (clear(nx, p.z)) p.x = nx;
        if (clear(p.x, nz)) p.z = nz;
        const target = Math.atan2(dx, dz);
        this.player.root.rotation.y +=
          Math.atan2(
            Math.sin(target - this.player.root.rotation.y),
            Math.cos(target - this.player.root.rotation.y),
          ) * Math.min(1, dt * 14);
        this.player.play("walk");
        this.stepTime += dt;
        if (this.stepTime > 0.31) {
          this.stepTime = 0;
          this.onStep();
        }
      } else {
        this.player.play("idle");
        this.stepTime = 0;
      }
    }
    if (this.mode === "combat") {
      this.player.root.lookAt(this.keeper.root.position);
      this.keeper.root.lookAt(this.player.root.position);
    }
    if (this.battleAnimation > 0) {
      this.battleAnimation -= dt;
      if (
        this.battleAnimation < 0.5 &&
        this.battleAnimation + dt >= 0.5 &&
        this.state?.phase !== "won"
      )
        this.keeper.play("attack-melee-right", true);
      if (this.battleAnimation <= 0 && this.state?.phase === "combat") {
        this.player.play("idle");
        this.keeper.play("idle");
      }
      this.lightColor.set(this.lastAction === "pulse" ? 0xc5e8df : 0xc4d4b3);
    }
    if (this.state?.phase === "won") {
      this.gate.position.y = THREE.MathUtils.damp(
        this.gate.position.y,
        3.4,
        2,
        dt,
      );
      this.keeper.root.scale.setScalar(
        THREE.MathUtils.damp(this.keeper.root.scale.x, 0, 1.5, dt),
      );
      if (this.keeper.root.scale.x < 0.015) this.keeper.root.visible = false;
      (this.portal.material as THREE.MeshBasicMaterial).color.lerp(
        new THREE.Color(0xbfcfa4),
        dt * 0.8,
      );
    } else {
      this.gate.position.y = THREE.MathUtils.damp(
        this.gate.position.y,
        0,
        5,
        dt,
      );
      (this.portal.material as THREE.MeshBasicMaterial).color.set(0x456753);
    }
    this.player.mixer?.update(dt);
    this.keeper.mixer?.update(dt);
    for (const group of this.symbols.values()) {
      group.position.y =
        group.userData.baseY + Math.sin(this.elapsed * 1.7) * 0.055;
      group.rotation.y = this.elapsed * 0.25;
    }
    this.dust.rotation.y = Math.sin(this.elapsed * 0.08) * 0.035;
    const aspect = this.camera.aspect;
    const battle = this.mode === "combat";
    const intro = this.mode === "intro";
    let aim = new THREE.Vector3(
      battle ? -0.1 : 0,
      battle ? 0.65 : 0.4,
      battle ? -0.4 : -0.5,
    );
    if (aspect < 0.85 && !intro && !battle)
      aim = new THREE.Vector3(p.x * 0.5, 0.35, p.z * 0.35 - 0.5);
    this.cameraAim.lerp(aim, 1 - Math.exp(-dt * 3));
    const distance = battle
      ? aspect < 0.85
        ? 12.5
        : 9.5
      : aspect < 0.85
        ? 20
        : 18.5;
    this.camera.position
      .copy(this.cameraAim)
      .add(
        new THREE.Vector3(0.48, 0.62, 0.76)
          .normalize()
          .multiplyScalar(distance),
      );
    this.camera.lookAt(this.cameraAim);
    this.renderer.render(this.scene, this.camera);
  }
}
