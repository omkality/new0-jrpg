import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const work = path.join(root, "work/props-v7");
await mkdir(work, { recursive: true });
async function download(url, file) {
  try {
    if ((await stat(file)).size > 0) return;
  } catch {}
  const r = await fetch(url);
  if (!r.ok) throw Error(`${r.status} ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
  console.log(path.relative(root, file));
}
async function json(url, file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {}
  const r = await fetch(url);
  if (!r.ok) throw Error(`${r.status} ${url}`);
  const data = await r.json();
  await writeFile(file, JSON.stringify(data, null, 2));
  return data;
}
const chest = await json(
  "https://api.polyhaven.com/files/treasure_chest",
  path.join(work, "treasure_chest-files.json"),
);
await json(
  "https://api.polyhaven.com/info/treasure_chest",
  path.join(work, "treasure_chest-info.json"),
);
const entry = chest.gltf["1k"].gltf;
await download(
  entry.url,
  path.join(work, "treasure_chest/treasure_chest.gltf"),
);
for (const [file, resource] of Object.entries(entry.include))
  await download(resource.url, path.join(work, "treasure_chest", file));
for (const id of ["rough_wood", "rusty_metal_02"]) {
  const files = await json(
    `https://api.polyhaven.com/files/${id}`,
    path.join(work, `${id}-files.json`),
  );
  await json(
    `https://api.polyhaven.com/info/${id}`,
    path.join(work, `${id}-info.json`),
  );
  await download(
    files.Diffuse["1k"].jpg.url,
    path.join(work, `${id}_diff_1k.jpg`),
  );
}
await download(
  "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt",
  path.join(work, "CC0-1.0.txt"),
);
