// Capture a real playthrough through the normal controls, including all DOM and sound.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { playBellRoute } from "./bell-route.mjs";

const [, , url, destination, pass = "fight", vow = "all"] = process.argv;
if (
  !url ||
  !destination ||
  !["fight", "pay"].includes(pass) ||
  !["all", "one"].includes(vow)
)
  throw new Error(
    "Usage: node capture-forest.mjs <loopback chapter URL> <output.mp4> [fight|pay] [all|one]",
  );
const local = new URL(url);
if (!["localhost", "127.0.0.1", "[::1]"].includes(local.hostname))
  throw new Error("Use a local preview for recording");
local.searchParams.set("routeProbe", "1");
const fps = 60,
  sampleRate = 24000,
  audioSeconds = 240,
  output = resolve(destination),
  folder = dirname(output);
const stills = process.env.NEW0_ROUTE_STILLS,
  verify = process.env.NEW0_VERIFY_ROUTE === "1";
await mkdir(folder, { recursive: true });
if (stills) await mkdir(stills, { recursive: true });
const stem = join(folder, ".forest-" + randomUUID());
const video = stem + ".mp4",
  audio = stem + ".wav",
  movie = stem + "-mux.mp4";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
function encode(args, pipe = false) {
  const proc = spawn(
    process.env.FFMPEG || "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: [pipe ? "pipe" : "ignore", "ignore", "inherit"] },
  );
  const done = new Promise((resolve) => {
    proc.on("error", (e) => resolve(e));
    proc.on("close", (code) =>
      resolve(code === 0 ? null : new Error("FFmpeg exit " + code)),
    );
  });
  if (pipe) proc.stdin.on("error", () => {});
  return { proc, done };
}
async function exportSound(page, frames) {
  await page.evaluate(async () => {
    window.recordedBellSamples = (
      await window.recordedBellContext.startRendering()
    ).getChannelData(0);
  });
  const n = (frames * sampleRate) / fps,
    h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(n * 2 + 36, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(n * 2, 40);
  const f = await open(audio, "w");
  try {
    await f.write(h);
    for (let off = 0; off < n; off += 16_384) {
      const data = await page.evaluate(
        ([off, len]) => {
          const v = window.recordedBellSamples.subarray(off, off + len);
          const pcm = Int16Array.from(v, (a) =>
            Math.round(Math.min(1, Math.max(-1, a)) * 32767),
          );
          return btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
        },
        [off, Math.min(16_384, n - off)],
      );
      await f.write(Buffer.from(data, "base64"));
    }
  } finally {
    await f.close();
  }
}
let encoder;
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 720 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await page.goto(local.href, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Играть", exact: true })
    .waitFor({ timeout: 90000 });
  const session = await page.context().newCDPSession(page);
  await page.evaluate(
    ({ fps, sampleRate, audioSeconds }) => {
      let clock = performance.now(),
        frames = 0,
        id = 10000;
      const pending = new Map();
      window.requestAnimationFrame = (cb) => {
        pending.set(++id, cb);
        return id;
      };
      window.cancelAnimationFrame = (id) => pending.delete(id);
      window.captureForestFrame = () => {
        frames++;
        clock += 1000 / fps;
        const batch = [...pending.values()];
        pending.clear();
        for (const cb of batch) cb(clock);
      };
      const ctx = new OfflineAudioContext(
        1,
        audioSeconds * sampleRate,
        sampleRate,
      );
      Object.defineProperty(ctx, "currentTime", { get: () => frames / fps });
      ctx.resume = ctx.suspend = async () => {};
      window.recordedBellContext = ctx;
      window.AudioContext = class {
        constructor() {
          return ctx;
        }
      };
    },
    { fps, sampleRate, audioSeconds },
  );
  if (!verify)
    encoder = encode(
      [
        "-f",
        "image2pipe",
        "-framerate",
        String(fps),
        "-vcodec",
        "mjpeg",
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        video,
      ],
      true,
    );
  let frame = 0;
  async function advance(count) {
    if (verify) {
      await page.evaluate((n) => {
        for (let i = 0; i < n; i++) window.captureForestFrame();
      }, count);
      frame += count;
      return;
    }
    for (let i = 0; i < count; i++) {
      await page.evaluate(() => window.captureForestFrame());
      const { data } = await session.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 96,
        fromSurface: true,
        optimizeForSpeed: true,
      });
      await new Promise((ok, fail) =>
        encoder.proc.stdin.write(Buffer.from(data, "base64"), (e) =>
          e ? fail(e) : ok(),
        ),
      );
      frame++;
    }
  }
  const marks = {};
  async function mark(id) {
    marks[id] = Number((frame / fps).toFixed(2));
    if (stills) await page.screenshot({ path: join(stills, id + ".png") });
    console.log(id, marks[id]);
  }
  const report = await playBellRoute(page, session, advance, mark, {
    pass,
    vow,
    inspectStairs: verify && process.env.NEW0_VERIFY_COURT === "1",
  });
  if (errors.length) throw new Error(errors.join("\n"));
  if (!verify) {
    encoder.proc.stdin.end();
    const err = await encoder.done;
    if (err) throw err;
    if (frame / fps > audioSeconds)
      throw new Error("Offline audio length exceeded");
    await exportSound(page, frame);
    const mux = encode([
      "-i",
      video,
      "-i",
      audio,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-movflags",
      "+faststart",
      "-shortest",
      movie,
    ]);
    const error = await mux.done;
    if (error) throw error;
    await rename(movie, output);
  }
  console.log(
    JSON.stringify({
      output: verify ? null : output,
      frames: frame,
      fps,
      marks,
      report,
    }),
  );
} finally {
  if (encoder && encoder.proc.exitCode === null) encoder.proc.kill();
  await browser.close();
  for (const file of [video, audio, movie]) await rm(file, { force: true });
}
