#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");
const migrationNamePattern = /^(\d{14})_.+\.sql$/;

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("-")) ?? "help";
const flags = new Map();

for (const arg of args) {
  if (!arg.startsWith("-")) continue;
  const normalized = arg.replace(/^--/, "");
  const [key, value] = normalized.split("=", 2);
  flags.set(key, value ?? true);
}

function usage() {
  console.log(`Usage:
  npm run db:migrations -- status [--target=local|linked] [--db-url=...]
  npm run db:migrations -- plan [--target=local|linked] [--db-url=...]
  npm run db:migrations -- up [--target=local|linked] [--version=YYYYMMDDHHMMSS] [--yes]
  npm run db:migrations -- down [--target=local|linked] [--last=1] [--yes]
  npm run db:migrations -- status --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD

Notes:
  - up applies exactly the next pending migration.
  - version must be the next pending migration unless --allow-gap is set.
  - linked/db-url commands intentionally keep Supabase CLI prompts unless --yes is passed.`);
}

function loadDotEnvFile(file) {
  const path = join(root, file);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function envValue(name) {
  loadDotEnvFile(".env.local");
  loadDotEnvFile(".env");
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function dbUrlFromPooler() {
  const passwordEnv = flags.get("password-env");
  if (!passwordEnv || passwordEnv === true) {
    throw new Error("--db-url-from-pooler requires --password-env=NAME.");
  }

  const poolerPath = join(root, "supabase", ".temp", "pooler-url");
  if (!existsSync(poolerPath)) {
    throw new Error(`Missing Supabase pooler URL file: ${poolerPath}`);
  }

  const url = new URL(readFileSync(poolerPath, "utf8").trim());
  url.password = envValue(String(passwordEnv));
  return url.toString();
}

function readLocalMigrations() {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Missing migrations directory: ${migrationsDir}`);
  }

  const migrations = readdirSync(migrationsDir)
    .filter((file) => migrationNamePattern.test(file))
    .sort()
    .map((file) => ({
      file,
      version: file.match(migrationNamePattern)[1],
      path: join(migrationsDir, file),
    }));

  const byVersion = new Map();
  for (const migration of migrations) {
    const siblings = byVersion.get(migration.version) ?? [];
    siblings.push(migration.file);
    byVersion.set(migration.version, siblings);
  }
  const duplicates = [...byVersion.entries()].filter(([, files]) => files.length > 1);
  if (duplicates.length > 0) {
    const detail = duplicates
      .map(([version, files]) => `${version}: ${files.join(", ")}`)
      .join("; ");
    throw new Error(`Duplicate migration versions: ${detail}`);
  }

  return migrations;
}

function targetArgs() {
  const target = String(flags.get("target") ?? "local");
  const dbUrl = flags.has("db-url-from-pooler") ? dbUrlFromPooler() : flags.get("db-url");

  if (dbUrl && target !== "local" && target !== "linked") {
    throw new Error("--db-url can be combined only with --target=local or --target=linked defaults.");
  }
  if (dbUrl) return ["--db-url", String(dbUrl)];
  if (target === "local") return ["--local"];
  if (target === "linked") return ["--linked"];
  throw new Error(`Unknown target: ${target}`);
}

function runSupabase(cliArgs, options = {}) {
  const result = spawnSync("supabase", cliArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(detail || `supabase ${cliArgs.join(" ")} failed with exit code ${result.status}`);
  }

  return result.stdout;
}

function parseMigrationList(output) {
  const applied = new Set();

  for (const line of output.split(/\r?\n/)) {
    if (!/\d{14}/.test(line)) continue;
    const columns = line.split(/[│|]/);
    if (columns.length >= 2) {
      const remote = columns[1].match(/\d{14}/)?.[0];
      if (remote) applied.add(remote);
      continue;
    }

    const versions = [...line.matchAll(/\d{14}/g)].map((match) => match[0]);
    if (versions.length >= 2) applied.add(versions[1]);
  }

  return applied;
}

function migrationList() {
  return runSupabase(["migration", "list", ...targetArgs()]);
}

function appliedVersions() {
  return parseMigrationList(migrationList());
}

function pendingMigrations() {
  const local = readLocalMigrations();
  const applied = appliedVersions();
  return local.filter((migration) => !applied.has(migration.version));
}

function printPlan() {
  const pending = pendingMigrations();
  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  console.log("Next pending migration:");
  console.log(`  ${pending[0].file}`);
  if (pending.length > 1) {
    console.log(`Remaining after that: ${pending.length - 1}`);
  }
}

function createTempWorkdir(targetMigration) {
  const tempRoot = mkdtempSync(join(tmpdir(), "evac-supabase-one-"));
  const tempSupabase = join(tempRoot, "supabase");
  const tempMigrations = join(tempSupabase, "migrations");
  mkdirSync(tempMigrations, { recursive: true });

  const configPath = join(root, "supabase", "config.toml");
  if (existsSync(configPath)) {
    cpSync(configPath, join(tempSupabase, "config.toml"));
  } else {
    writeFileSync(join(tempSupabase, "config.toml"), "# Generated temporary config for one-at-a-time migrations.\n");
  }

  for (const migration of readLocalMigrations()) {
    if (migration.version > targetMigration.version) break;
    cpSync(migration.path, join(tempMigrations, migration.file));
  }

  return tempRoot;
}

function applyOne() {
  const pending = pendingMigrations();
  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  const requestedVersion = flags.get("version");
  const selected = requestedVersion
    ? pending.find((migration) => migration.version === String(requestedVersion))
    : pending[0];

  if (!selected) {
    throw new Error(`Requested migration is not pending: ${requestedVersion}`);
  }
  if (selected.version !== pending[0].version && !flags.has("allow-gap")) {
    throw new Error(`Refusing to skip pending migration ${pending[0].file}. Use --allow-gap only if you know the history is already repaired.`);
  }

  const tempRoot = createTempWorkdir(selected);
  const cliArgs = ["migration", "up", "--workdir", tempRoot, ...targetArgs()];
  if (flags.has("yes")) cliArgs.push("--yes");

  console.log(`Applying one migration: ${selected.file}`);
  try {
    runSupabase(cliArgs, { stdio: "inherit" });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function rollbackOne() {
  const last = Number(flags.get("last") ?? 1);
  if (!Number.isInteger(last) || last < 1) {
    throw new Error("--last must be a positive integer.");
  }

  const cliArgs = ["migration", "down", "--last", String(last), ...targetArgs()];
  if (flags.has("yes")) cliArgs.push("--yes");
  runSupabase(cliArgs, { stdio: "inherit" });
}

try {
  if (command === "help" || flags.has("help")) {
    usage();
  } else if (command === "status") {
    process.stdout.write(migrationList());
  } else if (command === "plan") {
    printPlan();
  } else if (command === "up") {
    applyOne();
  } else if (command === "down") {
    rollbackOne();
  } else if (command === "files") {
    for (const migration of readLocalMigrations()) console.log(`${migration.version} ${basename(migration.path)}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
