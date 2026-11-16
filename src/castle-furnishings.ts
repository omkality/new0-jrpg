export type CryptFurnishingKind =
  "sarcophagus" | "ossuary" | "memorial" | "supplies";
// These are occupied burial/storage bays, not freestanding barred doorways.
// The same measured footprints are consumed by the visual and physical world.
export const CRYPT_FURNISHINGS = [
  { x: -5.8, z: -80, kind: "sarcophagus", hx: 0.98, hz: 0.52, height: 1.1 },
  { x: -5.8, z: -86, kind: "ossuary", hx: 0.96, hz: 0.5, height: 1.38 },
  { x: -5.8, z: -92, kind: "memorial", hx: 0.93, hz: 0.5, height: 1.45 },
  { x: -5.8, z: -98, kind: "supplies", hx: 0.93, hz: 0.53, height: 1.25 },
  { x: 5.8, z: -80, kind: "supplies", hx: 0.93, hz: 0.53, height: 1.25 },
  { x: 5.8, z: -86, kind: "sarcophagus", hx: 0.98, hz: 0.52, height: 1.1 },
  { x: 5.8, z: -92, kind: "ossuary", hx: 0.96, hz: 0.5, height: 1.38 },
  { x: 5.8, z: -98, kind: "memorial", hx: 0.93, hz: 0.5, height: 1.45 },
] as const;
