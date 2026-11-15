import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { Fighter } from "./game";

let source: Promise<GLTF> | undefined;
export class Actor {
  root = new THREE.Group();
  private rig!: THREE.Object3D;
  private mixer!: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationAction>();
  private current = "";
  private currentAction?: THREE.AnimationAction;
  private weapon = new THREE.Group();
  private ready = false;
  private hand?: THREE.Object3D;
  private dropped = false;
  constructor(private enemy = false) {}
  async load() {
    source ??= new GLTFLoader().loadAsync("/assets/knight/knight.glb");
    const gltf = await source;
    this.rig = clone(gltf.scene);
    this.root.add(this.rig);
    this.rig.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const original = o.material as THREE.MeshStandardMaterial;
        const m = original.clone();
        m.color.set(this.enemy ? 0xc4b5a3 : 0xf4eee1);
        m.roughness = Math.max(0.66, m.roughness);
        m.metalness = Math.min(0.5, m.metalness);
        o.material = m;
        o.frustumCulled = false;
      }
    });
    this.mixer = new THREE.AnimationMixer(this.rig);
    for (const clip of gltf.animations)
      this.clips.set(clip.name, this.mixer.clipAction(clip));
    this.makeSword();
    this.hand = this.rig.getObjectByName("hand_R");
    this.hand?.add(this.weapon);
    this.ready = true;
    this.change("Idle");
    this.mixer.update(0.01);
  }
  private makeSword() {
    const steel = new THREE.MeshStandardMaterial({
      color: 0xc6c9c2,
      metalness: 0.65,
      roughness: 0.34,
    });
    const grip = new THREE.MeshStandardMaterial({
      color: this.enemy ? 0x51382f : 0x363a3a,
      roughness: 1,
    });
    const blade = new THREE.Shape();
    blade.moveTo(-0.045, 0);
    blade.lineTo(0.045, 0);
    blade.lineTo(0.035, 0.72);
    blade.lineTo(0, 0.91);
    blade.lineTo(-0.035, 0.72);
    blade.closePath();
    const b = new THREE.Mesh(
      new THREE.ExtrudeGeometry(blade, {
        depth: 0.018,
        bevelEnabled: true,
        bevelSize: 0.009,
        bevelThickness: 0.005,
        bevelSegments: 1,
      }),
      steel,
    );
    b.position.y = 0.1;
    this.weapon.add(b);
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.035, 0.055),
      steel,
    );
    guard.position.y = 0.08;
    this.weapon.add(guard);
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.17, 8),
      grip,
    );
    this.weapon.add(handle);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), steel);
    pommel.position.y = -0.11;
    this.weapon.add(pommel);
    this.weapon.position.set(0, 0.06, 0);
    this.weapon.rotation.set(-Math.PI / 2, 0, 0);
    this.weapon.scale.setScalar(this.enemy ? 1.1 : 1);
  }
  private change(name: string, once = false) {
    if (this.current === name) return;
    const next = this.clips.get(name) ?? this.clips.get("Idle")!;
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    this.currentAction?.fadeOut(once ? 0.08 : 0.16);
    next.fadeIn(once ? 0.08 : 0.16);
    this.current = name;
    this.currentAction = next;
  }
  update(dt: number, f: Fighter) {
    if (!this.ready) return;
    this.root.position.set(f.x, 0, f.z);
    this.root.rotation.set(0, f.yaw, 0);
    const mode = f.mode;
    const name =
      mode === "dead"
        ? "Death"
        : mode === "attack"
          ? "SwordAttack"
          : mode === "dodge"
            ? "Quickstep"
            : mode === "windup" || mode === "guard"
              ? "SwordAttack"
              : mode === "hit"
                ? "Hit"
                : f.speed > 1.65
                  ? "Run"
                  : f.speed > 0.1
                    ? "Walk"
                    : "Idle";
    this.change(
      name,
      ["Death", "SwordAttack", "Quickstep", "Hit"].includes(name),
    );
    const a = this.currentAction!;
    a.paused = false;
    if (mode === "windup" || mode === "guard") {
      a.time = 0.12;
      a.paused = true;
    } else if (mode === "attack" || mode === "dodge" || mode === "dead") {
      a.time = Math.min(
        a.getClip().duration - 0.001,
        mode === "attack" && this.enemy ? 0.15 + f.time * 0.72 : f.time,
      );
      a.paused = true;
    } else if (mode === "hit")
      a.setEffectiveTimeScale(a.getClip().duration / 0.4);
    else
      a.setEffectiveTimeScale(
        name === "Run"
          ? Math.max(0.65, f.speed / 2.93)
          : name === "Walk"
            ? Math.max(0.5, f.speed / 1.07)
            : 1,
      );
    this.mixer.update(dt);
    if (mode === "dead" && f.time > 0.65) {
      if (!this.dropped) {
        this.root.updateMatrixWorld(true);
        this.root.attach(this.weapon);
        this.dropped = true;
      }
      this.weapon.position.y = THREE.MathUtils.damp(
        this.weapon.position.y,
        0.05,
        12,
        dt,
      );
      this.weapon.rotation.x = THREE.MathUtils.damp(
        this.weapon.rotation.x,
        Math.PI / 2,
        12,
        dt,
      );
      this.weapon.rotation.z = THREE.MathUtils.damp(
        this.weapon.rotation.z,
        0.4,
        12,
        dt,
      );
    } else if (mode !== "dead" && this.dropped) {
      this.hand?.add(this.weapon);
      this.weapon.position.set(0, 0.06, 0);
      this.weapon.rotation.set(-Math.PI / 2, 0, 0);
      this.dropped = false;
    }
  }
}
