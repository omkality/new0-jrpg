import * as THREE from "three";
import { RELIC_BLADE } from "./weapon-spec";

let metalTexture: THREE.CanvasTexture | undefined;
function wornMetal() {
  if (metalTexture) return metalTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#a6afbf";
  ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle =
      i % 4 === 0 ? "#586475" : i % 3 === 0 ? "#c4cbd5" : "#8590a1";
    ctx.fillRect((i * 29) % 64, (i * 13) % 64, 1, 2 + (i % 7));
  }
  metalTexture = new THREE.CanvasTexture(canvas);
  metalTexture.colorSpace = THREE.SRGBColorSpace;
  metalTexture.magFilter = THREE.NearestFilter;
  return metalTexture;
}

export function makeWeapon(kind: string, relic = false) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: relic ? 0xb7bdcc : 0x929da3,
    map: wornMetal(),
    metalness: 0.3,
    roughness: 0.72,
    flatShading: true,
  });
  const grip = new THREE.MeshStandardMaterial({
    color: 0x342e3b,
    roughness: 1,
  });
  const shape = new THREE.Shape();
  if (relic) {
    // A hooked silver crescent. The hollow curve reads clearly at phone resolution.
    shape.moveTo(-0.045, 0);
    shape.lineTo(0.045, 0);
    shape.lineTo(0.065, 0.42);
    shape.quadraticCurveTo(0.56, 0.69, 0.46, 1.19);
    shape.quadraticCurveTo(0.34, 0.96, 0.2, 0.92);
    shape.lineTo(0.32, 0.84);
    shape.lineTo(0.14, 0.8);
    shape.lineTo(0.23, 0.71);
    shape.quadraticCurveTo(-0.13, 0.6, -0.045, 0);
  } else if (kind === "gaoler") {
    shape.moveTo(-0.055, 0);
    shape.lineTo(0.1, 0);
    shape.lineTo(0.18, 0.48);
    shape.lineTo(0.13, 0.68);
    shape.lineTo(-0.04, 0.61);
  } else {
    const width = kind === "watcher" ? 0.026 : 0.037;
    const len = kind === "watcher" ? 1.03 : kind === "effigy" ? 0.62 : 0.83;
    shape.moveTo(-width, 0);
    shape.lineTo(width, 0);
    shape.lineTo(width * 0.7, len - 0.14);
    shape.lineTo(0, len);
    shape.lineTo(-width * 0.9, len - 0.12);
  }
  shape.closePath();
  const blade = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: kind === "gaoler" ? 0.038 : 0.02,
      bevelEnabled: true,
      bevelSize: 0.006,
      bevelThickness: 0.004,
      bevelSegments: 1,
      curveSegments: 7,
    }),
    metal,
  );
  blade.position.y = RELIC_BLADE.baseY;
  if (relic)
    blade.scale.set(RELIC_BLADE.widthScale, RELIC_BLADE.lengthScale, 1);
  group.add(blade);
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(relic ? 0.29 : 0.19, 0.035, 0.055),
    metal,
  );
  guard.position.y = 0.085;
  group.add(guard);
  group.add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.19, 8), grip),
  );
  const end = new THREE.Mesh(
    new THREE.OctahedronGeometry(relic ? 0.052 : 0.035),
    metal,
  );
  end.position.y = -0.12;
  group.add(end);
  group.position.set(0, 0.06, 0);
  group.rotation.x = -Math.PI / 2;
  return group;
}
