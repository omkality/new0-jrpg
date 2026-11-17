// Maintenance tool. Run only when explicitly accepting a new attack baseline.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { animationDigest } from "./animation-io.mjs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hashes = {};
for (const file of ["combat.glb", "prisoner-combat.glb", "gaoler-combat.glb"]) {
  const doc = await io.read(
    fileURLToPath(
      new URL(`../../public/assets/motion/${file}`, import.meta.url),
    ),
  );
  hashes[file] = Object.fromEntries(
    doc
      .getRoot()
      .listAnimations()
      .filter((a) =>
        ["Attack1", "Attack2", "Attack3", "Death"].includes(a.getName()),
      )
      .map((a) => [a.getName(), animationDigest(a)]),
  );
}
await writeFile(
  fileURLToPath(new URL("./seeds/combat-v2-digests.json", import.meta.url)),
  JSON.stringify(hashes, null, 2) + "\n",
);
console.log("Captured four unchanged baseline clips for three rigs");
