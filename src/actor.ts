import * as THREE from "three";

import { clone } from "three/addons/utils/SkeletonUtils.js";
import { ATTACKS, ENEMIES, type Fighter, type EnemyKind } from "./game";
import { assetUrl } from "./assets";
import { heldWeapon } from "./level-props";
import { loadModel as load } from "./asset-store";
import type { WeaponId } from "./world-layout";

type Kind = "pilgrim" | Exclude<EnemyKind, "mimic">;
interface RigState {
  rig: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  hand?: THREE.Object3D;
  weapon: THREE.Group;
  weapons: Map<string, THREE.Group>;
  current: string;
  action?: THREE.AnimationAction;
  dropped: boolean;
  floorOffset: number;
  profile: string;
}
interface FloorClip {
  duration: number;
  offsets: number[];
}
let floorTable: {
  profiles: Record<string, { clips: Record<string, FloorClip> }>;
};
let floorPromise: Promise<void> | undefined;
function loadFloor() {
  return (floorPromise ??= fetch(assetUrl("/assets/cast/floor-v7.json"))
    .then((r) => {
      if (!r.ok) throw new Error("Character contact data failed");
      return r.json();
    })
    .then((data) => {
      floorTable = data;
    }));
}
function contactOffset(profile: string, clip: string, time: number) {
  const table = floorTable?.profiles[profile]?.clips[clip];
  if (!table) return 0;
  const t = Math.min(table.duration, Math.max(0, time)),
    i = Math.min(table.offsets.length - 2, Math.floor(t * 60));
  const a = i / 60,
    b = Math.min(table.duration, (i + 1) / 60),
    u = b > a ? (t - a) / (b - a) : 0;
  return table.offsets[i] * (1 - u) + table.offsets[i + 1] * u;
}
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
  constructor(
    private enemy = false,
    private only?: Kind,
  ) {}
  async load() {
    await loadFloor();
    const kinds: Kind[] = this.only
      ? [this.only]
      : this.enemy
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
          weapon = heldWeapon(
            kind === "gaoler" ? "axe" : kind === "effigy" ? "unarmed" : "sword",
          );
        const weapons = new Map<string, THREE.Group>([["sword", weapon]]);
        if (kind === "pilgrim") {
          for (const id of ["axe", "spear", "unarmed"] as WeaponId[]) {
            const item = heldWeapon(id);
            item.visible = false;
            weapons.set(id, item);
          }
          weapons.set("relic", weapon);
        }
        for (const item of new Set(weapons.values())) hand?.add(item);
        this.states.set(kind, {
          rig,
          mixer,
          actions,
          hand,
          weapon,
          weapons,
          current: "",
          dropped: false,
          floorOffset: 0,
          profile: model,
        });
      }),
    );
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
    const linked = s.current.startsWith("Attack") && name.startsWith("Attack");
    const fade = linked
      ? 0.09
      : name.startsWith("Hit")
        ? 0.055
        : name.startsWith("Death")
          ? 0.16
          : once
            ? 0.09
            : 0.18;
    s.action?.fadeOut(fade);
    action.fadeIn(fade);
    s.action = action;
    s.current = name;
  }
  update(dt: number, f: Fighter) {
    if (f.kind === "mimic") return;
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
    const weapon = s.weapons.get(f.weapon) ?? s.weapons.get("sword")!;
    if (weapon !== s.weapon) {
      s.hand?.add(s.weapon);
      s.weapon.visible = false;
      s.weapon.position.set(0, 0.06, 0);
      s.weapon.rotation.set(-Math.PI / 2, 0, 0);
      s.weapon = weapon;
      s.weapon.visible = true;
      s.dropped = false;
    }
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.set(0, f.yaw, 0);
    const mode = f.mode;
    const attackIndex = Math.max(1, Math.min(3, f.combo || 1));
    const name =
      mode === "dead"
        ? `Death${f.death}`
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
      const progress = THREE.MathUtils.clamp(
        f.time / (ENEMIES[f.kind as EnemyKind].windup * 0.9),
        0,
        1,
      );
      const ease = progress * progress * (3 - 2 * progress);
      action.time = ATTACKS[attackIndex - 1].contact * 0.72 * ease;
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
    const loop = ["Idle", "Walk", "Run", "Guard"].includes(name);
    const offset =
      contactOffset(
        s.profile,
        name,
        loop ? action.time % action.getClip().duration : action.time,
      ) * s.rig.scale.y;
    s.floorOffset =
      offset > s.floorOffset
        ? offset
        : THREE.MathUtils.damp(s.floorOffset, offset, 28, dt);
    this.root.position.y = f.y + s.floorOffset;

    if (mode === "dead" && f.time > 0.65) {
      if (!s.dropped) {
        this.root.updateMatrixWorld(true);
        this.root.attach(s.weapon);
        s.dropped = true;
      }
      s.weapon.position.y = THREE.MathUtils.damp(
        s.weapon.position.y,
        0.045 - s.floorOffset,
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
  reset() {
    for (const s of this.states.values()) {
      s.mixer.stopAllAction();
      s.current = "";
      s.action = undefined;
      s.floorOffset = 0;
      if (s.dropped) {
        s.hand?.add(s.weapon);
        s.weapon.position.set(0, 0.06, 0);
        s.weapon.rotation.set(-Math.PI / 2, 0, 0);
        s.dropped = false;
      }
    }
  }
  dispose() {
    for (const s of this.states.values()) {
      s.mixer.stopAllAction();
      s.mixer.uncacheRoot(s.rig);
      s.rig.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
        if (o instanceof THREE.Mesh)
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            m.dispose();
      });
    }
    this.states.clear();
  }
}
