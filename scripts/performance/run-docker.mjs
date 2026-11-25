// Build and run only this named test image/container. No Compose service changes.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const capture = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const suite =
  process.argv.find((arg) => arg.startsWith("--suite="))?.slice(8) ?? "all";
if (!["all", "world", "portrait"].includes(suite)) {
  throw new Error("Expected --suite=world, --suite=portrait or --suite=all");
}
// The six-run resource benchmark keeps its original deadline. Rendering full
// portrait routes in software has a separate budget from measuring resources.
const suiteMinutes = { world: 20.5, portrait: 30, all: 50.5 };
const suiteTimeout = suiteMinutes[suite] * 60_000;
const id = (
  process.env.NEW0_RESOURCE_RUN_ID ?? `local-${Date.now()}-${process.pid}`
).replace(/[^a-zA-Z0-9_-]/g, "_");
const container = `new0-resources-${id}`;
const image = "new0-browser-resources:pw-1.64.1";
const results = resolve(root, "scripts/performance/results", id);
await mkdir(results, { recursive: true });
async function docker(args, timeoutMs, filename) {
  const log = createWriteStream(resolve(results, filename), { flags: "a" });
  return await new Promise((done, reject) => {
    const child = spawn("docker", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      child.kill();
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        process.stdout.write(chunk);
        log.write(chunk);
      });
    child.on("error", (error) => {
      clearTimeout(timeout);
      log.end();
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      log.end();
      done(expired ? 124 : (code ?? 1));
    });
  });
}
let code = 1,
  created = false;
try {
  if (!process.argv.includes("--skip-build")) {
    const build = await docker(
      ["build", "-f", "scripts/performance/Dockerfile", "-t", image, "."],
      8 * 60_000,
      "build.log",
    );
    if (build) throw new Error(`Image build exited ${build}`);
  }
  const made = await docker(
    [
      "create",
      "--name",
      container,
      "--label",
      `io.new0.resource-check=${id}`,
      "--init",
      "--network",
      "none",
      "--cpus",
      suite === "portrait" ? "2" : "1",
      "--memory",
      "1536m",
      "--memory-swap",
      "1536m",
      "--shm-size",
      "512m",
      "--pids-limit",
      "256",
      ...(process.env.NEW0_RESOURCE_WAIT_MS
        ? [
            "--env",
            `NEW0_RESOURCE_WAIT_MS=${process.env.NEW0_RESOURCE_WAIT_MS}`,
          ]
        : []),
      image,
      "npm",
      "test",
      "--",
      ...(suite === "all" ? [] : ["--project", suite]),
      "--global-timeout",
      String(suiteTimeout),
    ],
    30_000,
    "container.log",
  );
  if (made) throw new Error(`Test container creation exited ${made}`);
  created = true;
  code = await docker(
    ["start", "--attach", container],
    suiteTimeout + 30_000,
    "container.log",
  );
  if (code === 124) await capture("docker", ["stop", "--time", "5", container]);
} catch (error) {
  code = 1;
  await writeFile(resolve(results, "wrapper-error.txt"), String(error));
  console.error(error);
} finally {
  if (created) {
    try {
      const { stdout } = await capture("docker", [
        "inspect",
        "--format",
        "{{json .State}}",
        container,
      ]);
      await writeFile(resolve(results, "container-state.json"), stdout);
      const { stdout: limits } = await capture("docker", [
        "inspect",
        "--format",
        '{"nano_cpus":{{.HostConfig.NanoCpus}},"memory":{{.HostConfig.Memory}},"memory_swap":{{.HostConfig.MemorySwap}},"shm_size":{{.HostConfig.ShmSize}},"pids_limit":{{.HostConfig.PidsLimit}}}',
        container,
      ]);
      await writeFile(resolve(results, "docker-limits.json"), limits);
      await capture("docker", ["cp", `${container}:/results/.`, results]);
    } catch (error) {
      code = 1;
      console.error(
        "Could not collect complete resource evidence:",
        String(error),
      );
    }
    try {
      await capture("docker", ["rm", "--force", container]);
    } catch (error) {
      code = 1;
      console.error(
        "Could not remove the named test container:",
        String(error),
      );
    }
  }
  await writeFile(
    resolve(root, "scripts/performance/results/latest-run.json"),
    JSON.stringify({ id, directory: results, exit_code: code }, null, 2),
  );
}
console.log(
  JSON.stringify({
    resource_check_only: suite !== "portrait",
    suite,
    container,
    results,
    exit_code: code,
  }),
);
process.exitCode = code;
