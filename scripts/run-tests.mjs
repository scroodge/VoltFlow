#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function discoverTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discoverTests(path);
    return entry.isFile() && entry.name.endsWith(".test.mjs")
      ? [relative(root, path)]
      : [];
  });
}

const files = discoverTests(join(root, "src")).sort();
if (!files.length) {
  console.error("No .test.mjs files found under src/.");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--list") {
  console.log(files.join("\n"));
} else {
  console.log(`Running ${files.length} test files.`);
  const result = spawnSync(process.execPath, [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    "--test",
    ...args,
    ...files,
  ], { cwd: root, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  if (result.signal) console.error(`Test runner terminated by ${result.signal}.`);
  process.exit(result.status ?? 1);
}
