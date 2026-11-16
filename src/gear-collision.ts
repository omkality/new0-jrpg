import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WeaponId } from "./world-layout";

const contactPoint = new THREE.Vector3(),
  contactNormal = new THREE.Vector3(),
  contactOrigin = new THREE.Vector3(),
  contactDelta = new THREE.Vector3();
// Both BVHs use body-world coordinates here. This runs only after a contact,
// and returns the outer escape direction nearest the hand, rather than a fixed
// world-axis shove that can move a rolling arm through its own tucked thighs.
export function surfacePush(
  body: MeshBVH,
  weapon: MeshBVH,
  matrix: THREE.Matrix4,
  out: THREE.Vector3,
) {
  out.set(0, 0, 0);
  contactOrigin.setFromMatrixPosition(matrix);
  let nearest = Infinity;
  body.bvhcast(weapon, matrix, {
    intersectsTriangles(a, b) {
      if (!a.intersectsTriangle(b)) return false;
      a.getMidpoint(contactPoint);
      a.getNormal(contactNormal);
      contactDelta.copy(contactOrigin).sub(contactPoint);
      if (contactNormal.dot(contactDelta) < 0) contactNormal.negate();
      const distance = contactPoint.distanceToSquared(contactOrigin);
      if (distance < nearest) {
        nearest = distance;
        out.copy(contactNormal).multiplyScalar(0.055);
      }
      return false;
    },
  });
}

// CPU-only meshes are refitted in place. Their buffers are never uploaded to
// WebGL. Clothing is sampled after the current animation blend, not from a rest
// pose capsule, so a tucked roll also protects the hanging hem and hood.
export class GearCollision {
  private cloth: { mesh: THREE.SkinnedMesh; start: number }[] = [];
  private surface: THREE.BufferGeometry;
  private tree?: MeshBVH;
  private weapons = new Map<
    WeaponId,
    { geometry: THREE.BufferGeometry; tree: MeshBVH; bounds: THREE.Box3 }
  >();
  private v = new THREE.Vector3();
  private inverse = new THREE.Matrix4();
  private transform = new THREE.Matrix4();
  private box = new THREE.Box3();
  constructor(
    rig: THREE.Object3D,
    hand: THREE.Object3D,
    weapons: Map<string, THREE.Group>,
    includeBody = false,
  ) {
    let total = 0;
    const indices: number[] = [];
    rig.traverse((o) => {
      if (
        !(o instanceof THREE.SkinnedMesh) ||
        !(
          /^new0_v[78]_/.test(o.name) ||
          (includeBody && o.name.startsWith("tripo_mesh_"))
        )
      )
        return;
      const count = o.geometry.getAttribute("position").count;
      this.cloth.push({ mesh: o, start: total });
      const index = o.geometry.index;
      for (let i = 0; i < (index?.count ?? count); i += 3) {
        const tri = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
        if (o.name.startsWith("tripo_mesh_")) {
          const j = o.geometry.getAttribute("skinIndex"),
            w = o.geometry.getAttribute("skinWeight");
          if (
            tri.some((v) =>
              [0, 1, 2, 3].some(
                (k) =>
                  /^hand_/.test(o.skeleton.bones[j.getComponent(v, k)].name) &&
                  w.getComponent(v, k) > 0.18,
              ),
            )
          )
            continue;
        }
        indices.push(...tri.map((v) => total + v));
      }
      total += count;
    });
    this.surface = new THREE.BufferGeometry();
    this.surface.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(total * 3), 3),
    );
    this.surface.setIndex(indices);
    this.update();
    if (total > 0) this.tree = new MeshBVH(this.surface);
    rig.updateWorldMatrix(true, true);
    this.inverse.copy(hand.matrixWorld).invert();
    for (const [id, root] of weapons) {
      if (id === "unarmed") continue;
      const pieces: THREE.BufferGeometry[] = [];
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          this.transform.multiplyMatrices(this.inverse, o.matrixWorld);
          const g = new THREE.BufferGeometry();
          g.setAttribute(
            "position",
            o.geometry.getAttribute("position").clone(),
          );
          if (o.geometry.index) g.setIndex(o.geometry.index.clone());
          g.applyMatrix4(this.transform);
          pieces.push(g);
        }
      });
      if (!pieces.length) continue;
      const geometry = mergeGeometries(pieces)!;
      for (const p of pieces) p.dispose();
      geometry.computeBoundingBox();
      const tree = new MeshBVH(geometry);
      geometry.boundsTree = tree;
      this.weapons.set(id as WeaponId, {
        geometry,
        tree,
        bounds: geometry.boundingBox!.clone(),
      });
    }
  }
  update() {
    const p = this.surface.getAttribute("position");
    for (const { mesh, start } of this.cloth) {
      mesh.skeleton.update();
      for (let i = 0; i < mesh.geometry.getAttribute("position").count; i++) {
        mesh.getVertexPosition(i, this.v).applyMatrix4(mesh.matrixWorld);
        p.setXYZ(start + i, this.v.x, this.v.y, this.v.z);
      }
    }
    this.tree?.refit();
  }
  penalty(
    id: WeaponId,
    matrix: THREE.Matrix4,
    floor: number,
    correction?: THREE.Vector3,
  ) {
    const w = this.weapons.get(id);
    if (!w) return 0;
    const cloth = this.tree?.intersectsGeometry(w.geometry, matrix) ?? false;
    this.box.copy(w.bounds).applyMatrix4(matrix);
    if (correction) {
      correction.set(0, 0, 0);
      if (cloth && this.tree)
        surfacePush(this.tree, w.tree, matrix, correction);
      correction.y += Math.max(0, floor + 0.012 - this.box.min.y);
    }
    return (
      (cloth ? 1000 : 0) + Math.max(0, floor + 0.008 - this.box.min.y) * 10000
    );
  }
  dispose() {
    this.surface.dispose();
    for (const w of this.weapons.values()) w.geometry.dispose();
    this.weapons.clear();
    this.cloth.length = 0;
  }
}
