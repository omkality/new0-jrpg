import * as THREE from "three";

// Original, deterministic small textures for this game. The reference images
// guide the composition and lighting only. No pixels from another game are used.
const noise = (i: number) => {
  const n = Math.sin(i * 127.13 + 6.71) * 43758.5453;
  return n - Math.floor(n);
};
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export type EnvironmentPattern =
  | "brick"
  | "earth"
  | "mud"
  | "bark"
  | "leaves"
  | "fern"
  | "fire"
  | "torch-wrap";

export function environmentTexture(kind: EnvironmentPattern) {
  const canvas = document.createElement("canvas");
  canvas.width = kind === "fire" ? 1024 : 256;
  canvas.height = kind === "fire" ? 128 : 256;
  const ctx = canvas.getContext("2d")!;
  if (kind === "brick") {
    ctx.fillStyle = "#30332e";
    ctx.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 12; row++) {
      const h = 256 / 12;
      for (let col = -1; col < 6; col++) {
        const seed = row * 29 + col * 7 + 93;
        const x = col * 51.2 + (row % 2) * 25.6;
        const shade = noise(seed) * 19;
        const r = 85 + shade;
        const g = 78 + shade * 0.9;
        const b = 65 + shade * 0.75;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1.2, row * h + 1.1, 48.9, h - 2.2);
        ctx.fillStyle = "#b2a38a38";
        ctx.fillRect(x + 2.1, row * h + 1.1, 46.7, 1.1);
        ctx.fillStyle = "#181c1a77";
        ctx.fillRect(x + 1.2, row * h + h - 2.2, 48.9, 1.1);
        for (let p = 0; p < 34; p++) {
          ctx.fillStyle = p % 2 ? "#1a25262c" : "#c6bca32b";
          ctx.fillRect(
            x + 3 + noise(seed + p * 5) * 45,
            row * h + 3 + noise(seed + p * 13) * (h - 6),
            1 + noise(p + seed) * 4,
            1 + noise(p * 4 + seed) * 2,
          );
        }
      }
    }
    // Long, faint moisture stains read as old masonry under local torch light.
    for (let i = 0; i < 27; i++) {
      const x = noise(i + 80) * 256;
      const g = ctx.createLinearGradient(x, 0, x, 256);
      g.addColorStop(0, "#15232200");
      g.addColorStop(noise(i + 31) * 0.5 + 0.2, "#182a2430");
      g.addColorStop(1, "#182a2408");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 2 + noise(i + 25) * 11, 256);
    }
  } else if (kind === "earth" || kind === "mud") {
    const image = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const mottling =
          Math.sin(x * 0.069 + Math.sin(y * 0.021) * 3) * 5 +
          Math.cos(y * 0.083 + x * 0.029) * 4 +
          noise(x + y * 257) * 13;
        const moss =
          kind === "earth" ? Math.max(0, Math.sin(x * 0.05 + y * 0.04)) * 8 : 0;
        const base = kind === "mud" ? 65 : 78;
        image.data.set(
          [
            base + mottling - moss * 0.3,
            base - 4 + mottling + moss,
            base - 18 + mottling * 0.7,
            255,
          ],
          (y * 256 + x) * 4,
        );
      }
    ctx.putImageData(image, 0, 0);
    for (let i = 0; i < (kind === "earth" ? 420 : 95); i++) {
      const x = noise(i * 3) * 256,
        y = noise(i * 7 + 31) * 256;
      const angle = noise(i + 38) * Math.PI * 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = ["#62553b", "#777151", "#484f36", "#988267"][i % 4];
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        1 + noise(i + 54) * 2,
        3 + noise(i + 76) * 5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = "#34392d";
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(0, 4);
      ctx.stroke();
      ctx.restore();
    }
  } else if (kind === "bark" || kind === "torch-wrap") {
    ctx.fillStyle = kind === "bark" ? "#575747" : "#6d6048";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1050; i++) {
      const x = noise(i + 9) * 256,
        y = noise(i + 57) * 256;
      ctx.strokeStyle = i % 3 ? "#242b244b" : "#b8b09936";
      ctx.lineWidth = 0.5 + noise(i + 11) * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x + 2,
        y + 7,
        x - 3,
        y + 17,
        x + noise(i) * 3,
        y + 7 + noise(i + 22) * 38,
      );
      ctx.stroke();
    }
    if (kind === "torch-wrap") {
      for (let y = -20; y < 280; y += 19) {
        ctx.strokeStyle = "#a5966c";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y + 12);
        ctx.stroke();
        ctx.strokeStyle = "#322c23";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y + 5);
        ctx.lineTo(256, y + 17);
        ctx.stroke();
      }
      const char = ctx.createLinearGradient(0, 0, 0, 256);
      char.addColorStop(0, "#090b0aeb");
      char.addColorStop(0.45, "#171714b0");
      char.addColorStop(1, "#15171100");
      ctx.fillStyle = char;
      ctx.fillRect(0, 0, 256, 256);
    }
  } else if (kind === "leaves") {
    ctx.lineCap = "round";
    for (let branch = 0; branch < 8; branch++) {
      const angle = (branch / 8) * Math.PI * 1.65 - Math.PI * 0.82;
      const endX = 128 + Math.sin(angle) * (66 + noise(branch + 5) * 33);
      const endY = 127 - Math.cos(angle) * (72 + noise(branch + 7) * 37);
      ctx.strokeStyle = "#333d2b";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(128, 232);
      ctx.quadraticCurveTo(128, 142, endX, endY);
      ctx.stroke();
      for (let i = 0; i < 58; i++) {
        const t = 0.19 + noise(i * 7 + branch * 23) * 0.8;
        const x = 128 + (endX - 128) * t + (noise(i + branch * 17) - 0.5) * 36;
        const y = 232 + (endY - 232) * t + (noise(i + branch * 31) - 0.5) * 28;
        ctx.fillStyle = ["#425342", "#65745a", "#7d8766", "#344b3c", "#56634b"][
          i % 5
        ];
        ctx.beginPath();
        ctx.ellipse(
          x,
          y,
          2.2 + noise(i + 8) * 3.9,
          1.1 + noise(i + 42) * 2.3,
          angle + noise(i) * 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  } else if (kind === "fern") {
    ctx.fillStyle = "#5b6c4c";
    ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 3) {
      ctx.strokeStyle = x % 2 ? "#a6ac7255" : "#263e2d7a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 95, 256);
      ctx.stroke();
    }
    ctx.strokeStyle = "#b6b385";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(128, 256);
    ctx.lineTo(128, 0);
    ctx.stroke();
  } else if (kind === "fire") {
    const image = ctx.createImageData(1024, 128);
    for (let frame = 0; frame < 8; frame++)
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 128; x++) {
          const h = 1 - y / 127;
          const bend =
            Math.sin(h * 7 + frame * 0.78) * 0.11 * h +
            Math.sin(h * 16 - frame) * 0.028;
          const width =
            (0.23 + Math.sin(h * Math.PI) * 0.24) * Math.pow(1 - h, 0.6);
          const dx = Math.abs((x / 127 - 0.5) * 2 - bend);
          const edge = 1 - smooth(width * 0.68, width, dx);
          const tongues =
            0.78 +
            Math.sin(h * 31 + frame * 1.1 + x * 0.13) * 0.11 +
            noise(x + y * 128 + frame * 5) * 0.11;
          const alpha =
            edge * tongues * smooth(0, 0.045, h) * (1 - smooth(0.91, 1, h));
          const core =
            (1 - smooth(width * 0.12, width * 0.7, dx)) * (1 - h * 0.62);
          image.data.set(
            [255, 112 + core * 132, 32 + core * 172, Math.round(alpha * 255)],
            (y * 1024 + frame * 128 + x) * 4,
          );
        }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `new0-original-${kind}-fixes1`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT =
    kind === "fire" || kind === "leaves"
      ? THREE.ClampToEdgeWrapping
      : THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 2;
  return texture;
}
