export class HUDTextCache {
  private entries = new Map<
    string,
    { canvas: HTMLCanvasElement; width: number; baseline: number; pad: number }
  >();
  private pixels = 0;
  constructor(privateCanvas = () => document.createElement("canvas")) {
    this.makeCanvas = privateCanvas;
  }
  private makeCanvas: () => HTMLCanvasElement;
  clear() {
    for (const e of this.entries.values()) e.canvas.width = e.canvas.height = 0;
    this.entries.clear();
    this.pixels = 0;
  }
  draw(
    target: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign,
  ) {
    const font = `${size}px "Ebbe Black"`,
      key = `${font}|${color}|${value}`;
    let entry = this.entries.get(key);
    if (!entry) {
      const canvas = this.makeCanvas(),
        ctx = canvas.getContext("2d")!;
      ctx.font = font;
      const width = Math.ceil(ctx.measureText(value).width),
        pad = 12,
        baseline = Math.ceil(size * 1.1) + pad;
      canvas.width = width + pad * 2;
      canvas.height = Math.ceil(size * 1.8) + pad * 2;
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.shadowColor = "#132232";
      ctx.shadowBlur = 5;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(12,16,17,0.8)";
      ctx.strokeText(value, pad, baseline);
      ctx.fillText(value, pad, baseline);
      entry = { canvas, width, pad, baseline };
      this.pixels += canvas.width * canvas.height;
    } else this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > 96 || this.pixels > 524288) {
      const oldest = this.entries.keys().next().value!;
      if (oldest === key && this.entries.size === 1) break;
      const old = this.entries.get(oldest)!;
      this.pixels -= old.canvas.width * old.canvas.height;
      old.canvas.width = old.canvas.height = 0;
      this.entries.delete(oldest);
    }
    target.drawImage(
      entry.canvas,
      x -
        entry.pad -
        (align === "center"
          ? entry.width / 2
          : align === "right"
            ? entry.width
            : 0),
      y - entry.baseline,
    );
  }
  get size() {
    return this.entries.size;
  }
  get pixelCount() {
    return this.pixels;
  }
}
