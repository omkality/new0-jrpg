import * as THREE from "three";

// Original figures with adult proportions, cloth folds and deliberately stepped poses.
export class Actor {
  root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private arms = [new THREE.Group(), new THREE.Group()];
  private legs = [new THREE.Group(), new THREE.Group()];
  private clock = 0;
  private current = "idle";
  private oneShot = false;
  constructor(guard = false) {
    const cloth = new THREE.MeshLambertMaterial({
      map: clothTexture(guard),
      color: guard ? 0xaaa397 : 0xc5c0b6,
    });
    const leather = new THREE.MeshLambertMaterial({ color: 0x282b2a });
    const bone = new THREE.MeshLambertMaterial({ color: 0xa6a598 });
    const iron = new THREE.MeshStandardMaterial({
      color: 0x666961,
      roughness: 0.9,
      metalness: 0.35,
    });
    const black = new THREE.MeshBasicMaterial({ color: 0x0c0c0d });
    this.root.add(this.body);
    this.root.scale.setScalar(guard ? 1.13 : 1);
    const mesh = (
      g: THREE.BufferGeometry,
      m: THREE.Material,
      parent: THREE.Group,
      x: number,
      y: number,
      z: number,
    ) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    mesh(
      new THREE.CylinderGeometry(0.22, 0.19, 0.48, 7),
      cloth,
      this.body,
      0,
      1.18,
      0,
    );
    mesh(new THREE.BoxGeometry(0.47, 0.12, 0.22), cloth, this.body, 0, 1.39, 0);
    mesh(
      new THREE.CylinderGeometry(0.205, 0.225, 0.08, 7),
      leather,
      this.body,
      0,
      0.96,
      0,
    );
    const verts: number[] = [],
      uvs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2,
        b = ((i + 1) / 10) * Math.PI * 2;
      const top = (t: number) => [
        Math.sin(t) * 0.265,
        1.37,
        Math.cos(t) * 0.17 - 0.025,
      ];
      const bottom = (t: number, n: number) => [
        Math.sin(t) * 0.35,
        0.48 + (n % 3) * 0.035,
        Math.cos(t) * 0.25 - 0.025,
      ];
      const p = top(a),
        q = top(b),
        r = bottom(a, i),
        s = bottom(b, i + 1);
      verts.push(...p, ...r, ...q, ...q, ...r, ...s);
      uvs.push(
        i / 10,
        1,
        i / 10,
        0,
        (i + 1) / 10,
        1,
        (i + 1) / 10,
        1,
        i / 10,
        0,
        (i + 1) / 10,
        0,
      );
    }
    const robe = new THREE.BufferGeometry();
    robe.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    robe.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    robe.computeVertexNormals();
    const robeMat = cloth.clone();
    robeMat.side = THREE.DoubleSide;
    mesh(robe, robeMat, this.body, 0, 0, 0);
    this.head.position.y = 1.58;
    this.body.add(this.head);
    mesh(
      new THREE.CylinderGeometry(0.13, 0.175, 0.29, 7),
      cloth,
      this.head,
      0,
      0.045,
      -0.015,
    );
    mesh(
      new THREE.BoxGeometry(0.225, 0.24, 0.08),
      black,
      this.head,
      0,
      0.02,
      0.11,
    );
    const mask = mesh(
      new THREE.SphereGeometry(0.117, 6, 5),
      bone,
      this.head,
      0,
      0.015,
      0.143,
    );
    mask.scale.set(0.73, 1.03, 0.42);
    for (const x of [-0.035, 0.035])
      mesh(
        new THREE.PlaneGeometry(0.029, 0.014),
        black,
        this.head,
        x,
        0.04,
        0.197,
      );
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.arms[i].position.set(side * 0.275, 1.36, 0);
      this.body.add(this.arms[i]);
      mesh(
        new THREE.CylinderGeometry(0.075, 0.06, 0.31, 5),
        cloth,
        this.arms[i],
        0,
        -0.145,
        0,
      );
      mesh(
        new THREE.CylinderGeometry(0.06, 0.05, 0.29, 5),
        leather,
        this.arms[i],
        0,
        -0.435,
        0.018,
      );
      mesh(
        new THREE.BoxGeometry(0.085, 0.105, 0.075),
        leather,
        this.arms[i],
        0,
        -0.61,
        0.025,
      );
      this.legs[i].position.set(side * 0.115, 0.88, 0);
      this.body.add(this.legs[i]);
      mesh(
        new THREE.CylinderGeometry(0.085, 0.065, 0.4, 5),
        leather,
        this.legs[i],
        0,
        -0.19,
        0,
      );
      mesh(
        new THREE.CylinderGeometry(0.065, 0.055, 0.36, 5),
        leather,
        this.legs[i],
        0,
        -0.55,
        0,
      );
      mesh(
        new THREE.BoxGeometry(0.13, 0.14, 0.25),
        leather,
        this.legs[i],
        0,
        -0.77,
        0.045,
      );
    }
    if (guard) {
      for (const x of [-0.25, 0.25]) {
        const plate = mesh(
          new THREE.ConeGeometry(0.17, 0.23, 4),
          iron,
          this.body,
          x,
          1.43,
          0,
        );
        plate.rotation.z = x < 0 ? -0.5 : 0.5;
      }
      const blade = new THREE.Shape();
      blade.moveTo(-0.045, 0);
      blade.lineTo(0.045, 0);
      blade.lineTo(0.06, 0.66);
      blade.lineTo(0, 0.86);
      blade.lineTo(-0.06, 0.66);
      blade.closePath();
      const sword = mesh(
        new THREE.ExtrudeGeometry(blade, { depth: 0.025, bevelEnabled: false }),
        iron,
        this.arms[1],
        0,
        -0.64,
        0.1,
      );
      sword.rotation.x = Math.PI;
      mesh(
        new THREE.BoxGeometry(0.2, 0.035, 0.045),
        iron,
        this.arms[1],
        0,
        -0.69,
        0.11,
      );
    } else {
      const shield = mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 0.045, 8),
        iron,
        this.arms[0],
        -0.02,
        -0.38,
        0.07,
      );
      shield.rotation.x = Math.PI / 2;
      mesh(
        new THREE.BoxGeometry(0.03, 0.23, 0.052),
        bone,
        this.arms[0],
        -0.02,
        -0.38,
        0.098,
      );
      mesh(
        new THREE.BoxGeometry(0.16, 0.025, 0.052),
        bone,
        this.arms[0],
        -0.02,
        -0.38,
        0.098,
      );
    }
  }
  play(name: string, once = false) {
    if (name === this.current && !once) return;
    this.current = name;
    this.clock = 0;
    this.oneShot = once;
  }
  update(dt: number) {
    this.clock += dt;
    const t = Math.floor(this.clock * 12) / 12,
      walking = this.current === "walk",
      stride = walking ? Math.sin(t * 9) * 0.42 : 0;
    this.legs[0].rotation.x = stride;
    this.legs[1].rotation.x = -stride;
    this.arms[0].rotation.x = -stride * 0.6;
    this.arms[1].rotation.x = stride * 0.6;
    this.arms[0].rotation.z = 0.06;
    this.arms[1].rotation.z = -0.06;
    this.body.position.y = walking
      ? Math.abs(Math.sin(t * 9)) * 0.025
      : Math.sin(t * 1.8) * 0.008;
    this.head.rotation.x = Math.sin(t * 1.4) * 0.025;
    if (this.current.includes("attack")) {
      this.arms[1].rotation.x = -1.7 + Math.min(1, t / 0.45) * 2;
      this.arms[0].rotation.x = -0.55;
      this.body.rotation.y = Math.sin(Math.min(t / 0.55, 1) * Math.PI) * 0.2;
    } else if (this.current === "interact-right") {
      this.arms[0].rotation.x = -1.05;
      this.arms[1].rotation.x = -0.8;
    } else this.body.rotation.y = 0;
    this.body.rotation.z = this.current === "die" ? Math.min(0.5, t * 0.6) : 0;
    if (this.oneShot && this.clock > 1.1 && this.current !== "die")
      this.play("idle");
  }
}
function clothTexture(guard: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!,
    img = ctx.createImageData(64, 64);
  let seed = guard ? 777 : 123;
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const c =
        48 +
        (seed % 16) +
        Math.cos(x * 0.72) * 9 +
        Math.cos(x * 0.21) * 5 -
        (y > 45 ? (y - 45) * 0.6 : 0);
      img.data.set(
        [c + (guard ? 4 : 0), c + 1, c + (guard ? -2 : 4), 255],
        (y * 64 + x) * 4,
      );
    }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  return texture;
}
