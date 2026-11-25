// Loaded only on demand by the local review recorder, never by the playing loop.
import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  CanvasSource,
  Quality,
} from "mediabunny";

export class FrameCapture {
  frames = 0;
  busy = false;
  private target = new BufferTarget();
  private output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: this.target,
  });
  private source: CanvasSource;
  private pending: Promise<void> = Promise.resolve();
  constructor(canvas: HTMLCanvasElement) {
    this.source = new CanvasSource(canvas, {
      codec: "avc",
      quality: new Quality({ bitrate: 7_000_000 }),
      hardwareAcceleration: "prefer-hardware",
      latencyMode: "quality",
      keyFrameInterval: 2,
    });
    this.output.addVideoTrack(this.source, { frameRate: 60 });
  }
  async start() {
    try {
      await this.output.start();
    } catch (error) {
      await this.cancel();
      throw error;
    }
  }
  cancel() {
    return this.output.cancel();
  }
  add() {
    this.busy = true;
    this.pending = this.source
      .add(this.frames / 60, 1 / 60)
      .then(() => {
        this.frames++;
      })
      .finally(() => {
        this.busy = false;
      });
    return this.pending;
  }
  async finish() {
    try {
      await this.pending;
      this.source.close();
      await this.output.finalize();
      return new Blob([this.target.buffer!], { type: "video/mp4" });
    } catch (error) {
      await this.cancel();
      throw error;
    }
  }
}
