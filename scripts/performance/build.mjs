import { fileURLToPath } from "node:url";
import { build } from "vite";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
await build({ configFile: "scripts/performance/vite.config.ts" });
