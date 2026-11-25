import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
export type Mat = T.MeshStandardMaterial;
export const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
export function mesh(
  parent: T.Group,
  g: T.BufferGeometry,
  m: Mat,
  x: number,
  y: number,
  z: number,
) {
  const part = new T.Mesh(g, m);
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}
export function box(
  parent: T.Group,
  m: Mat,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  return mesh(parent, new T.BoxGeometry(w, h, d), m, x, y, z);
}
export function turn(
  parent: T.Group,
  m: Mat,
  profile: number[][],
  x: number,
  y: number,
  z: number,
  segments = 24,
) {
  return mesh(
    parent,
    new T.LatheGeometry(
      profile.map(([a, b]) => new T.Vector2(a, b)),
      segments,
    ),
    m,
    x,
    y,
    z,
  );
}
export function beam(
  parent: T.Group,
  m: Mat,
  a: T.Vector3,
  b: T.Vector3,
  w: number,
  d: number,
) {
  const delta = b.clone().sub(a);
  const part = box(
    parent,
    m,
    (a.x + b.x) / 2,
    (a.y + b.y) / 2,
    (a.z + b.z) / 2,
    w,
    delta.length(),
    d,
  );
  part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
}
export function batch(group: T.Group) {
  const byMaterial = new Map<Mat, T.BufferGeometry[]>();
  for (const part of [...group.children]) {
    if (!(part instanceof T.Mesh)) continue;
    part.updateMatrix();
    const g = part.geometry.index
      ? part.geometry.toNonIndexed()
      : part.geometry;
    g.applyMatrix4(part.matrix);
    const list = byMaterial.get(part.material) ?? [];
    list.push(g);
    byMaterial.set(part.material, list);
    if (g !== part.geometry) part.geometry.dispose();
    group.remove(part);
  }
  for (const [m, shapes] of byMaterial) {
    group.add(new T.Mesh(mergeGeometries(shapes)!, m));
    for (const g of shapes) g.dispose();
  }
}
