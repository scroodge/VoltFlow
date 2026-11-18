import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const basePath = join(root, "src", rel);

    const candidates = [
      basePath,
      basePath + ".ts",
      basePath + ".tsx",
      basePath + ".mjs",
      basePath + ".js",
      join(basePath, "index.ts"),
      join(basePath, "index.tsx"),
      join(basePath, "index.js"),
    ];

    for (const cand of candidates) {
      if (existsSync(cand)) {
        return nextResolve(pathToFileURL(cand).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
