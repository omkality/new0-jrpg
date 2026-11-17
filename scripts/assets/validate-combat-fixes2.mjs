import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { structure, sample, position } from "./pose-sampling.mjs";
import { ATTACKS, DODGE } from "../../src/game.ts";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const directory = "public/assets/motion/";
const json = async (name) => JSON.parse(await readFile(name, "utf8"));
const contract = await json(directory + "fixes2-contract.json");
const floor = await json(directory + contract.files.floor);
const provenance = await json(directory + "fixes2-provenance.json");
const rootTravel = await json("src/evade-motion-data.json");
assert.equal(contract.timeDomain, "semantic-seconds");
assert.equal(provenance.license, "CC0-1.0");
assert.deepEqual(rootTravel, contract.evades.rootTravel);
assert.equal(contract.evades.duration, DODGE.duration);
for (const [index, attack] of contract.attacks.entries()) {
  for (const key of ["duration", "contact", "link"])
    assert.equal(
      attack[key],
      ATTACKS[index][key],
      `Attack ${index + 1}: ${key}`,
    );
}
for (const [file, expected] of Object.entries(contract.protectedAssets)) {
  const hash = createHash("sha256")
    .update(await readFile(directory + file))
    .digest("hex");
  assert.equal(hash, expected, `Protected motion changed: ${file}`);
}
for (const [name, curve] of Object.entries(rootTravel)) {
  assert.equal(curve.duration, DODGE.duration, name);
  assert(curve.distance >= 0.7 && curve.distance <= 1.2, name);
  assert.deepEqual(curve.samples[0], [0, 0]);
  assert.deepEqual(curve.samples.at(-1), [DODGE.duration, 1]);
  for (let i = 1; i < curve.samples.length; i++) {
    const a = curve.samples[i - 1],
      b = curve.samples[i];
    assert(
      b[0] > a[0] && b[1] >= a[1] && b[1] <= 1,
      `${name}: nonmonotone travel`,
    );
  }
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  report = [];
for (const character of ["prisoner", "watcher", "gaoler"]) {
  const motionFile =
    character === "gaoler" ? contract.files.gaoler : contract.files.human;
  const sourceFile = `public/assets/cast/${character}.glb`;
  const body = await io.read(sourceFile),
    motion = await io.read(directory + motionFile);
  const info = structure(body),
    clips = new Map(
      motion
        .getRoot()
        .listAnimations()
        .map((c) => [c.getName(), c]),
    );
  assert.equal(clips.size, character === "gaoler" ? 4 : 10);
  const hash = createHash("sha256")
    .update(await readFile(sourceFile))
    .digest("hex");
  assert.equal(
    floor.profiles[character].geometryHash,
    hash,
    `${character}: stale floor geometry`,
  );
  for (const node of motion.getRoot().listNodes()) {
    const native = info.byName.get(node.getName());
    assert(native, `Unknown motion bone ${node.getName()}`);
    for (const method of ["getTranslation", "getRotation", "getScale"]) {
      const a = node[method](),
        b = native[method]();
      assert(
        a.every((value, i) => Math.abs(value - b[i]) < 2e-6),
        `${character}: altered bind ${node.getName()}`,
      );
    }
  }
  const rows = [];
  for (const [name, clip] of clips) {
    const attack = contract.attacks.find(
      (a) => a.spearClip === name || a.fistClip === name,
    );
    const duration = attack?.duration ?? DODGE.duration;
    const actualDuration = Math.max(
      ...clip.listSamplers().map((s) => s.getInput().getArray().at(-1)),
    );
    assert(Math.abs(actualDuration - duration) < 1e-6, `${name}: duration`);
    const channels = new Set(
      clip.listChannels().map((c) => c.getTargetNode().getName()),
    );
    for (const name of [
      "pelvis",
      "chest",
      "upperarm_L",
      "upperarm_R",
      "thigh_L",
      "thigh_R",
      "foot_L",
      "foot_R",
    ])
      assert(
        channels.has(name),
        `${clip.getName()}: missing full-body channel ${name}`,
      );
    let prior,
      maxJoint = 0,
      maxHand = 0;
    for (let i = 0; i <= Math.ceil(duration * 60); i++) {
      const pose = sample(info, clip, Math.min(duration, i / 60));
      for (const [node, state] of pose) {
        if (node.getName() !== "pelvis")
          assert(
            state.p.distanceTo(info.base.get(node).p) < 2e-6,
            `${name}: bone translation changed`,
          );
        assert(
          state.s.distanceTo(info.base.get(node).s) < 2e-6,
          `${name}: bone scale changed`,
        );
        if (prior)
          maxJoint = Math.max(
            maxJoint,
            (state.q.angleTo(prior.get(node).q) * 180) / Math.PI,
          );
      }
      if (prior)
        for (const side of ["L", "R"]) {
          const hand = info.byName.get(`hand_${side}`);
          maxHand = Math.max(
            maxHand,
            position(info, pose, hand).distanceTo(position(info, prior, hand)),
          );
        }
      prior = pose;
    }
    assert(maxJoint < 18.5, `${character}/${name}: ${maxJoint} degrees/60Hz`);
    assert(maxHand < 0.16, `${character}/${name}: ${maxHand}m/60Hz`);
    const contacts = floor.profiles[character].clips[name];
    assert(contacts && Math.abs(contacts.duration - duration) < 1e-6);
    assert.equal(contacts.offsets.length, Math.ceil(actualDuration * 60) + 1);
    assert(
      contacts.offsets.every(Number.isFinite),
      `${name}: invalid contact offset`,
    );
    let wrist;
    if (attack) {
      const hand = info.byName.get(
        name === "FistAttack1" ? "hand_L" : "hand_R",
      );
      const reach = (t) => {
        const pose = sample(info, clip, t);
        return (
          position(info, pose, hand).z -
          position(info, pose, info.byName.get("pelvis")).z
        );
      };
      const contact = reach(attack.contact);
      let peak = -Infinity;
      for (let i = 0; i <= Math.ceil(attack.link * 240); i++)
        peak = Math.max(peak, reach(Math.min(attack.link, i / 240)));
      assert(
        peak - contact < 0.01,
        `${name}: damage misses actual wrist extension`,
      );
      wrist = { contact, peak };
    }
    rows.push({
      clip: name,
      maxJointDegreesPer60Hz: maxJoint,
      maxHandMetresPer60Hz: maxHand,
      wrist,
    });
  }
  for (const family of character === "gaoler" ? [] : ["Spear", "Fist"]) {
    for (let i = 0; i < 2; i++) {
      const a = sample(
        info,
        clips.get(`${family}Attack${i + 1}`),
        ATTACKS[i].link,
      );
      const b = sample(info, clips.get(`${family}Attack${i + 2}`), 0);
      for (const node of info.nodes) {
        assert(
          a.get(node).q.angleTo(b.get(node).q) < 0.0001,
          `${family}: combo rotation seam`,
        );
        assert(
          position(info, a, node).distanceTo(position(info, b, node)) < 0.00001,
          `${family}: combo position seam`,
        );
      }
    }
  }
  report.push({ character, clips: rows });
}
await mkdir("work/fixes2", { recursive: true });
await writeFile(
  "work/fixes2/current-combat-assets.json",
  JSON.stringify(
    {
      protectedFiles: Object.keys(contract.protectedAssets).length,
      profiles: report,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      protectedFiles: Object.keys(contract.protectedAssets).length,
      profiles: report.map((p) => ({
        character: p.character,
        clips: p.clips.length,
        maxJointDegrees: Math.max(
          ...p.clips.map((c) => c.maxJointDegreesPer60Hz),
        ),
        maxHandMetres: Math.max(...p.clips.map((c) => c.maxHandMetresPer60Hz)),
      })),
    },
    null,
    2,
  ),
);
