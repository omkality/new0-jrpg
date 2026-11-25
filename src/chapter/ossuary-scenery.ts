import * as T from "three";
import { box, mesh, turn, beam, batch, v, type Mat } from "./scenery-mesh";
import { MIRROR, TABLETS, LAST_SINGER } from "./bell-quest";
import type { ForestChapter } from "./forest";

// Paint the three funerary marks as shallow, edge-lit reliefs. Even before the
// lettering catches the mirror, the vessel, feather and palm can be told apart.
function epitaph(index: number) {
  const panel = document.createElement("canvas");
  panel.width = 152;
  panel.height = 168;
  const c = panel.getContext("2d")!;
  c.fillStyle = "#464b48";
  c.fillRect(0, 0, 152, 168);
  for (let i = 0; i < 820; i++) {
    c.fillStyle = i % 2 ? "#505450" : "#3b403e";
    c.fillRect(
      (i * 71 + i * i * 13) % 151,
      (i * 97 + (i % 17) * 11) % 167,
      2 + (i % 6),
      1,
    );
  }
  c.strokeStyle = "#868b7f";
  c.lineWidth = 2;
  c.strokeRect(7, 7, 138, 154);
  c.strokeRect(12, 12, 128, 144);
  const glyph = [
    "M47 42 Q48 76 75 76 Q102 76 105 42 Z M76 76 V96 M58 98 H94",
    "M53 94 Q62 55 102 32 Q101 70 65 79 Z M54 94 L92 44 M69 74 L69 59 M76 67 L90 64",
    "M54 74 L45 60 Q42 53 48 54 L60 66 L54 41 Q53 35 58 36 L67 59 L64 31 Q64 25 69 27 L75 57 L76 29 Q77 23 81 27 L83 57 L89 36 Q92 31 95 35 L91 67 Q90 87 75 94 Q64 94 54 74 Z",
  ][index];
  c.strokeStyle = "#242b29";
  c.lineWidth = 5;
  c.stroke(new Path2D(glyph));
  c.translate(0, -2);
  c.strokeStyle = "#b2b4a7";
  c.lineWidth = 2.2;
  c.stroke(new Path2D(glyph));
  // The relief is visible in ambient light. Its shallow letters only catch
  // the grazing ray, so the player cannot read a dormant stone up close.
  const relief = document.createElement("canvas");
  relief.width = panel.width;
  relief.height = panel.height;
  relief.getContext("2d")!.drawImage(panel, 0, 0);
  c.textAlign = "center";
  c.font = '21px "Ebbe Black", serif';
  c.fillStyle = "#a6aa9d";
  c.fillText(["ВОДА", "ИВА", "САВВА"][index], 76, 122);
  for (let i = 0; i < 3; i++) {
    c.fillStyle = "#848a7f";
    for (let k = 0; k < 9; k++)
      c.fillRect(29 + k * 10, 135 + i * 5, 4 + ((k + i) % 4), 1);
  }
  const map = new T.CanvasTexture(relief);
  const inscription = new T.CanvasTexture(panel);
  map.colorSpace = inscription.colorSpace = T.SRGBColorSpace;
  return new T.MeshStandardMaterial({
    map,
    emissiveMap: inscription,
    emissive: 0x000000,
    roughness: 0.92,
  });
}
function bookPage(signed: boolean) {
  const image = document.createElement("canvas");
  image.width = 96;
  image.height = 96;
  const c = image.getContext("2d")!;
  c.fillStyle = "#afa38c";
  c.fillRect(0, 0, 96, 96);
  c.strokeStyle = "#67584a";
  c.lineWidth = 2;
  c.strokeRect(6, 7, 84, 82);
  c.fillStyle = "#756856";
  for (let i = 0; i < 6; i++)
    c.fillRect(15, 18 + i * 6, 50 + ((i * 11) % 18), 1);
  if (signed) {
    c.fillStyle = "#4d3434";
    c.textAlign = "center";
    c.font = '22px "Ebbe Black", serif';
    c.fillText("САВВА", 48, 76);
  }
  const map = new T.CanvasTexture(image);
  map.colorSpace = T.SRGBColorSpace;
  return new T.MeshStandardMaterial({
    map,
    roughness: 1,
    emissiveMap: map,
    emissive: 0x4d483f,
  });
}

export class OssuaryScenery {
  readonly root = new T.Group();
  private mirrorPlate = new T.Group();
  private swivel = new T.Group();
  private glassNormal = new T.Vector3();
  private shine = new T.Group();
  private mirrorSpot = new T.Mesh(
    new T.CircleGeometry(1, 20),
    new T.MeshBasicMaterial({
      color: 0xe2eadc,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    }),
  );
  private memorialLeaf = new T.Group();
  private memorialFlame = new T.Group();
  private signatures: T.Mesh[] = [];
  private stones: Mat[] = [];
  private mirrorOrigin = v(MIRROR.x, MIRROR.y + 1.32, MIRROR.z);
  private incoming = v(-1.65, 7, -84.8).sub(this.mirrorOrigin).normalize();
  private reflected = new T.Vector3();
  private aim = new T.Vector3();
  private axis = v(0, 1, 0);
  private mirrorAngle = 0;
  constructor(
    materials: Record<
      "bronze" | "iron" | "rim" | "timber" | "velvet" | "wax",
      Mat
    >,
    candleFlame: T.Group,
  ) {
    const room = this.root;
    const { bronze, iron, rim, timber, velvet, wax } = materials;
    const stand = new T.Group();
    stand.position.set(MIRROR.x, MIRROR.y, MIRROR.z);
    room.add(stand);
    turn(
      stand,
      iron,
      [
        [0, 0],
        [0.42, 0],
        [0.42, 0.08],
        [0.32, 0.14],
        [0.22, 0.18],
        [0.16, 0.25],
        [0.1, 0.85],
        [0.24, 0.94],
        [0.19, 1.0],
        [0, 1.0],
      ],
      0,
      0,
      0,
      12,
    );
    this.swivel.position.copy(this.mirrorOrigin);
    room.add(this.swivel);
    for (const side of [-1, 1]) {
      beam(
        this.swivel,
        iron,
        v(side * 0.12, -0.42, 0),
        v(side * 0.41, 0, 0),
        0.06,
        0.08,
      );
      mesh(
        this.swivel,
        new T.SphereGeometry(0.074, 8, 5),
        rim,
        side * 0.42,
        0,
        0,
      );
    }
    const grip = mesh(
      this.swivel,
      new T.CylinderGeometry(0.037, 0.051, 0.32, 8),
      timber,
      0.52,
      0,
      0,
    );
    grip.rotation.z = Math.PI / 2;
    batch(stand);
    batch(this.swivel);
    this.swivel.add(this.mirrorPlate);
    const silver = new T.MeshStandardMaterial({
      color: 0xbdc8c6,
      metalness: 0.45,
      roughness: 0.36,
      emissive: 0x727f7c,
      emissiveIntensity: 0.62,
    });
    const disc = mesh(
      this.mirrorPlate,
      new T.CylinderGeometry(0.39, 0.38, 0.075, 26),
      iron,
      0,
      0,
      0,
    );
    disc.rotation.x = Math.PI / 2;
    mesh(
      this.mirrorPlate,
      new T.CircleGeometry(0.353, 26),
      silver,
      0,
      0,
      0.042,
    );
    mesh(
      this.mirrorPlate,
      new T.TorusGeometry(0.368, 0.025, 6, 28),
      rim,
      0,
      0,
      0.046,
    );
    // The pilgrim sees the reverse of the tilted mirror. Its tinned ribs and
    // central boss belong to the same rotating dish as the polished face.
    for (const radius of [0.235, 0.35])
      mesh(
        this.mirrorPlate,
        new T.TorusGeometry(radius, 0.012, 5, 24),
        rim,
        0,
        0,
        -0.047,
      );
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      beam(
        this.mirrorPlate,
        bronze,
        v(0, 0, -0.051),
        v(0.33 * Math.cos(a), 0.33 * Math.sin(a), -0.051),
        0.025,
        0.02,
      );
    }
    mesh(
      this.mirrorPlate,
      new T.SphereGeometry(0.072, 10, 6),
      iron,
      0,
      0,
      -0.052,
    );
    batch(this.mirrorPlate);
    for (const [i, p] of TABLETS.entries()) {
      const slab = new T.Group();
      slab.position.set(p.x, p.y, p.z);
      room.add(slab);
      box(slab, iron, 0, 0.09, 0, 1.38, 0.18, 0.69);
      box(slab, iron, 0, 0.72, -0.055, 1.18, 1.12, 0.36);
      box(slab, bronze, 0, 1.38, -0.055, 1.25, 0.13, 0.42);
      box(slab, iron, 0, 1.49, -0.055, 0.94, 0.11, 0.32);
      const face = epitaph(i);
      this.stones.push(face);
      mesh(slab, new T.PlaneGeometry(0.89, 0.99), face, 0, 0.83, 0.132);
      batch(slab);
      if (i !== LAST_SINGER) continue;
      const book = new T.Group();
      slab.add(book);
      book.position.set(0, 0.49, 0.38);
      book.rotation.x = -0.91;
      box(slab, iron, 0, 0.42, 0.3, 1.18, 0.09, 0.49);
      for (const x of [-0.44, 0.44])
        beam(slab, bronze, v(x, 0.2, 0.17), v(x, 0.41, 0.48), 0.045, 0.05);
      box(book, velvet, -0.17, 0, 0, 0.34, 0.37, 0.036);
      for (const signed of [false, true]) {
        const page = mesh(
          book,
          new T.PlaneGeometry(0.305, 0.33),
          bookPage(signed),
          -0.17,
          0,
          0.022,
        );
        this.signatures.push(page);
      }
      book.add(this.memorialLeaf);
      box(this.memorialLeaf, velvet, 0.17, 0, 0, 0.34, 0.37, 0.036);
      mesh(
        this.memorialLeaf,
        new T.PlaneGeometry(0.3, 0.33),
        bookPage(false),
        0.17,
        0,
        0.022,
      );
      box(this.memorialLeaf, bronze, 0.155, 0, -0.022, 0.045, 0.18, 0.009);
      box(this.memorialLeaf, bronze, 0.155, 0, -0.021, 0.14, 0.036, 0.009);
      batch(this.memorialLeaf);
      const candleX = -0.49;
      turn(
        slab,
        bronze,
        [
          [0, 0],
          [0.1, 0],
          [0.12, 0.04],
          [0.11, 0.05],
        ],
        candleX,
        0.46,
        0.42,
        12,
      );
      box(slab, wax, candleX, 0.55, 0.42, 0.067, 0.16, 0.067);
      this.memorialFlame = candleFlame.clone(true);
      this.memorialFlame.position.set(candleX, 0.63, 0.42);
      slab.add(this.memorialFlame);
      batch(slab);
    }
    room.add(this.shine, this.mirrorSpot);
    for (const [a, b, opacity] of [
      [0.105, 0.035, 0.095],
      [0.055, 0.014, 0.12],
    ]) {
      const ray = new T.Mesh(
        new T.CylinderGeometry(a, b, 1, 12, 1, true),
        new T.MeshBasicMaterial({
          color: 0xd9e7e7,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      this.shine.add(ray);
    }
    this.mirrorSpot.scale.set(0.42, 0.49, 1);
  }
  update(dt: number, game: ForestChapter) {
    this.root.visible = game.player.z < -51;
    if (!this.root.visible) return;
    this.mirrorAngle = T.MathUtils.damp(
      this.mirrorAngle,
      game.mirrorIndex,
      9,
      dt,
    );
    const lo = Math.floor(this.mirrorAngle),
      hi = Math.min(TABLETS.length - 1, lo + 1);
    const a = TABLETS[lo],
      b = TABLETS[hi],
      w = this.mirrorAngle - lo;
    const t = T.MathUtils.lerp;
    const closed = game.memorial === "rest";
    this.aim.set(t(a.x, b.x, w), MIRROR.y + 0.96, t(a.z, b.z, w) + 0.152);
    this.reflected.copy(this.aim).sub(this.mirrorOrigin);
    const length = this.reflected.length();
    this.reflected.normalize();
    this.glassNormal.copy(this.incoming).add(this.reflected).normalize();
    this.swivel.rotation.y = Math.atan2(this.glassNormal.x, this.glassNormal.z);
    this.mirrorPlate.rotation.x = -Math.asin(this.glassNormal.y);
    this.shine.position.copy(this.mirrorOrigin).lerp(this.aim, 0.5);
    this.shine.scale.y = length;
    this.shine.quaternion.setFromUnitVectors(this.axis, this.reflected);
    this.mirrorSpot.position.copy(this.aim);
    for (const [i, s] of this.stones.entries())
      s.emissive.setScalar(
        1.12 * Math.max(0, 1 - Math.abs(this.mirrorAngle - i) * 3),
      );
    this.memorialLeaf.rotation.y = T.MathUtils.damp(
      this.memorialLeaf.rotation.y,
      closed ? -3.07 : -0.05,
      7,
      dt,
    );
    this.memorialFlame.visible = game.memorial === "inscribe";
    this.signatures[0].visible = !this.memorialFlame.visible;
    this.signatures[1].visible = this.memorialFlame.visible;
  }
}
