import { Matrix4, Quaternion, Vector3 } from "three";

export function structure(doc) {
  const nodes = doc.getRoot().listNodes();
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const parent = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  const base = new Map(
    nodes.map((n) => [
      n,
      {
        p: new Vector3().fromArray(n.getTranslation()),
        q: new Quaternion().fromArray(n.getRotation()).normalize(),
        s: new Vector3().fromArray(n.getScale()),
      },
    ]),
  );
  return { nodes, byName, parent, base };
}

export const clone = (pose) =>
  new Map(
    [...pose].map(([n, s]) => [
      n,
      {
        p: s.p.clone(),
        q: s.q.clone(),
        s: s.s.clone(),
      },
    ]),
  );

export function world(info, pose, node, cache = new Map()) {
  if (cache.has(node)) return cache.get(node).clone();
  const s = pose.get(node),
    m = new Matrix4().compose(s.p, s.q, s.s);
  if (info.parent.has(node))
    m.premultiply(world(info, pose, info.parent.get(node), cache));
  cache.set(node, m.clone());
  return m;
}
export const position = (info, pose, node) =>
  new Vector3().setFromMatrixPosition(world(info, pose, node));
export function rotation(info, pose, node) {
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3();
  world(info, pose, node).decompose(p, q, s);
  return q.normalize();
}
export function sample(info, animation, time) {
  const pose = clone(info.base);
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler(),
      ts = sampler.getInput().getArray();
    const values = sampler.getOutput().getArray(),
      path = channel.getTargetPath();
    const node = info.byName.get(channel.getTargetNode().getName());
    if (!node) continue;
    let a = 0;
    while (a < ts.length - 2 && ts[a + 1] < time) a++;
    const b = Math.min(a + 1, ts.length - 1);
    const u =
      ts[a] === ts[b]
        ? 0
        : Math.max(0, Math.min(1, (time - ts[a]) / (ts[b] - ts[a])));
    const state = pose.get(node);
    if (path === "rotation")
      state.q
        .fromArray(values, a * 4)
        .slerp(new Quaternion().fromArray(values, b * 4), u)
        .normalize();
    else if (path === "translation")
      state.p
        .fromArray(values, a * 3)
        .lerp(new Vector3().fromArray(values, b * 3), u);
    else if (path === "scale")
      state.s
        .fromArray(values, a * 3)
        .lerp(new Vector3().fromArray(values, b * 3), u);
    else throw new Error(`Unsupported path ${path}`);
  }
  return pose;
}

export function blend(a, b, u) {
  const out = clone(a);
  for (const [n, s] of out) {
    s.p.lerp(b.get(n).p, u);
    s.q.slerp(b.get(n).q, u).normalize();
    s.s.lerp(b.get(n).s, u);
  }
  return out;
}
export const smooth = (u) => {
  u = Math.min(1, Math.max(0, u));
  return u * u * (3 - 2 * u);
};
