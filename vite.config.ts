import { defineConfig, loadEnv } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";

function content(path: string) {
  // Git checkouts on Windows and Linux can use different text line endings.
  // Their runtime content is identical, so the diagnostic revision is canonical.
  return /\.(?:ts|js|json|css|html|md|txt|glsl|vert|frag|svg)$/i.test(path)
    ? Buffer.from(readFileSync(path, "utf8").replace(/\r\n/g, "\n"))
    : readFileSync(path);
}

function digestDirectory(
  hash: ReturnType<typeof createHash>,
  directory: string,
) {
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile())
    .map((file) => {
      const absolute = resolve(file.parentPath, file.name);
      return {
        absolute,
        path: relative(directory, absolute).replaceAll("\\", "/"),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of files)
    hash.update(file.path).update("\0").update(content(file.absolute));
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const hash = createHash("sha256");
  digestDirectory(hash, "public/assets");
  const assetRevision = hash.digest("hex").slice(0, 16);
  const clientHash = createHash("sha256")
    .update(assetRevision)
    .update(content("index.html"));
  digestDirectory(clientHash, "src");
  return {
    define: {
      __ASSET_REVISION__: JSON.stringify(assetRevision),
      __CLIENT_REVISION__: JSON.stringify(
        clientHash.digest("hex").slice(0, 16),
      ),
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
