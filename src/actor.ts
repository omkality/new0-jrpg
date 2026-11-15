import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { ATTACKS, type Fighter, type EnemyKind } from "./game";

type Kind = "pilgrim" | EnemyKind;
interface RigState {
  rig: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  hand?: THREE.Object3D;
  weapon: THREE.Group;
  current: string;
  action?: THREE.AnimationAction;
  dropped: boolean;
}
const cache = new Map<string, Promise<GLTF>>();
const load = (url: string) => {
  let p = cache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url);
    cache.set(url, p);
  }
  return p;
};
const MODELS = {
  pilgrim: "prisoner",
  effigy: "prisoner",
  gaoler: "gaoler",
  watcher: "watcher",
} as const;
export class Actor {
  root = new THREE.Group();
  private states = new Map<Kind, RigState>();
  private active?: RigState;
  private kind?: Kind;
  constructor(private enemy = false) {}
  async load() {
    const kinds: Kind[] = this.enemy
      ? ["gaoler", "effigy", "watcher"]
      : ["pilgrim"];
    await Promise.all(
      kinds.map(async (kind) => {
        const model = MODELS[kind],
          motion = model === "gaoler" ? "gaoler" : "prisoner";
        const [gltf, combat] = await Promise.all([
          load(`/assets/cast/${model}.glb`),
          load(`/assets/motion/${motion}-combat.glb`),
        ]);
        const rig = clone(gltf.scene);
        rig.visible = false;
        this.root.add(rig);
        rig.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const m = (o.material as THREE.MeshStandardMaterial).clone();
            m.roughness = 0.96;
            m.metalness = 0;
            m.normalMap = null;
            m.envMapIntensity = 0.2;
            m.color.set(
              kind === "pilgrim"
                ? 0xc9c1b1
                : kind === "effigy"
                  ? 0xb5c3b9
                  : kind === "gaoler"
                    ? 0xa9a69a
                    : 0x9fa8a9,
            );
            o.material = m;
            o.frustumCulled = false;
          }
        });
        if (kind === "effigy") rig.scale.set(0.84, 1.06, 0.84);
        const mixer = new THREE.AnimationMixer(rig),
          actions = new Map<string, THREE.AnimationAction>();
        for (const clip of [...gltf.animations, ...combat.animations])
          actions.set(clip.name, mixer.clipAction(clip));
        const hand = rig.getObjectByName("hand_R"),
          weapon = this.makeWeapon(kind);
        hand?.add(weapon);
        this.states.set(kind, {
          rig,
          mixer,
          actions,
          hand,
          weapon,
          current: "",
          dropped: false,
        });
      }),
    );
  }
  private makeWeapon(kind: Kind) {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({
      color: 0x7d8581,
      metalness: 0.25,
      roughness: 0.8,
      flatShading: true,
    });
    const grip = new THREE.MeshStandardMaterial({
      color: 0x352d27,
      roughness: 1,
    });
    const shape = new THREE.Shape();
    if (kind === "gaoler") {
      shape.moveTo(-0.055, 0);
      shape.lineTo(0.1, 0);
      shape.lineTo(0.18, 0.48);
      shape.lineTo(0.13, 0.68);
      shape.lineTo(-0.04, 0.61);
      shape.closePath();
    } else {
      const width = kind === "watcher" ? 0.026 : 0.037,
        len = kind === "watcher" ? 1.03 : 0.83;
      shape.moveTo(-width, 0);
      shape.lineTo(width, 0);
      shape.lineTo(width * 0.7, len - 0.14);
      shape.lineTo(0, len);
      shape.lineTo(-width * 0.9, len - 0.12);
      shape.closePath();
    }
    const blade = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: kind === "gaoler" ? 0.038 : 0.016,
        bevelEnabled: true,
        bevelSize: 0.007,
        bevelThickness: 0.005,
        bevelSegments: 1,
      }),
      steel,
    );
    blade.position.y = 0.11;
    g.add(blade);
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(kind === "gaoler" ? 0.22 : 0.19, 0.032, 0.04),
      steel,
    );
    guard.position.y = 0.085;
    g.add(guard);
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.028, 0.19, 8),
      grip,
    );
    g.add(handle);
    const end = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), steel);
    end.position.y = -0.12;
    g.add(end);
    g.position.set(0, 0.06, 0);
    g.rotation.x = -Math.PI / 2;
    return g;
  }
  private change(s: RigState, name: string, once: boolean) {
    if (s.current === name) return;
    const action = s.actions.get(name) ?? s.actions.get("Idle")!;
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.setLoop(
      once ? THREE.LoopOnce : THREE.LoopRepeat,
      once ? 1 : Infinity,
    );
    action.clampWhenFinished = once;
    action.play();
    s.action?.fadeOut(once ? 0.06 : 0.15);
    action.fadeIn(once ? 0.06 : 0.15);
    s.action = action;
    s.current = name;
  }
  sampleWeapon(base: THREE.Vector3, tip: THREE.Vector3) {
    if (!this.active) return false;
    this.active.weapon.updateWorldMatrix(true, false);
    base.set(0, 0.12, 0).applyMatrix4(this.active.weapon.matrixWorld);
    tip
      .set(0, this.kind === "gaoler" ? 0.76 : 1, 0)
      .applyMatrix4(this.active.weapon.matrixWorld);
    return true;
  }
  update(dt: number, f: Fighter) {
    const kind = f.kind as Kind,
      s = this.states.get(kind);
    if (!s) return;
    if (this.kind !== kind) {
      if (this.active) {
        if (this.active.dropped) {
          this.active.hand?.add(this.active.weapon);
          this.active.weapon.position.set(0, 0.06, 0);
          this.active.weapon.rotation.set(-Math.PI / 2, 0, 0);
          this.active.dropped = false;
        }
        this.active.rig.visible = false;
      }
      s.rig.visible = true;
      this.kind = kind;
      this.active = s;
    }
    this.root.position.set(f.x, 0, f.z);
    this.root.rotation.set(0, f.yaw, 0);
    const mode = f.mode;
    const attackIndex = Math.max(1, Math.min(3, f.combo || 1));
    const name =
      mode === "dead"
        ? "Death"
        : mode === "attack" || mode === "windup"
          ? `Attack${attackIndex}`
          : mode === "dodge"
            ? `Dodge${f.dodgeSide}`
            : mode === "guard"
              ? f.recoil > 0
                ? "BlockHit"
                : "Guard"
              : mode === "hit"
                ? ["HitFront", "HitLeft", "HitRight"][f.reaction]
                : f.speed > 1.65
                  ? "Run"
                  : f.speed > 0.1
                    ? "Walk"
                    : "Idle";
    const once = !["Idle", "Walk", "Run", "Guard"].includes(name);
    this.change(s, name, once);
    const action = s.action!;
    action.paused = false;
    if (mode === "windup") {
      action.time = Math.min(0.2, ATTACKS[attackIndex - 1].contact * 0.72);
      action.paused = true;
    } else if (
      mode === "attack" ||
      mode === "dodge" ||
      mode === "dead" ||
      mode === "hit"
    ) {
      const time =
        mode === "attack" && this.enemy
          ? ATTACKS[attackIndex - 1].contact * 0.72 +
            (f.time *
              (action.getClip().duration -
                ATTACKS[attackIndex - 1].contact * 0.72)) /
              0.68
          : f.time;
      action.time = Math.min(action.getClip().duration - 0.001, time);
      action.paused = true;
    } else if (mode === "guard" && f.recoil > 0) {
      action.time = 0.32 - f.recoil;
      action.paused = true;
    } else
      action.setEffectiveTimeScale(
        name === "Run"
          ? Math.max(0.7, f.speed / 2.6)
          : name === "Walk"
            ? Math.max(0.55, f.speed / 1.05)
            : 1,
      );
    s.mixer.update(dt);
    if (mode === "dead" && f.time > 0.65) {
      if (!s.dropped) {
        this.root.updateMatrixWorld(true);
        this.root.attach(s.weapon);
        s.dropped = true;
      }
      s.weapon.position.y = THREE.MathUtils.damp(
        s.weapon.position.y,
        0.045,
        12,
        dt,
      );
      s.weapon.rotation.x = THREE.MathUtils.damp(
        s.weapon.rotation.x,
        Math.PI / 2,
        12,
        dt,
      );
      s.weapon.rotation.y = THREE.MathUtils.damp(
        s.weapon.rotation.y,
        0,
        12,
        dt,
      );
      s.weapon.rotation.z = THREE.MathUtils.damp(
        s.weapon.rotation.z,
        0.35,
        12,
        dt,
      );
    } else if (mode !== "dead" && s.dropped) {
      s.hand?.add(s.weapon);
      s.weapon.position.set(0, 0.06, 0);
      s.weapon.rotation.set(-Math.PI / 2, 0, 0);
      s.dropped = false;
    }
  }
}
