#!/usr/bin/env node

/**
 * Start a disposable local Supabase from a copy of the checked-in migrations.
 * The copy supplies one legacy column that exists in production but is missing
 * from migration history. Nothing here connects to a remote project.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "supabase");
const workdir = mkdtempSync(join(tmpdir(), "voltflow-telegram-demo-"));
const target = join(workdir, "supabase");
const migrations = join(target, "migrations");
const network = "voltflow-telegram-demo-local";

mkdirSync(migrations, { recursive: true });
copyFileSync(join(source, "config.toml"), join(target, "config.toml"));
for (const name of readdirSync(join(source, "migrations"))) {
  if (name.endsWith(".sql")) {
    // Self-hosted production has no migration-history table. The local CLI
    // does, and these two existing files share the same timestamp.
    const localName = name === "20260917140000_premium_payments_and_admin_audit_log.sql"
      ? "20260917140001_premium_payments_and_admin_audit_log.sql"
      : name;
    copyFileSync(join(source, "migrations", name), join(migrations, localName));
  }
}

writeFileSync(
  join(migrations, "20260917125959_local_only_profiles_timezone.sql"),
  [
    "-- Local demo only: the production profile has a legacy timezone column,",
    "-- but the repository migration chain does not create it before the grant.",
    "alter table public.profiles add column if not exists timezone text;",
    "",
  ].join("\n"),
);

const inspect = spawnSync("docker", ["network", "inspect", network], { stdio: "ignore" });
if (inspect.status !== 0) {
  const created = spawnSync(
    "docker",
    [
      "network", "create", "-o",
      "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
      network,
    ],
    { stdio: "inherit" },
  );
  if (created.status !== 0) process.exit(created.status ?? 1);
}

console.log(`Disposable Supabase migration copy: ${workdir}`);
const started = spawnSync("supabase", ["start", "--network-id", network], {
  cwd: workdir,
  encoding: "utf8",
});
if (started.status !== 0) {
  // The CLI prints local keys on success. Show only migration errors on failure.
  console.error((started.stderr ?? "").slice(-5000));
  console.error((started.stdout ?? "").slice(-3000));
} else {
  console.log("Local demo Supabase started on 127.0.0.1:55321 (DB 55322).");
}
process.exit(started.status ?? 1);
