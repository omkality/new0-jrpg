import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
if (process.env.NEW0_RESOURCE_CONTAINER !== "1" || !existsSync("/.dockerenv"))
  throw new Error(
    "Run this browser test in its documented Docker container. It never attaches to a desktop browser.",
  );
const folder = fileURLToPath(new URL("./", import.meta.url));
const results = process.env.NEW0_RESOURCE_RESULTS ?? resolve(folder, "results");
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  globalTimeout: 20.5 * 60_000,
  outputDir: resolve(results, "test-results"),
  reporter: [
    ["line"],
    ["json", { outputFile: resolve(results, "runner.json") }],
  ],
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 540, height: 360 },
    deviceScaleFactor: 1,
    actionTimeout: 30_000,
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--js-flags=--expose-gc",
        "--enable-precise-memory-info",
      ],
    },
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: {
    command: "node serve.mjs",
    cwd: folder,
    url: "http://127.0.0.1:4178/scripts/performance/fixtures/world-lab.html",
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
