// Headless asset QA adapter. Runtime still uses the normal GLTFLoader.
// Use the same module instance as src/ so runtime instanceof checks remain real.
import * as THREE from "../../node_modules/three/build/three.module.js";
import { structure } from "./pose-sampling.mjs";

export function threeRig(document) {
  const info = structure(document),
    root = new THREE.Group();
  const joints = new Set(
    document
      .getRoot()
      .listSkins()
      .flatMap((s) => s.listJoints()),
  );
  const meshes = new Map();
  const makeMesh = (node, p, index) => {
    const g = new THREE.BufferGeometry();
    for (const [name, semantic] of [
      ["position", "POSITION"],
      ["normal", "NORMAL"],
      ["skinIndex", "JOINTS_0"],
      ["skinWeight", "WEIGHTS_0"],
      ["uv", "TEXCOORD_0"],
    ]) {
      const accessor = p.getAttribute(semantic);
      if (accessor)
        g.setAttribute(
          name,
          new THREE.BufferAttribute(
            accessor.getArray().slice(),
            accessor.getElementSize(),
            accessor.getNormalized(),
          ),
        );
    }
    if (p.getIndices())
      g.setIndex(
        new THREE.BufferAttribute(p.getIndices().getArray().slice(), 1),
      );
    const mesh = node.getSkin()
      ? new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial())
      : new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    mesh.name =
      (node.getName() || node.getMesh().getName()) + (index ? "_" + index : "");
    if (p.listTargets().length) {
      g.morphTargetsRelative = true;
      g.morphAttributes.position = p
        .listTargets()
        .map(
          (t) =>
            new THREE.BufferAttribute(
              t.getAttribute("POSITION").getArray().slice(),
              3,
            ),
        );
      mesh.updateMorphTargets();
      mesh.morphTargetDictionary = Object.fromEntries(
        (node.getMesh().getExtras().targetNames ?? []).map((n, i) => [n, i]),
      );
      mesh.morphTargetInfluences = p.listTargets().map(() => 0);
    }
    const list = meshes.get(node) ?? [];
    list.push(mesh);
    meshes.set(node, list);
    return mesh;
  };
  const objects = new Map(
    info.nodes.map((n) => {
      const primitives = n.getMesh()?.listPrimitives();
      const o = primitives?.length
        ? makeMesh(n, primitives[0], 0)
        : joints.has(n)
          ? new THREE.Bone()
          : new THREE.Group();
      for (let i = 1; i < (primitives?.length ?? 0); i++)
        o.add(makeMesh(n, primitives[i], i));
      return [n, o];
    }),
  );
  for (const [node, o] of objects) {
    o.name = node.getName() || node.getMesh()?.getName() || "";
    const b = info.base.get(node);
    o.position.copy(b.p);
    o.quaternion.copy(b.q);
    o.scale.copy(b.s);
    (info.parent.has(node) ? objects.get(info.parent.get(node)) : root).add(o);
  }
  root.updateMatrixWorld(true);
  for (const [node, list] of meshes)
    if (node.getSkin()) {
      const skin = node.getSkin(),
        data = skin.getInverseBindMatrices().getArray();
      const inverses = skin
        .listJoints()
        .map((_, i) => new THREE.Matrix4().fromArray(data, i * 16));
      for (const mesh of list)
        mesh.bind(
          new THREE.Skeleton(
            skin.listJoints().map((j) => objects.get(j)),
            inverses,
          ),
          new THREE.Matrix4(),
        );
    }
  root.updateMatrixWorld(true);
  return { root, info, objects };
}
export function setPose(rig, pose) {
  for (const [n, o] of rig.objects) {
    const s = pose.get(n);
    o.position.copy(s.p);
    o.quaternion.copy(s.q);
    o.scale.copy(s.s);
  }
  rig.root.updateMatrixWorld(true);
}
export function weaponGroup(document, spec, shift, grip) {
  const r = threeRig(document).root;
  r.rotation.y = spec.twist;
  r.scale.setScalar(spec.scale);
  const offset = new THREE.Group();
  offset.position.y = shift;
  offset.add(r);
  const mount = new THREE.Group();
  mount.position.fromArray(grip);
  mount.rotation.x = -Math.PI / 2;
  mount.add(offset);
  return mount;
}
