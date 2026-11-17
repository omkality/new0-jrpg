// Extract the CC0 MakeHuman core head, fit to the existing metre-scale rig,
// and simplify only this rigid asset. No source body or skeleton is modified.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MeshoptSimplifier } from "meshoptimizer";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const folder = "work/fixes2/appearance";
await mkdir(folder, { recursive: true });
const revision = "1f508f6083b2f823dab15de924b3bde72e08d77c";
const source =
  "https://raw.githubusercontent.com/makehumancommunity/makehuman/" +
  revision +
  "/";
const femaleSculpt = [
  ["nose/nose-scale-depth-decr", 0.35],
  ["nose/nose-flaring-decr", 0.25],
  ["nose/nose-nostrils-angle-down", 0.18],
  ["chin/chin-prominent-decr", 0.4],
  ["cheek/l-cheek-volume-incr", 0.2],
  ["cheek/r-cheek-volume-incr", 0.2],
  ["mouth/mouth-upperlip-volume-decr", 0.7],
  ["mouth/mouth-lowerlip-volume-decr", 0.7],
  ["expression/units/caucasian/mouth-open", -0.08],
];
const cacheName = (file) =>
  file.includes("/expression/units/")
    ? file.split("/").slice(-2).join("-")
    : file.split("/").at(-1);
const files = [
  "makehuman/data/3dobjs/base.obj",
  ...["caucasian", "asian"].flatMap((k) =>
    ["female", "male"].map(
      (sex) => `makehuman/data/targets/macrodetails/${k}-${sex}-young.target`,
    ),
  ),
  ...femaleSculpt.map(([path]) => `makehuman/data/targets/${path}.target`),
];
const manifest = [];
for (const file of files) {
  const path = folder + "/" + cacheName(file);
  let data;
  try {
    data = await readFile(path);
  } catch {
    const response = await fetch(source + file);
    if (!response.ok) throw Error(file + " " + response.status);
    data = Buffer.from(await response.arrayBuffer());
    await writeFile(path, data);
  }
  manifest.push({
    file,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
  });
}
const positions = [],
  groups = new Map();
let group = "";
for (const line of (await readFile(folder + "/base.obj", "utf8")).split(
  /\r?\n/,
)) {
  const p = line.trim().split(/\s+/);
  if (p[0] === "v") positions.push(p.slice(1, 4).map(Number));
  else if (p[0] === "g") group = p.slice(1).join(" ");
  else if (p[0] === "f") {
    const faces = groups.get(group) ?? [];
    faces.push(p.slice(1).map((x) => Number(x.split("/")[0]) - 1));
    groups.set(group, faces);
  }
}
await MeshoptSimplifier.ready;
const output = { female: null, male: null };
for (const sex of ["female", "male"]) {
  const p = positions.map((v) => [...v]);
  for (const [ethnicity, weight] of [
    ["caucasian", 0.65],
    ["asian", 0.35],
  ])
    for (const line of (
      await readFile(`${folder}/${ethnicity}-${sex}-young.target`, "utf8")
    ).split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const [i, x, y, z] = line.trim().split(/\s+/).map(Number);
      p[i][0] += x * weight;
      p[i][1] += y * weight;
      p[i][2] += z * weight;
    }
  if (sex === "female")
    for (const [target, weight] of femaleSculpt)
      for (const line of (
        await readFile(
          `${folder}/${cacheName("makehuman/data/targets/" + target + ".target")}`,
          "utf8",
        )
      ).split(/\r?\n/)) {
        if (!line || line.startsWith("#")) continue;
        const [i, x, y, z] = line.trim().split(/\s+/).map(Number);
        p[i][0] += x * weight;
        p[i][1] += y * weight;
        p[i][2] += z * weight;
      }
  const bounds = (g) => {
    const rows = [...new Set(groups.get(g).flat())].map((i) => p[i]);
    return [0, 1, 2].map(
      (k) =>
        (Math.min(...rows.map((v) => v[k])) +
          Math.max(...rows.map((v) => v[k]))) /
        2,
    );
  };
  const rawEyes = ["helper-l-eye", "helper-r-eye"].map(bounds),
    neck = bounds("joint-neck");
  const desiredEyeDistance = sex === "female" ? 0.056845 : 0.06;
  const scale = desiredEyeDistance / (rawEyes[0][0] - rawEyes[1][0]),
    oy = 1.614 - (rawEyes[0][1] + rawEyes[1][1]) * 0.5 * scale,
    oz = 0.071 - (rawEyes[0][2] + rawEyes[1][2]) * 0.5 * scale;
  const faces = groups
    .get("body")
    .filter((f) => f.every((i) => p[i][1] > neck[1] + 0.109));
  const ids = [...new Set(faces.flat())].sort((a, b) => a - b),
    map = new Map(ids.map((id, i) => [id, i]));
  const fitted = (id) => [
    p[id][0] * scale,
    p[id][1] * scale + oy,
    p[id][2] * scale + oz,
  ];
  const points = new Float32Array(ids.flatMap(fitted)),
    triangles = [];
  for (const f of faces)
    for (let i = 1; i < f.length - 1; i++)
      triangles.push(map.get(f[0]), map.get(f[i]), map.get(f[i + 1]));
  const normals = new Float32Array(points.length);
  for (let k = 0; k < triangles.length; k += 3) {
    const [a, b, c] = triangles.slice(k, k + 3).map((i) => i * 3),
      ab = [0, 1, 2].map((i) => points[b + i] - points[a + i]),
      ac = [0, 1, 2].map((i) => points[c + i] - points[a + i]),
      n = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
    for (const v of [a, b, c])
      for (let j = 0; j < 3; j++) normals[v + j] += n[j];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(...normals.slice(i, i + 3));
    if (l) for (let j = 0; j < 3; j++) normals[i + j] /= l;
  }
  const [simple, error] = MeshoptSimplifier.simplify(
    new Uint32Array(triangles),
    points,
    3,
    Math.min(triangles.length, 2600 * 3),
    0.003,
    ["LockBorder"],
  );
  const used = [...new Set(simple)].sort((a, b) => a - b),
    compact = new Map(used.map((id, i) => [id, i]));
  const eyes = ["helper-l-eye", "helper-r-eye"].map((g) => {
    const rows = [...new Set(groups.get(g).flat())].map(fitted);
    return [0, 1, 2].map(
      (k) =>
        (Math.min(...rows.map((v) => v[k])) +
          Math.max(...rows.map((v) => v[k]))) /
        2,
    );
  });
  output[sex] = {
    positions: used.flatMap((i) =>
      [...points.slice(i * 3, i * 3 + 3)].map((v) => Number(v.toFixed(7))),
    ),
    normals: used.flatMap((i) =>
      [...normals.slice(i * 3, i * 3 + 3)].map((v) => Number(v.toFixed(6))),
    ),
    indices: [...simple].map((i) => compact.get(i)),
    eyes,
    error,
    triangles: simple.length / 3,
  };
}
await writeFile("src/human-head-data.json", JSON.stringify(output));
await writeFile(
  folder + "/head-provenance.json",
  JSON.stringify(
    {
      source,
      revision,
      license: "CC0-1.0",
      manifest,
      femaleSculpt,
      output: { female: output.female.triangles, male: output.male.triangles },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    female: output.female.triangles,
    male: output.male.triangles,
    eyeCenters: output.female.eyes,
  }),
);
