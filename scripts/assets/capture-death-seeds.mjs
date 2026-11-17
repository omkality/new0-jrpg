import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { animationOnly } from "./animation-io.mjs";
const project = fileURLToPath(new URL("../../", import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(new URL("./seeds/", import.meta.url), { recursive: true });
for (const [input, output] of [
  ["combat.glb", "death-knight.glb"],
  ["prisoner-combat.glb", "death-prisoner.glb"],
  ["gaoler-combat.glb", "death-gaoler.glb"],
]) {
  const doc = await io.read(resolve(project, "public/assets/motion", input));
  const death = doc
    .getRoot()
    .listAnimations()
    .find((animation) => animation.getName() === "Death");
  if (!death) throw new Error(`Missing approved Death in ${input}`);
  await io.write(
    fileURLToPath(new URL(`./seeds/${output}`, import.meta.url)),
    animationOnly(doc, [death]),
  );
}
