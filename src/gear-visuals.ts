import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Small original meshes. They share geometry/materials when cloned and have no
// decoder, network, animation-mixer or per-frame allocation cost.
export function flaskModel() {
  const root = new THREE.Group();
  const profile = [
    [0.035, 0],
    [0.095, 0.025],
    [0.12, 0.12],
    [0.105, 0.22],
    [0.046, 0.28],
    [0.046, 0.36],
    [0.055, 0.37],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.MeshStandardMaterial({
    color: 0xaac2bb,
    metalness: 0.25,
    roughness: 0.25,
    emissive: 0x34463f,
    emissiveIntensity: 0.18,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  root.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 12), glass));
  const liquid = new THREE.Mesh(
    new THREE.SphereGeometry(0.092, 12, 8),
    new THREE.MeshStandardMaterial({
      color: 0x843f49,
      roughness: 0.45,
      metalness: 0.1,
    }),
  );
  liquid.name = "FlaskLiquid";
  liquid.position.y = 0.12;
  liquid.scale.y = 0.92;
  root.add(liquid);
  const stopper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.043, 0.038, 0.065, 10),
    new THREE.MeshStandardMaterial({ color: 0x69594c, roughness: 1 }),
  );
  stopper.name = "FlaskStopper";
  stopper.position.y = 0.39;
  root.add(stopper);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.009, 5, 12),
    new THREE.MeshStandardMaterial({
      color: 0xc2c0a8,
      metalness: 0.7,
      roughness: 0.5,
    }),
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.31;
  root.add(band);
  return root;
}

export function armourModel() {
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x66727b,
    metalness: 0.35,
    roughness: 0.9,
    flatShading: true,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x3b4246,
    metalness: 0.2,
    roughness: 0.9,
  });
  const plate = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.16, -0.22),
        new THREE.Vector2(0.2, -0.08),
        new THREE.Vector2(0.24, 0.08),
        new THREE.Vector2(0.21, 0.18),
        new THREE.Vector2(0.14, 0.25),
      ],
      10,
    ),
    metal,
  );
  plate.scale.z = 0.74;
  root.add(plate);
  for (const s of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.5, 0.07), dark);
    strap.position.set(s * 0.17, 0.02, -0.12);
    root.add(strap);
    const shoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2),
      metal,
    );
    shoulder.position.set(s * 0.25, 0.18, 0);
    shoulder.scale.set(1.1, 0.45, 1.15);
    root.add(shoulder);
  }
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.164, 0.012, 3, 10),
    dark,
  );
  rim.rotation.x = Math.PI / 2;
  rim.scale.y = 0.74;
  rim.position.y = -0.21;
  root.add(rim);
  return root;
}

export function blackGate() {
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x161d22,
    metalness: 0.45,
    roughness: 0.8,
  });
  const edge = new THREE.MeshStandardMaterial({
    color: 0x737e82,
    metalness: 0.65,
    roughness: 0.6,
  });
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? "GateLeft" : "GateRight";
    pivot.position.x = side * 1.52;
    const leaf = new THREE.Group();
    leaf.position.x = -side * 0.76;
    pivot.add(leaf);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.95, 0.12), metal);
    panel.position.y = 1.49;
    leaf.add(panel);
    for (const y of [0.18, 1, 2.05, 2.82]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.065, 0.18), edge);
      rib.position.y = y;
      leaf.add(rib);
      for (const x of [-0.61, -0.3, 0, 0.3, 0.61]) {
        const rivet = new THREE.Mesh(
          new THREE.SphereGeometry(0.022, 6, 4),
          edge,
        );
        rivet.position.set(x, y, 0.11);
        leaf.add(rivet);
      }
    }
    for (const x of [-0.67, 0.67]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.09, 3, 0.2), edge);
      rib.position.set(x, 1.5, 0);
      leaf.add(rib);
    }
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const mesh of [...leaf.children] as THREE.Mesh[]) {
      mesh.updateMatrix();
      const material = mesh.material as THREE.Material;
      const batch = batches.get(material) ?? [];
      batch.push(mesh.geometry.clone().applyMatrix4(mesh.matrix));
      batches.set(material, batch);
      mesh.geometry.dispose();
    }
    leaf.clear();
    for (const [material, geometries] of batches) {
      leaf.add(new THREE.Mesh(mergeGeometries(geometries)!, material));
      for (const g of geometries) g.dispose();
    }
    root.add(pivot);
  }
  return root;
}

let glowTexture: THREE.CanvasTexture | undefined;
export function lootGlow(color: number) {
  if (!glowTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "#fffffff0");
    gradient.addColorStop(0.2, "#ffffff70");
    gradient.addColorStop(1, "#ffffff00");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    glowTexture = new THREE.CanvasTexture(canvas);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  sprite.scale.setScalar(0.65);
  return sprite;
}
