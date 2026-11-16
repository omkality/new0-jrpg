import * as THREE from "three";

// A handful of actual sole vertices corrects blended poses without skinning
// the whole character or rebuilding a collision tree in the game loop.
export class FootContact {
  private samples: { mesh: THREE.SkinnedMesh; index: number }[] = [];
  private point = new THREE.Vector3();
  constructor(rig: THREE.Object3D) {
    rig.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh) || !o.visible) return;
      const p = o.geometry.getAttribute("position"),
        si = o.geometry.getAttribute("skinIndex"),
        sw = o.geometry.getAttribute("skinWeight");
      if (!p || !si || !sw) return;
      for (const side of ["L", "R"]) {
        const vertices: number[] = [];
        for (let i = 0; i < p.count; i++) {
          let influence = 0;
          for (let k = 0; k < 4; k++)
            if (
              new RegExp(`^(foot|toe)_${side}$`).test(
                o.skeleton.bones[si.getComponent(i, k)]?.name ?? "",
              )
            )
              influence += sw.getComponent(i, k);
          if (influence > 0.5) vertices.push(i);
        }
        if (!vertices.length) continue;
        const minY = Math.min(...vertices.map((i) => p.getY(i))),
          sole = vertices.filter((i) => p.getY(i) < minY + 0.055),
          chosen = new Set<number>();
        for (const [x, z] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [-1, 1],
          [1, -1],
          [-1, -1],
        ]) {
          let best = Infinity,
            index = sole[0];
          for (const i of sole) {
            const value = p.getY(i) * 2 + p.getX(i) * x + p.getZ(i) * z;
            if (value < best) {
              best = value;
              index = i;
            }
          }
          chosen.add(index);
        }
        for (const index of chosen) this.samples.push({ mesh: o, index });
      }
    });
  }
  offset(ground: number) {
    let min = Infinity;
    for (const s of this.samples) {
      s.mesh.getVertexPosition(s.index, this.point);
      s.mesh.localToWorld(this.point);
      min = Math.min(min, this.point.y);
    }
    return Number.isFinite(min) ? ground + 0.008 - min : 0;
  }
  get count() {
    return this.samples.length;
  }
}
