#!/usr/bin/env node
/**
 * Run `npm run build` after source changes settle (default 90s idle).
 * Usage: node scripts/debounced-build.mjs
 * Env: DEBOUNCE_MS — idle delay before build (default 90000)
 */

import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEBOUNCE_MS = Number(process.env.DEBOUNCE_MS ?? 90_000);

const IGNORE = /(?:^|\/)(?:\.next|node_modules|\.git)(?:\/|$)/;

/** @type {NodeJS.Timeout | null} */
let timer = null;
let building = false;
let pending = false;

function log(message) {
  console.log(`[debounced-build] ${message}`);
}

function shouldIgnore(filePath) {
  return IGNORE.test(filePath);
}

function scheduleBuild(reason) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runBuild();
  }, DEBOUNCE_MS);
  log(`${reason} — build in ${DEBOUNCE_MS / 1000}s if no further changes`);
}

function runBuild() {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  pending = false;
  log("running npm run build…");
  const child = spawn("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => {
    building = false;
    log(code === 0 ? "build succeeded" : `build failed (exit ${code})`);
    if (pending) scheduleBuild("queued while building");
  });
}

function attachWatcher(target, recursive) {
  if (!existsSync(target)) return;
  watch(target, { recursive }, (_event, name) => {
    const rel = name ? path.join(path.relative(root, target) || ".", name) : path.relative(root, target);
    const full = path.join(root, rel);
    if (shouldIgnore(full)) return;
    scheduleBuild(`change: ${rel}`);
  });
  log(`watching ${path.relative(root, target)}${recursive ? " (recursive)" : ""}`);
}

attachWatcher(path.join(root, "src"), true);

for (const file of [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
]) {
  attachWatcher(path.join(root, file), false);
}

log(`idle debounce ${DEBOUNCE_MS / 1000}s — save files to trigger a build`);
