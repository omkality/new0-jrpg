import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { assetUrl } from "./assets";

const releasedBitmaps = new WeakSet<ImageBitmap>();
export function releaseTexture(texture: THREE.Texture) {
  texture.dispose();
  const data = texture.source.data;
  if (
    typeof ImageBitmap !== "undefined" &&
    data instanceof ImageBitmap &&
    !releasedBitmaps.has(data)
  ) {
    data.close();
    releasedBitmaps.add(data);
  }
}
const cache = new Map<string, Promise<GLTF>>();
export function loadModel(path: string) {
  let pending = cache.get(path);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(assetUrl(path)).catch((error) => {
      cache.delete(path);
      throw error;
    });
    cache.set(path, pending);
  }
  return pending;
}
export const modelCacheSize = () => cache.size;
const props = new Map<string, GLTF>();
const propNames = [
  "chest",
  "mimic",
  "weapon-sword",
  "weapon-axe",
  "weapon-spear",
  "key",
  "coins",
  "door",
];
export async function loadProps() {
  await Promise.all(
    propNames.map(async (name) => {
      props.set(name, await loadModel(`/assets/props-v7/${name}.glb`));
    }),
  );
}
export function prop(name: string) {
  const model = props.get(name);
  if (!model) throw new Error(`Asset not loaded: ${name}`);
  return model.scene.clone(true);
}
export function propModel(name: string) {
  return props.get(name)!;
}

// Shared geometry/maps are disposed once, including unrendered cached prototypes.
export async function disposeModels() {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  for (const pending of cache.values()) {
    const model = await pending.catch(() => null);
    if (!model) continue;
    model.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      for (const material of Array.isArray(o.material)
        ? o.material
        : [o.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    });
  }
  for (const t of textures) releaseTexture(t);
  for (const m of materials) m.dispose();
  for (const g of geometries) g.dispose();
  cache.clear();
  props.clear();
}
