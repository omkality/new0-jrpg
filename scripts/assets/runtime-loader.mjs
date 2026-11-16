import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import ts from "../../node_modules/typescript/lib/typescript.js";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
globalThis.__ASSET_REVISION__ = "node-audit";
globalThis.__CLIENT_REVISION__ = "node-audit";
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith(".") || specifier.startsWith("/")) &&
        context.parentURL
      ) {
        const u = new URL(specifier + ".ts", context.parentURL);
        if (existsSync(u)) return next(u.href, context);
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            resolveJsonModule: true,
          },
        }).outputText,
      };
    return next(url, context);
  },
});
await import("./validate-actor-runtime.mjs");
