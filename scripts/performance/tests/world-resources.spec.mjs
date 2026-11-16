import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { validateSoak } from "../validate-soak.mjs";

const require = createRequire(import.meta.url);
const waitMs = Number(process.env.NEW0_RESOURCE_WAIT_MS || 1080000);
const output = process.env.NEW0_RESOURCE_RESULTS ?? resolve("results");
async function kernelValue(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}
async function limits() {
  const cpu = await kernelValue("/sys/fs/cgroup/cpu.max");
  const [quota, period] = (cpu ?? "").split(" ").map(Number);
  return {
    cpu_max: cpu,
    cpus: Number.isFinite(quota / period) ? quota / period : null,
    memory_max_bytes:
      Number(await kernelValue("/sys/fs/cgroup/memory.max")) || null,
    memory_swap_max_bytes: await kernelValue("/sys/fs/cgroup/memory.swap.max"),
    memory_events: await kernelValue("/sys/fs/cgroup/memory.events"),
  };
}

test("six complete input-driven World journeys keep warmed resources bounded", async ({
  page,
  browser,
}) => {
  await mkdir(output, { recursive: true });
  const constrained = await limits();
  expect(
    constrained.cpus,
    "The container must have a finite positive CPU limit",
  ).toBeGreaterThan(0);
  expect(
    constrained.cpus,
    "This test requires at most one CPU",
  ).toBeLessThanOrEqual(1);
  expect(
    constrained.memory_max_bytes,
    "The container must have a hard memory limit",
  ).toBeGreaterThan(0);
  expect(
    constrained.memory_max_bytes,
    "This test requires at most 1536 MiB",
  ).toBeLessThanOrEqual(1536 * 1024 * 1024);
  expect(
    constrained.memory_swap_max_bytes,
    "Swap must be disabled for a reproducible memory ceiling",
  ).toBe("0");
  const observations = {
    javascript_errors: [],
    console_errors: [],
    request_failures: [],
    cancelled_requests: [],
    http_errors: [],
    page_crashes: 0,
  };
  page.on("pageerror", (error) =>
    observations.javascript_errors.push(String(error)),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      observations.console_errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const entry = { url: request.url(), error: request.failure()?.errorText };
    // Chromium may report ERR_ABORTED for a consumed GLTF fetch stream. A
    // cancelled essential asset still rejects World.load and cannot reach soak.
    (entry.error === "net::ERR_ABORTED"
      ? observations.cancelled_requests
      : observations.request_failures
    ).push(entry);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      observations.http_errors.push({
        url: response.url(),
        status: response.status(),
      });
  });
  let rejectCrash;
  const crashed = new Promise((_, reject) => {
    rejectCrash = reject;
  });
  page.once("crash", () => {
    observations.page_crashes++;
    rejectCrash(new Error("Chromium page crashed"));
  });
  const samples = [];
  const started = Date.now();
  const sample = async () => {
    const value = Number(await kernelValue("/sys/fs/cgroup/memory.current"));
    if (Number.isFinite(value))
      samples.push({ elapsed_ms: Date.now() - started, bytes: value });
  };
  await sample();
  const timer = setInterval(() => {
    void sample();
  }, 500);
  let report, failure, progressTimer;
  try {
    await page.goto("/scripts/performance/fixtures/world-lab.html", {
      waitUntil: "load",
    });
    await expect(page.locator("#soak")).toBeEnabled({ timeout: 90_000 });
    await page.locator("#speed").selectOption("fast");
    await page.locator("#soak").click();
    progressTimer = setInterval(async () => {
      try {
        console.log(
          "[resource-soak] " +
            (await page.locator("#status").textContent({ timeout: 1000 })),
        );
      } catch {
        /* The primary wait records a closed/crashed page. */
      }
    }, 10_000);
    await Promise.race([
      page
        .locator("#report.open")
        .waitFor({ state: "visible", timeout: waitMs }),
      crashed,
    ]);
    report = JSON.parse(await page.locator("#report").textContent());
  } catch (error) {
    failure = error;
    if (!page.isClosed()) {
      try {
        report = JSON.parse(await page.locator("#report").textContent());
      } catch {
        /* The crash and missing report are recorded as failures. */
      }
    }
  } finally {
    clearInterval(progressTimer);
    clearInterval(timer);
    await sample();
    const environment = {
      resource_check_only: true,
      physical_iphone_benchmark: false,
      expected_renderer: "SwiftShader software renderer",
      viewport: { width: 540, height: 360 },
      wait_timeout_ms: waitMs,
      playwright_version: require("@playwright/test/package.json").version,
      browser_version: browser.version(),
      node_version: process.version,
      image:
        "mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f",
      container_limits: constrained,
      memory_peak_bytes:
        Number(await kernelValue("/sys/fs/cgroup/memory.peak")) || null,
      memory_events_after: await kernelValue("/sys/fs/cgroup/memory.events"),
      elapsed_wall_seconds: (Date.now() - started) / 1000,
      failure: failure ? String(failure) : null,
    };
    if (report) {
      report.runner_environment = environment;
      report.page_observations = observations;
      await writeFile(
        resolve(output, "world-resources.json"),
        JSON.stringify(report, null, 2),
      );
    }
    await writeFile(
      resolve(output, "container-resources.json"),
      JSON.stringify({ environment, samples, observations }, null, 2),
    );
    if (!page.isClosed()) {
      try {
        await page.screenshot({
          path: resolve(output, "completed-soak.jpg"),
          type: "jpeg",
          quality: 75,
        });
      } catch {
        /* Already recorded. */
      }
    }
  }
  if (failure) throw failure;
  expect(
    report.renderer,
    "The constrained run must use the declared software renderer",
  ).toMatch(/swiftshader/i);
  expect(report.viewport).toEqual({ width: 540, height: 360 });
  expect(report.flags.simulation_step).toBe("fast");
  expect(report.fast_simulation_seconds_per_render).toBe(12);
  expect(observations.page_crashes).toBe(0);
  expect(
    report.runner_environment.memory_events_after ?? "",
    "The cgroup recorded an out-of-memory event",
  ).not.toMatch(/^oom(?:_kill)?[ \t]+[1-9]\d*$/m);
  const validation = validateSoak(report);
  await writeFile(
    resolve(output, "validation.json"),
    JSON.stringify(validation, null, 2),
  );
  console.log(
    JSON.stringify({
      resource_check_only: true,
      completed_journeys: validation.runs,
      series: validation.series,
      failures: validation.failures,
    }),
  );
  expect(validation.failures).toEqual([]);
});
