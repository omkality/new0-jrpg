import * as THREE from "three";

import { clone } from "three/addons/utils/SkeletonUtils.js";
import { type Fighter, type EnemyKind } from "./game";
import { assetUrl } from "./assets";
import { heldWeapon, attachWeapon } from "./level-props";
import { loadModel as load } from "./asset-store";
import type { WeaponId } from "./world-layout";
import {
  armourModel,
  flaskModel,
  setFlaskFill,
  FLASK_COLORS,
} from "./gear-visuals";
import { FootContact } from "./foot-contact";
import { SkeletonContinuity } from "./skeleton-continuity";
import { GearPose } from "./gear-pose";
import {
  applyCharacterAppearance,
  setArmourCoverage,
  disposeCharacterAppearance,
} from "./character-appearance";
import {
  motionName,
  semanticAttackTime,
  sourceAttackTime,
} from "./motion-policy";
import { WEAPON_RELEASE_TIME } from "./weapon-spec";
import { MixerPose } from "./mixer-pose";
import { ActionBlend, locomotionName } from "./action-blend";

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
  continuity: SkeletonContinuity;
  feet: FootContact;
  mixerPose: MixerPose;
  blend: ActionBlend;
  locomotionSpeed: number;
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
      return Promise.all(
        ["fixes1", "fixes2"].map((revision) =>
          fetch(assetUrl(`/assets/motion/${revision}-floor.json`)).then((r) => {
            if (!r.ok) throw new Error("Motion contact data failed");
            return r.json();
          }),
        ),
      ).then((tables) => {
        for (const extra of tables) {
          for (const [profile, value] of Object.entries(extra.profiles) as [
            string,
            { clips: Record<string, FloorClip> },
          ][])
            Object.assign(floorTable.profiles[profile].clips, value.clips);
        }
      });
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
    private costume?: (rig: THREE.Object3D, kind: Kind) => void,
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
        const [gltf, combat, fixes, fixes2] = await Promise.all([
          load(`/assets/cast/${model}.glb`),
          load(`/assets/motion/${motion}-combat.glb`),
          load(`/assets/motion/${motion}-fixes1.glb`),
          load(`/assets/motion/${motion}-fixes2.glb`),
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
                ? 0x9eaaa5
                : kind === "effigy"
                  ? 0xb5c3b9
                  : kind === "gaoler"
                    ? 0xa9a69a
                    : 0x9fa8a9,
            );
            if (/new0_v8_fitted/.test(o.name))
              m.color.set(
                /trousers/.test(o.name)
                  ? kind === "pilgrim"
                    ? 0x555e58
                    : 0x515c57
                  : kind === "pilgrim"
                    ? 0xc3c5b7
                    : 0x7c8980,
              );
            else if (/hood/.test(o.name))
              m.color.set(kind === "pilgrim" ? 0x656e64 : 0x46514a);
            else if (/collar/.test(o.name))
              m.color.set(kind === "pilgrim" ? 0x929e8f : 0x59675b);
            o.material = m;
            if (/new0_v8_fitted_(linen|observer)/.test(o.name)) {
              m.color.set(kind === "pilgrim" ? 0xb6b7aa : 0x707a71);
              m.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                  "#include <map_fragment>",
                  `#ifdef USE_MAP
                  vec4 clothTexel=texture2D(map,vMapUv);
                  float weave=dot(clothTexel.rgb,vec3(.2126,.7152,.0722));
                  diffuseColor.rgb*=vec3(.43+.75*weave);
                  diffuseColor.a*=clothTexel.a;
                #endif`,
                );
              };
              m.customProgramCacheKey = () => "fixes1-grey-linen";
            }
            o.frustumCulled = false;
          }
        });
        applyCharacterAppearance(rig, kind);
        this.costume?.(rig, kind);
        if (this.costume && kind === "watcher") rig.scale.setScalar(1.1);
        if (kind === "effigy") rig.scale.setScalar(1.03);
        const mixer = new THREE.AnimationMixer(rig),
          actions = new Map<string, THREE.AnimationAction>();
        for (const clip of [
          ...gltf.animations,
          ...combat.animations,
          ...fixes.animations,
          ...fixes2.animations,
        ])
          actions.set(clip.name, mixer.clipAction(clip));
        const hand = rig.getObjectByName("hand_R"),
          weapon = heldWeapon(
            kind === "gaoler" ? "axe" : kind === "effigy" ? "unarmed" : "sword",
            kind === "gaoler",
          );
        const weapons = new Map<string, THREE.Group>([["sword", weapon]]);
        if (this.costume && kind === "watcher") {
          const axe = heldWeapon("axe");
          axe.visible = false;
          weapons.set("axe", axe);
          weapons.set("unarmed", new THREE.Group());
        }
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
          armour = armourModel(rig);
          armour.position.set(0, 1.16, 0.01);
          armour.visible = false;
          rig.add(armour);
          rig.updateMatrixWorld(true);
          rig.getObjectByName("chest")?.attach(armour);
          flask = flaskModel();
          flask.scale.setScalar(0.4);
          flask.position.set(-0.024, 0.078, 0.124);
          flask.rotation.x = -Math.PI / 2;
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
          gear: new GearPose(rig, kind === "gaoler"),
          continuity: new SkeletonContinuity(rig, kind === "gaoler"),
          feet: new FootContact(rig),
          mixerPose: new MixerPose(rig),
          blend: new ActionBlend(),
          locomotionSpeed: 0,
        });
      }),
    );
  }
  private change(s: RigState, name: string, once: boolean) {
    if (s.current === name) return;
    const action = s.actions.get(name) ?? s.actions.get("Idle")!;
    const loop = ["Idle", "Walk", "Run", "Guard"].includes(name);
    const resume = loop && action.isScheduled();
    const phase =
      /^(Walk|Run)$/.test(name) && /^(Walk|Run)$/.test(s.current) && s.action
        ? (s.action.time % s.action.getClip().duration) /
          s.action.getClip().duration
        : 0;
    if (!resume) action.reset();
    if (!resume && loop) action.time = phase * action.getClip().duration;
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setLoop(
      once ? THREE.LoopOnce : THREE.LoopRepeat,
      once ? 1 : Infinity,
    );
    action.clampWhenFinished = once;
    action.play();
    const linked = /Attack/.test(s.current) && /Attack/.test(name);
    const fade = linked
      ? 0.09
      : name.startsWith("Hit")
        ? 0.055
        : name.startsWith("Death")
          ? 0.16
          : once
            ? 0.09
            : 0.18;
    s.blend.select(action, fade);
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
          attachWeapon(this.active.weapon, this.kind === "gaoler");
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
      attachWeapon(s.weapon, kind === "gaoler");
      s.weapon = weapon;
      s.weapon.visible = true;
      s.dropped = false;
    }
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.set(0, f.yaw, 0);
    const mode = f.mode;
    if (s.armour) s.armour.visible = f.armour > 0;
    setArmourCoverage(s.rig, f.armour > 0);
    if (s.flask) {
      s.flask.visible = mode === "heal";
      const stopper = s.flask.getObjectByName("FlaskStopper");
      if (stopper) stopper.visible = false;
      setFlaskFill(
        s.flask,
        mode === "heal" ? Math.max(0.06, 0.92 - f.time * 0.6) : 0.92,
        mode === "heal"
          ? f.regenDraught
            ? FLASK_COLORS.regeneration
            : FLASK_COLORS.healing
          : undefined,
      );
    }
    const attackIndex = Math.max(1, Math.min(3, f.combo || 1));
    s.locomotionSpeed = THREE.MathUtils.damp(
      s.locomotionSpeed,
      f.speed,
      12,
      dt,
    );
    const name = ["idle", "move", "recover"].includes(mode)
      ? locomotionName(s.locomotionSpeed, s.current)
      : motionName(f);
    const semanticTime =
      mode === "windup" || mode === "attack"
        ? semanticAttackTime(f, this.enemy)
        : f.time;
    const once = !["Idle", "Walk", "Run", "Guard"].includes(name);
    s.mixerPose.restore();
    this.change(s, name, once);
    const action = s.action!;
    action.paused = false;
    if (["windup", "attack", "dodge", "dead", "hit"].includes(mode)) {
      const time =
        mode === "attack" || mode === "windup"
          ? sourceAttackTime(name, semanticTime, attackIndex - 1)
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
    s.blend.update(dt);
    s.mixer.update(dt);
    s.mixerPose.capture();
    s.continuity.apply(dt);
    const loop = ["Idle", "Walk", "Run", "Guard"].includes(name);
    const offset =
      contactOffset(
        s.profile,
        name,
        loop ? action.time % action.getClip().duration : action.time,
      ) * s.rig.scale.y;
    this.root.updateMatrixWorld(true);
    const grounded = mode !== "dead" && !name.startsWith("Dodge");
    const actualOffset = grounded ? s.feet.offset(f.y) : offset;
    s.floorOffset =
      actualOffset > s.floorOffset
        ? actualOffset
        : THREE.MathUtils.damp(s.floorOffset, actualOffset, 28, dt);
    this.root.position.y = f.y + s.floorOffset;
    if (!(mode === "dead" && f.time > WEAPON_RELEASE_TIME)) {
      this.root.updateMatrixWorld(true);
      const item =
        kind === "gaoler" ? "axe" : kind === "effigy" ? "unarmed" : f.weapon;
      s.gear.apply(
        item,
        mode === "heal" ? "Drink" : name,
        f.y,
        undefined,
        semanticTime,
        dt,
      );
    } else s.gear.release(dt, f.y, f.death === "Side");
    if (mode === "heal") s.gear.drink(f.time, dt);

    if (mode === "dead" && f.time > WEAPON_RELEASE_TIME) {
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
      attachWeapon(s.weapon, kind === "gaoler");
      s.dropped = false;
    }
  }
  reset() {
    for (const s of this.states.values()) {
      s.mixer.stopAllAction();
      s.blend.reset();
      s.mixerPose.reset();
      s.current = "";
      s.gear.reset();
      s.continuity.reset();
      s.action = undefined;
      s.floorOffset = 0;
      s.locomotionSpeed = 0;
      if (s.dropped) {
        s.hand?.add(s.weapon);
        attachWeapon(s.weapon, s.profile === "gaoler");
        s.dropped = false;
      }
    }
  }
  dispose() {
    for (const s of this.states.values()) {
      disposeCharacterAppearance(s.rig);
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
