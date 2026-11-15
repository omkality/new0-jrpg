// One-time preparation from the author's free UAL Standard archive.
// Usage: node prepare-quaternius-seed.mjs <extracted UAL1_Standard.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { animationOnly } from "./animation-io.mjs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

if (!process.argv[2])
  throw new Error("Pass the extracted official UAL1_Standard.glb");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(resolve(process.argv[2]));
const chosen = new Set(["A_TPose", "Idle_Loop", "Roll", "Death01"]);
const selected = doc
  .getRoot()
  .listAnimations()
  .filter((a) => chosen.has(a.getName()));
if (selected.length !== chosen.size)
  throw new Error("Required UAL Standard clips missing");
const output = animationOnly(doc, selected);
output.getRoot().getAsset().copyright = "Quaternius, CC0 1.0 Universal";
output.getRoot().getAsset().extras = {
  source: "https://quaternius.itch.io/universal-animation-library",
  package:
    "Universal Animation Library Standard, UAL1_Standard.glb (no root motion)",
  license: "CC0-1.0",
  selection: [...chosen],
  preparation: "Animation-only lossless extraction, mesh/skin/images omitted",
};
await io.write(
  fileURLToPath(
    new URL("./seeds/quaternius-ual1-roll-death.glb", import.meta.url),
  ),
  output,
);
console.log(
  JSON.stringify({
    selected: [...chosen],
    nodes: output.getRoot().listNodes().length,
  }),
);
