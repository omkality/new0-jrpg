import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Vector3 } from "three";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { WEAPON_MOUNTS } from "../../src/weapon-spec.ts";
import { structure, sample, world } from "./pose-sampling.mjs";

const project = fileURLToPath(new URL("../../", import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const floor = JSON.parse(
  await readFile(resolve(project, "public/assets/cast/floor-v7.json"), "utf8"),
);
const doc = await io.read(resolve(project, "public/assets/cast/prisoner.glb"));
const motion = await io.read(
  resolve(project, "public/assets/motion/prisoner-combat.glb"),
);
const info = structure(doc),
  hand = info.byName.get("hand_R");
const clips = [
  ...doc
    .getRoot()
    .listAnimations()
    .filter((a) => ["Idle", "Walk", "Run"].includes(a.getName())),
  ...motion.getRoot().listAnimations(),
];
const report = [];
for (const id of ["sword", "axe", "spear"]) {
  const { scale, twist } = WEAPON_MOUNTS[id];
  const weapon = await io.read(
    resolve(project, `public/assets/props-v7/weapon-${id}.glb`),
  );
  const wi = structure(weapon),
    points = [];
  for (const node of wi.nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = world(wi, wi.base, node);
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute("POSITION").getArray();
      const used = p.getIndices()
        ? [...new Set(p.getIndices().getArray())]
        : Array.from({ length: pos.length / 3 }, (_, i) => i);
      for (const i of used)
        points.push(
          new Vector3()
            .fromArray(pos, i * 3)
            .applyMatrix4(matrix)
            .applyMatrix4(new Matrix4().makeRotationY(twist))
            .multiplyScalar(scale),
        );
    }
  }
  const mount = new Matrix4()
    .makeTranslation(0, 0.06, 0)
    .multiply(new Matrix4().makeRotationX(-Math.PI / 2));
  const metrics = [];
  for (const clip of clips) {
    const name = clip.getName(),
      duration = Math.max(
        ...clip.listSamplers().map((s) => s.getInput().getArray().at(-1)),
      );
    const curve = floor.profiles.prisoner.clips[name];
    let minY = Infinity,
      at = 0;
    for (let i = 0; i <= Math.ceil(duration * 60); i++) {
      const t = Math.min(duration, i / 60);
      // The weapon detaches from the hand at 0.65s in all authored deaths.
      if (name.startsWith("Death") && t > 0.65) continue;
      const matrix = world(info, sample(info, clip, t), hand).multiply(mount);
      for (const point of points) {
        const y =
          point.clone().applyMatrix4(matrix).y + (curve?.offsets[i] ?? 0);
        if (y < minY) {
          minY = y;
          at = t;
        }
      }
    }
    metrics.push({ name, minY, time: at });
  }
  report.push({
    weapon: id,
    scale,
    minimum: Math.min(...metrics.map((m) => m.minY)),
    clips: metrics,
  });
}
await mkdir(resolve(project, "work/assets-v7"), { recursive: true });
await writeFile(
  resolve(project, "work/assets-v7/weapon-contact.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    report.map((r) => ({ ...r, clips: r.clips.filter((c) => c.minY < 0.005) })),
    null,
    2,
  ),
);
if (!process.argv.includes("--inspect"))
  for (const r of report)
    assert.ok(r.minimum >= -0.005, `${r.weapon}: floor contact ${r.minimum}`);
