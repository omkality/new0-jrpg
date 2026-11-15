import * as THREE from "three";

import { clone } from "three/addons/utils/SkeletonUtils.js";
import { ATTACKS, ENEMIES, type Fighter, type EnemyKind } from "./game";
import { assetUrl } from "./assets";
import { heldWeapon } from "./level-props";
import { loadModel as load } from "./asset-store";
import type { WeaponId } from "./world-layout";
import { armourModel, flaskModel } from "./gear-visuals";
import { GearPose } from "./gear-pose";
import { GearCollision } from "./gear-collision";

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
  armour?: THREE.Group;
  flask?: THREE.Group;
  gear: GearPose;
  collision?: GearCollision;
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
                ? 0xd5d9d6
                : kind === "effigy"
                  ? 0xb5c3b9
                  : kind === "gaoler"
                    ? 0xa9a69a
                    : 0x9fa8a9,
            );
            o.material = m;
            if (/linen|headwrap/.test(m.name)) {
              m.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                  "#include <map_fragment>",
                  "#include <map_fragment>\n diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722))), diffuseColor.rgb, 0.2);",
                );
              };
              m.customProgramCacheKey = () => "new0-ashen-cloth-v8";
            }
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
        let armour: THREE.Group | undefined, flask: THREE.Group | undefined;
        if (kind === "pilgrim") {
          armour = armourModel();
          armour.position.set(0, 1.16, 0.01);
          armour.visible = false;
          rig.add(armour);
          rig.updateMatrixWorld(true);
          rig.getObjectByName("chest")?.attach(armour);
          flask = flaskModel();
          flask.scale.setScalar(0.72);
          flask.visible = false;
          rig.getObjectByName("hand_L")?.add(flask);
        }
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
          armour,
          flask,
          gear: new GearPose(rig),
          collision:
            hand && kind !== "effigy"
              ? new GearCollision(rig, hand, weapons)
              : undefined,
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
    if (s.armour) s.armour.visible = f.armour > 0;
    if (s.flask) {
      s.flask.visible = mode === "heal";
      const stopper = s.flask.getObjectByName("FlaskStopper"),
        liquid = s.flask.getObjectByName("FlaskLiquid");
      if (stopper) stopper.visible = false;
      if (liquid)
        liquid.scale.y =
          mode === "heal" ? Math.max(0.1, 0.92 - f.time * 0.6) : 0.92;
    }
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
    if (!(mode === "dead" && f.time > 0.65)) {
      this.root.updateMatrixWorld(true);
      s.collision?.update();
      const item =
        kind === "gaoler" ? "axe" : kind === "effigy" ? "unarmed" : f.weapon;
      s.gear.apply(
        item,
        name,
        f.y,
        s.collision
          ? (matrix) =>
              s.collision!.penalty(
                kind === "gaoler" ? "sword" : item,
                matrix,
                f.y,
              )
          : undefined,
        action.time,
      );
    }
    if (mode === "heal") s.gear.drink(f.time);

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
      s.collision?.dispose();
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
