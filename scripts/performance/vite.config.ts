import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import application from "../../vite.config.ts";

const project = fileURLToPath(new URL("../../", import.meta.url));
const fixture = resolve(project, "scripts/performance/fixtures/world-lab.html");
export default defineConfig((env) => {
  const base = application(env);
  const revision = createHash("sha256");
  for (const file of [fixture, fixture.replace(/\.html$/, ".ts")])
    revision.update(readFileSync(file));
  return {
    ...base,
    root: project,
    publicDir: resolve(project, "public"),
    define: {
      ...base.define,
      __RESOURCE_FIXTURE_REVISION__: JSON.stringify(
        revision.digest("hex").slice(0, 16),
      ),
    },
    build: {
      ...base.build,
      outDir: resolve(project, "scripts/performance/.build"),
      emptyOutDir: true,
      rolldownOptions: { input: fixture },
    },
  };
});
