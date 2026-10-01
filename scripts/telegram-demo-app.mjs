#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
}));
const apiUrl = new URL(status.API_URL);
const dbUrl = new URL(status.DB_URL);
if (
  apiUrl.hostname !== "127.0.0.1" || apiUrl.port !== "55321" ||
  dbUrl.hostname !== "127.0.0.1" || dbUrl.port !== "55322" ||
  !status.ANON_KEY || !status.SERVICE_ROLE_KEY
) {
  throw new Error("Refusing to start: local demo Supabase is not available");
}

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3037",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:3037",
  BYDMATE_TELEMETRY_ENDPOINT_URL: "http://127.0.0.1:3037/api/bydmate/telemetry",
  // The knowledge module constructs its SDK at import time. A dummy key keeps
  // unrelated pages loadable; any accidental SDK call is confined to loopback.
  OPENAI_API_KEY: "sk-local-demo-disabled",
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  VOLTFLOW_TELEGRAM_DEMO_LOCAL: "1",
  REMOTE_COMMANDS_ENABLED: "false",
  ALLOW_DEBUG_DASHBOARD: "false",
};
for (const key of [
  "BYDMATE_API_KEY_PEPPER", "BYDMATE_LINK_CODE_PEPPER", "BYDMATE_WEBHOOK_TOKEN_PEPPER",
  "CRON_SECRET", "GITHUB_TOKEN", "RESEND_API_KEY",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_WEB_APP_URL",
  "NEXT_PUBLIC_TELEGRAM_API_BASE_URL", "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
]) env[key] = "";

console.log("Starting VoltFlow against local demo Supabase only (127.0.0.1:3037).");
const app = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3037"], {
  cwd: root,
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => app.kill(signal));
}
app.on("exit", (code) => process.exit(code ?? 1));
