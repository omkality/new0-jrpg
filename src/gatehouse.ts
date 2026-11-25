import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FOREST_GATE, VESTRY, type Wall } from "./world-layout.ts";

type GateStone = {
  ashlar: T.Material;
  dressed: T.Material;
  recess: T.Material;
  iron: T.Material;
  standard: T.Material;
};
type Place = (mesh: T.Mesh, uvScale?: number) => void;
const hingeHeights = [0.44, 1.58, 2.72] as const;
const heelRadius = 0.146;

// A flat masonry lintel, with tapered joints over the span. The unbroken
// bearing wall behind the facing also closes the passage on the courtyard side.
function polygon(points: number[][], thickness: number) {
  const shape = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)));
  return new T.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
}

export function gateWall(w: Wall, m: GateStone, place: Place) {
  const width = 2 * w.hx,
    depth = 2 * w.hz;
  const block = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    material = m.dressed,
  ) => {
    const mesh = new T.Mesh(new T.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(w.x + x, y, w.z + z);
    place(mesh, material === m.ashlar ? 0.64 : 0.85);
  };
  const top = w.base + w.height;
  if (w.id.startsWith("gate-tower")) {
    // The slit is recessed into the facade. The tower is solid at player height.
    const skin = 0.34,
      slotY = 4.8,
      slotH = 1.19,
      opening = 0.2;
    block(0, top / 2, -skin / 2, width, top, depth - skin, m.ashlar);
    const face = w.hz - skin / 2;
    const sill = slotY - slotH / 2,
      head = slotY + slotH / 2;
    block(0, sill / 2, face, width, sill, skin, m.ashlar);
    block(0, (head + top) / 2, face, width, top - head, skin, m.ashlar);
    for (const side of [-1, 1]) {
      block(
        (side * (width + opening)) / 4,
        slotY,
        face,
        (width - opening) / 2,
        slotH,
        skin,
        m.ashlar,
      );
      block(
        side * (opening / 2 + 0.095),
        slotY,
        w.hz + 0.022,
        0.19,
        slotH,
        0.055,
      );
      // The jamb stones are toothed into the front corners in alternating courses.
      for (let course = 0; course < 13; course++) {
        const span = course % 2 ? 0.32 : 0.55,
          h = 0.49;
        const y = (course + 0.5) * h;
        block(
          side * (w.hx - span / 2 + 0.025),
          y,
          w.hz,
          span,
          h - 0.024,
          0.085,
        );
        block(
          side * (w.hx + 0.004),
          y,
          w.hz - span / 2 - 0.04,
          0.053,
          h - 0.024,
          span,
        );
      }
    }
    block(0, slotY, w.hz - skin + 0.003, opening, slotH, 0.006, m.recess);
    for (const y of [sill - 0.065, head + 0.065])
      block(0, y, w.hz + 0.025, 0.7, 0.13, 0.08);
    block(0, 0.24, 0, width + 0.09, 0.48, depth + 0.1);
    block(0, top - 0.32, 0, width + 0.14, 0.15, depth + 0.14);
    const intoOpening = -Math.sign(w.x - FOREST_GATE.x);
    for (const y of hingeHeights) {
      // Fixed pintle shoes project from the masonry under the moving hinge bands.
      block(intoOpening * w.hx, y - 0.14, 0, 0.06, 0.25, 0.19, m.iron);
      block(
        intoOpening * (w.hx + heelRadius / 2),
        y - 0.13,
        0,
        heelRadius + 0.05,
        0.052,
        0.11,
        m.iron,
      );
    }
    for (const z of [-1, 1]) {
      for (const x of [-1, 1])
        block(
          x * (w.hx - 0.36),
          top + 0.32,
          z * (w.hz - 0.28),
          0.73,
          0.64,
          0.56,
          m.ashlar,
        );
      block(z * (w.hx - 0.23), top + 0.3, 0, 0.46, 0.6, 0.68, m.ashlar);
    }
  } else {
    block(0, w.base + w.height / 2, 0, width, w.height, depth, m.ashlar);
    if (w.id === "gate-header") {
      for (const face of [-1, 1]) {
        const span = w.hx + 0.25;
        for (let i = 0; i < 9; i++) {
          const a = ((i / 9) * 2 - 1) * span,
            b = (((i + 1) / 9) * 2 - 1) * span;
          const mesh = new T.Mesh(
            polygon(
              [
                [a + 0.008, 0],
                [b - 0.008, 0],
                [b * 1.14 - 0.008, 0.43],
                [a * 1.14 + 0.008, 0.43],
              ],
              0.12,
            ),
            m.dressed,
          );
          mesh.position.set(
            w.x,
            w.base - 0.012,
            w.z + face * w.hz - (face < 0 ? 0.119 : 0.001),
          );
          place(mesh);
        }
      }
      // The watch's spindle is woven into a short standard fixed to a rail.
      const railY = top - 0.38;
      block(0, railY, w.hz + 0.13, 1.05, 0.055, 0.055, m.iron);
      for (const side of [-1, 1])
        block(
          side * 0.46,
          railY - 0.035,
          w.hz + 0.08,
          0.065,
          0.14,
          0.14,
          m.iron,
        );
      const cloth = new T.PlaneGeometry(0.78, 1.36, 6, 3);
      const p = cloth.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          t = 0.5 - y / 1.36;
        p.setXYZ(
          i,
          x,
          y - 0.2 * (1 - Math.abs(x) / 0.39) * t * t,
          0.027 * Math.cos(x * 22) * (0.45 + t),
        );
      }
      cloth.computeVertexNormals();
      const banner = new T.Mesh(cloth, m.standard);
      banner.position.set(w.x, railY - 0.67, w.z + w.hz + 0.14);
      place(banner, 0);
    }
    const merlons = w.id === "gate-header" ? 2 : 3;
    for (let i = 0; i < merlons; i++) {
      const x = ((i + 0.5) / merlons - 0.5) * width;
      block(x, top + 0.25, w.hz - 0.23, 0.64, 0.5, 0.46, m.ashlar);
    }
  }
  block(0, top - 0.045, 0, width + 0.1, 0.12, depth + 0.12);
}

export function standardTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const pen = canvas.getContext("2d")!;
  pen.fillStyle = "#743c3d";
  pen.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 2) {
    pen.fillStyle = y % 6 ? "#af8d6950" : "#342a3470";
    pen.fillRect(0, y, 64, 1);
  }
  for (let x = 0; x < 64; x += 3) {
    pen.fillStyle = x % 2 ? "#b59c7b25" : "#241b2725";
    pen.fillRect(x, 0, 1, 128);
  }
  pen.strokeStyle = "#ccb995";
  pen.lineWidth = 2.5;
  pen.beginPath();
  pen.moveTo(6, 0);
  pen.lineTo(6, 111);
  pen.lineTo(32, 123);
  pen.lineTo(58, 111);
  pen.lineTo(58, 0);
  pen.stroke();
  pen.lineWidth = 3.5;
  pen.beginPath();
  pen.moveTo(32, 23);
  pen.lineTo(32, 94);
  pen.moveTo(32, 37);
  pen.lineTo(20, 54);
  pen.lineTo(32, 72);
  pen.lineTo(44, 54);
  pen.closePath();
  pen.stroke();
  for (const y of [80, 86]) pen.fillRect(25, y, 14, 2);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

// Two moving meshes per leaf. The inner timber rails, outside strap hinges,
// handle and lock move on the same pintle as the timber they belong to.
// A single ledged leaf hangs under the masonry lintel. The inner and outer
// faces share a solid core and the straps wrap the hinge stile.
export function vestryDoor(oakMap: T.Texture) {
  const root = new T.Group(),
    pivot = new T.Group();
  root.name = "VestryDoor";
  pivot.name = "DoorPivot";
  const heel = -VESTRY.width / 2 + 0.075;
  pivot.position.x = heel;
  root.add(pivot);
  const oak = new T.MeshStandardMaterial({
    map: oakMap,
    color: 0x9c9690,
    roughness: 0.94,
  });
  const iron = new T.MeshStandardMaterial({
    color: 0x55565a,
    metalness: 0.48,
    roughness: 0.73,
  });
  const wood: T.BufferGeometry[] = [],
    metal: T.BufferGeometry[] = [];
  function add(
    list: T.BufferGeometry[],
    g: T.BufferGeometry,
    x: number,
    y: number,
    z: number,
  ) {
    g.translate(x, y, z);
    const expanded = g.index ? g.toNonIndexed() : g;
    if (expanded !== g) g.dispose();
    list.push(expanded);
  }
  const h = VESTRY.clearHeight + 0.018,
    width = VESTRY.width - 0.04;
  add(wood, new T.BoxGeometry(width, h, 0.112), -heel, h / 2, 0);
  for (const y of [0.46, 1.57]) {
    add(wood, new T.BoxGeometry(width - 0.09, 0.15, 0.07), -heel, y, -0.085);
    add(
      metal,
      polygon(
        [
          [-0.05, -0.07],
          [0.2, -0.065],
          [0.94, -0.028],
          [1.05, 0],
          [0.94, 0.028],
          [0.2, 0.065],
          [-0.05, 0.07],
        ],
        0.033,
      ),
      0,
      y,
      0.06,
    );
    add(metal, new T.CylinderGeometry(0.072, 0.072, 0.21, 8), 0, y, 0);
    for (const x of [0.19, 0.52, 0.86])
      add(metal, new T.SphereGeometry(0.026, 6, 4), x, y, 0.094);
  }
  for (const face of [-1, 1]) {
    add(
      metal,
      new T.BoxGeometry(0.132, 0.23, 0.034),
      width - 0.29,
      1.05,
      face * 0.075,
    );
    add(
      metal,
      new T.SphereGeometry(0.039, 6, 4),
      width - 0.29,
      1.09,
      face * 0.102,
    );
    add(
      metal,
      new T.TorusGeometry(0.078, 0.015, 5, 12),
      width - 0.29,
      1.01,
      face * 0.114,
    );
  }
  for (const [parts, material] of [
    [wood, oak],
    [metal, iron],
  ] as const) {
    pivot.add(new T.Mesh(mergeGeometries(parts)!, material));
    for (const g of parts) g.dispose();
  }
  root.position.set(VESTRY.x, VESTRY.y, VESTRY.z);
  return root;
}

export function blackGate(oakMap: T.Texture) {
  const root = new T.Group(),
    half = FOREST_GATE.width / 2,
    h = FOREST_GATE.clearance;
  const hinge = half - heelRadius;
  const oak = new T.MeshStandardMaterial({
    map: oakMap,
    color: 0xb6b5ad,
    roughness: 0.96,
  });
  const iron = new T.MeshStandardMaterial({
    color: 0x454d50,
    metalness: 0.38,
    roughness: 0.75,
  });
  for (const side of [-1, 1]) {
    const pivot = new T.Group(),
      leaf = new T.Group();
    pivot.name = side < 0 ? "GateLeft" : "GateRight";
    pivot.position.x = side * hinge;
    leaf.scale.x = -side;
    const timber: T.BufferGeometry[] = [],
      fittings: T.BufferGeometry[] = [];
    const add = (
      geometry: T.BufferGeometry,
      list: T.BufferGeometry[],
      x: number,
      y: number,
      z: number,
    ) => {
      geometry.translate(x, y, z);
      if (geometry.index) {
        const expanded = geometry.toNonIndexed();
        geometry.dispose();
        geometry = expanded;
      }
      list.push(geometry);
    };
    // A round heel stile turns in place. Its outer edge stays tangent to the
    // jamb at every angle, including when the doors open towards the forest.
    add(
      new T.CylinderGeometry(heelRadius, heelRadius, h, 12),
      timber,
      0,
      h / 2 + 0.009,
      0,
    );
    const plankWidth = hinge + 0.024;
    const plank = new T.BoxGeometry(plankWidth, h, 0.15);
    const uv = plank.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      uv.setX(i, side < 0 ? u : 1 - u);
    }
    add(plank, timber, hinge - plankWidth / 2, h / 2 + 0.009, 0);
    // Timber ledges on the back are high enough to hold the nail shanks.
    for (const y of hingeHeights) {
      const railWidth = hinge - 0.16;
      const ledge = new T.BoxGeometry(railWidth, 0.15, 0.056);
      const uv = ledge.attributes.uv;
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, uv.getY(i) * 0.18, uv.getX(i));
      add(ledge, timber, 0.12 + railWidth / 2, y, -0.102);
      const shape = [
        [0, -0.085],
        [0.26, -0.087],
        [0.43, -0.048],
        [1.0, -0.031],
        [1.1, -0.076],
        [1.25, 0],
        [1.1, 0.076],
        [1.0, 0.031],
        [0.43, 0.048],
        [0.26, 0.087],
        [0, 0.085],
      ];
      add(polygon(shape, 0.038), fittings, 0, y, 0.077);
      add(
        new T.CylinderGeometry(
          heelRadius + 0.002,
          heelRadius + 0.002,
          0.19,
          12,
        ),
        fittings,
        0,
        y,
        0,
      );
      for (const x of [0.17, 0.45, 0.79, 1.1]) {
        const head = new T.SphereGeometry(0.037, 6, 4);
        head.scale(1, 1, 0.55);
        add(head, fittings, x, y, 0.118);
      }
    }
    const pull = hinge - 0.25;
    add(
      polygon(
        [
          [0, 0.16],
          [0.083, 0.045],
          [0.057, -0.035],
          [0, -0.073],
          [-0.057, -0.035],
          [-0.083, 0.045],
        ],
        0.028,
      ),
      fittings,
      pull,
      1.3,
      0.077,
    );
    add(new T.SphereGeometry(0.059, 7, 5), fittings, pull, 1.33, 0.14);
    add(new T.TorusGeometry(0.125, 0.022, 5, 14), fittings, pull, 1.2, 0.17);
    if (side === 1) {
      const lock = new T.Shape([
        new T.Vector2(-0.09, -0.14),
        new T.Vector2(0.09, -0.14),
        new T.Vector2(0.09, 0.1),
        new T.Vector2(0, 0.15),
        new T.Vector2(-0.09, 0.1),
      ]);
      const hole = new T.Path(
        [
          [-0.022, -0.06],
          [-0.011, 0.01],
          [-0.032, 0.034],
          [-0.018, 0.062],
          [0.014, 0.065],
          [0.035, 0.038],
          [0.012, 0.009],
          [0.022, -0.06],
        ].map(([x, y]) => new T.Vector2(x, y)),
      );
      hole.closePath();
      lock.holes.push(hole);
      add(
        new T.ExtrudeGeometry(lock, {
          depth: 0.032,
          bevelEnabled: false,
          curveSegments: 4,
        }),
        fittings,
        hinge - 0.12,
        0.9,
        0.08,
      );
    }
    for (const [parts, material] of [
      [timber, oak],
      [fittings, iron],
    ] as const) {
      leaf.add(new T.Mesh(mergeGeometries(parts)!, material));
      for (const geometry of parts) geometry.dispose();
    }
    pivot.add(leaf);
    root.add(pivot);
  }
  return root;
}
