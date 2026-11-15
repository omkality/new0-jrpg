import { defineConfig, loadEnv } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const hash = createHash("sha256");
  for (const file of readdirSync("public/assets", {
    recursive: true,
    withFileTypes: true,
  })
    .filter((f) => f.isFile())
    .sort((a, b) =>
      (a.parentPath + "/" + a.name).localeCompare(b.parentPath + "/" + b.name),
    )) {
    hash
      .update(file.name)
      .update(readFileSync(resolve(file.parentPath, file.name)));
  }
  return {
    define: {
      __ASSET_REVISION__: JSON.stringify(hash.digest("hex").slice(0, 16)),
    },
    server: {
      host: env.DEV_HOST || "127.0.0.1",
      port: Number(env.DEV_PORT || 5173),
      proxy: {
        "/api":
          env.DEV_API_TARGET || `http://127.0.0.1:${env.API_PORT || 8000}`,
      },
    },
    build: { target: "es2022", chunkSizeWarningLimit: 750 },
  };
});
