import * as THREE from "three";
import { Campaign } from "./campaign";
import {
  CHESTS,
  KEYS,
  COINS,
  DOORS,
  POTIONS,
  type WeaponId,
} from "./world-layout";
import { prop, propModel } from "./asset-store";
import { WEAPONS, WEAPON_MOUNTS } from "./weapon-spec";
import { blackGate, flaskModel, armourModel, lootGlow } from "./gear-visuals";

export function heldWeapon(id: WeaponId) {
  const group = new THREE.Group();
  group.name = `Held-${id}`;
  if (id !== "unarmed") {
    const object = prop(WEAPONS[id].asset);
    const mount = WEAPON_MOUNTS[id];
    object.scale.setScalar(mount.scale);
    object.rotation.y = mount.twist;
    group.add(object);
  }
  group.position.set(0, 0.06, 0);
  group.rotation.x = -Math.PI / 2;
  return group;
}
export class LevelProps {
  root = new THREE.Group();
  mimic = new THREE.Group();
  private chests: {
    object: THREE.Object3D;
    lid: THREE.Object3D;
    loot: THREE.Object3D;
    id: string;
  }[] = [];
  private keys: { object: THREE.Object3D; id: string }[] = [];
  private coins: { object: THREE.Object3D; id: string }[] = [];
  private potions: { object: THREE.Object3D; id: string }[] = [];
  private doors: {
    object: THREE.Object3D;
    pivots: THREE.Object3D[];
    id: string;
  }[] = [];
  private drops: {
    object: THREE.Group;
    variants: Map<WeaponId, THREE.Object3D>;
  }[] = [];
  private mimicMixer?: THREE.AnimationMixer;
  private mimicActions = new Map<string, THREE.AnimationAction>();
  private mimicAction?: THREE.AnimationAction;
  private mimicName = "";
  private mimicBody?: THREE.Object3D;
  private mimicLid?: THREE.Object3D;
  constructor(private game: Campaign) {}
  build() {
    for (const c of CHESTS) {
      const object = prop("chest");
      object.position.set(c.x, c.y, c.z);
      object.rotation.y = c.yaw;
      object.scale.setScalar(1.3);
      const lid = object.getObjectByName("ChestLid")!,
        loot = object.getObjectByName("Loot")!;
      const anchor = object.getObjectByName("LootAnchor")!;
      const weapon = prop(WEAPONS[c.weapon].asset);
      weapon.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      weapon.scale.setScalar(
        c.weapon === "spear" ? 0.36 : c.weapon === "axe" ? 0.6 : 0.55,
      );
      if (c.weapon === "spear") weapon.position.x = -0.045;
      anchor.add(weapon);
      if ("armour" in c && c.armour) {
        const armour = armourModel();
        armour.scale.setScalar(0.62);
        armour.rotation.x = -Math.PI / 2;
        armour.position.set(-0.14, 0.08, 0.02);
        anchor.add(armour);
      }
      // The anchor and the decorative cloth/coins are both hidden only after pickup.
      const contents = new THREE.Group();
      loot.parent!.add(contents);
      contents.attach(loot);
      contents.attach(anchor);
      this.root.add(object);
      this.chests.push({ object, lid, loot: contents, id: c.id });
    }
    for (const k of KEYS) {
      const object = prop("key");
      object.position.set(k.x, k.y + 1.08, k.z);
      object.rotation.set(Math.PI / 2, 0, 0.35);
      object.scale.setScalar(1.7);
      this.root.add(object);
      this.keys.push({ object, id: k.id });
    }
    for (const c of COINS) {
      const object = prop("coins");
      object.position.set(c.x, c.y + 0.035, c.z);
      object.scale.setScalar(1.6);
      const glow = lootGlow(0xffedc0);
      glow.position.y = 0.12;
      object.add(glow);
      this.root.add(object);
      this.coins.push({ object, id: c.id });
    }
    const bottle = flaskModel();
    const glow = lootGlow(0xcbdedb);
    glow.position.y = 0.17;
    bottle.add(glow);
    for (const p of POTIONS) {
      const object = bottle.clone(true);
      object.position.set(p.x, p.y + 0.04, p.z);
      object.scale.setScalar(1.2);
      this.root.add(object);
      this.potions.push({ object, id: p.id });
    }
    for (const d of DOORS) {
      const object = d.id === "gate" ? blackGate() : prop("door");
      object.position.set(d.x, d.y, d.z);
      if (d.id !== "gate") object.scale.set(d.width / 1.5, 1, 1);
      const pivots =
        d.id === "gate"
          ? [
              object.getObjectByName("GateLeft")!,
              object.getObjectByName("GateRight")!,
            ]
          : [object.getObjectByName("DoorPivot")!];
      this.root.add(object);
      this.doors.push({ object, pivots, id: d.id });
    }
    for (let i = 0; i < this.game.drops.length; i++) {
      const object = new THREE.Group(),
        variants = new Map<WeaponId, THREE.Object3D>();
      for (const id of ["sword", "axe", "spear"] as const) {
        const weapon = prop(WEAPONS[id].asset);
        weapon.scale.setScalar(WEAPON_MOUNTS[id].scale);
        weapon.rotation.set(Math.PI / 2, 0.25, Math.PI / 2);
        weapon.visible = false;
        object.add(weapon);
        variants.set(id, weapon);
      }
      object.visible = false;
      this.root.add(object);
      this.drops.push({ object, variants });
    }
    const body = prop("mimic");
    body.scale.setScalar(1.6);
    this.mimic.add(body);
    this.root.add(this.mimic);
    this.mimicBody = body;
    this.mimicLid = body.getObjectByName("ChestLid");
    this.mimicMixer = new THREE.AnimationMixer(body);
    for (const clip of propModel("mimic").animations) {
      const a = this.mimicMixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      this.mimicActions.set(clip.name, a);
    }
  }
  reset() {
    for (const c of this.chests) {
      c.lid.rotation.x = 0;
      c.loot.visible = true;
    }
    for (const d of this.doors)
      for (const pivot of d.pivots) pivot.rotation.y = 0;
    this.mimicAction?.stop();
    this.mimicName = "";
    this.mimic.rotation.set(0, 0, 0);
    this.mimicBody?.position.set(0, 0, 0);
    this.mimicBody?.rotation.set(0, 0, 0);
  }
  private mimicPose(name: string, fraction: number) {
    const action = this.mimicActions.get(name);
    if (!action || !this.mimicMixer) return;
    if (name !== this.mimicName) {
      this.mimicAction?.stop();
      action.reset().play();
      this.mimicAction = action;
      this.mimicName = name;
    }
    action.paused = true;
    action.time = Math.min(
      action.getClip().duration - 0.001,
      Math.max(0, fraction) * action.getClip().duration,
    );
    this.mimicMixer.update(0);
  }
  update(dt: number, time: number) {
    const g = this.game;
    for (const c of this.chests) {
      c.object.visible = Math.abs(c.object.position.z - g.player.z) < 30;
      c.lid.rotation.x = THREE.MathUtils.damp(
        c.lid.rotation.x,
        g.openedChests.has(c.id) ? -1.75 : 0,
        4.5,
        dt,
      );
      c.loot.visible = !g.lootedChests.has(c.id);
    }
    for (const k of this.keys)
      k.object.visible =
        !g.collectedKeys.has(k.id) &&
        Math.abs(k.object.position.z - g.player.z) < 24;
    for (const c of this.coins)
      c.object.visible =
        !g.collectedCoins.has(c.id) &&
        Math.abs(c.object.position.z - g.player.z) < 24;
    for (const p of this.potions) {
      p.object.visible =
        !g.collectedPotions.has(p.id) &&
        Math.abs(p.object.position.z - g.player.z) < 30;
      const sprite = p.object.children.find(
        (o) => o instanceof THREE.Sprite,
      ) as THREE.Sprite;
      if (sprite)
        sprite.material.opacity =
          0.65 + Math.sin(time * 2 + p.object.position.x) * 0.15;
    }
    for (const d of this.doors)
      for (let i = 0; i < d.pivots.length; i++)
        d.pivots[i].rotation.y = THREE.MathUtils.damp(
          d.pivots[i].rotation.y,
          g.openDoors.has(d.id)
            ? (g.doorSwing.get(d.id) ?? 1) * (i === 1 ? -1 : 1) * 1.65
            : 0,
          4,
          dt,
        );
    for (let i = 0; i < this.drops.length; i++) {
      const slot = g.drops[i],
        view = this.drops[i];
      view.object.visible = slot.active;
      if (!slot.active) continue;
      view.object.position.set(slot.x, slot.y, slot.z);
      for (const [id, model] of view.variants)
        model.visible = id === slot.weapon;
    }
    const e = g.enemies.get("crypt")!;
    this.mimic.position.set(e.x, e.y, e.z);
    this.mimic.rotation.y = e.yaw;
    if (!g.mimicAwake) this.mimicPose("Open", 0);
    else if (g.elapsed - g.mimicAwokeAt < 1.15)
      this.mimicPose("Reveal", (g.elapsed - g.mimicAwokeAt) / 1.15);
    else if (e.hp <= 0) {
      this.mimicPose("Reveal", 1);
      if (this.mimicLid)
        this.mimicLid.rotation.x = -1.75 + Math.min(1, e.time / 1.4) * 0.55;
      this.mimic.rotation.z =
        Math.sin(Math.min(1, e.time / 1.4) * Math.PI * 0.5) * 0.12;
    } else {
      this.mimic.rotation.z = 0;
      this.mimicPose(
        e.mode === "attack" ? "Bite" : "Reveal",
        e.mode === "attack" ? e.time : 1,
      );
      if (this.mimicBody) {
        this.mimicBody.position.y =
          e.mode === "attack"
            ? Math.sin(Math.min(1, e.time) * Math.PI) * 0.28
            : e.mode === "windup"
              ? Math.sin(e.time * 8) * 0.025
              : 0;
        this.mimicBody.rotation.x =
          e.mode === "windup"
            ? -0.12 * Math.min(1, e.time)
            : e.mode === "attack"
              ? 0.2 * Math.sin(e.time * Math.PI)
              : e.mode === "hit"
                ? -0.1 * Math.sin(e.time * 13)
                : 0;
      }
    }
    this.mimic.visible = Math.abs(e.z - g.player.z) < 36;
  }
  inspect() {
    const p = this.game.player;
    if (!this.game.inspecting || p.mode === "hit" || p.mode === "dead")
      return null;
    for (const c of CHESTS)
      if (
        this.game.inspecting === c.id &&
        this.game.openedChests.has(c.id) &&
        !this.game.lootedChests.has(c.id) &&
        Math.abs(c.y - p.y) < 0.8 &&
        Math.hypot(c.x - p.x, c.z - p.z) < 2.2
      )
        return c;
    return null;
  }
  dispose() {
    this.mimicMixer?.stopAllAction();
    if (this.mimicBody) this.mimicMixer?.uncacheRoot(this.mimicBody);
  }
}
