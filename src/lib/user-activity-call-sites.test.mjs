import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("authenticated web and device entrypoints stamp user activity", async () => {
  const paths = [
    "src/app/api/bydmate/telemetry/route.ts",
    "src/app/api/bydmate/trip-summaries/route.ts",
    "src/app/api/telegram/auth/route.ts",
    "src/app/api/telegram/link/route.ts",
    "src/app/auth/callback/route.ts",
    "src/components/auth/login-form.tsx",
    "src/app/auth/confirm/page.tsx",
  ];

  for (const path of paths) {
    assert.match(await source(path), /(stampUserActivity|touchUserActivity)\(/, path);
  }
});

test("the separately deployed Telegram service stamps auth and link activity", async () => {
  const python = await source("scripts/telegram-miniapp-server.py");
  assert.equal(python.match(/supabase_touch_user_activity\(/g)?.length, 3);
  assert.match(python, /last_active_at\.is\.null,last_active_at\.lt\./);
});

test("new profile creation initializes last_active_at without backfilling existing rows", async () => {
  const migration = await source(
    "supabase/migrations/20260827144430_initialize_profile_activity.sql",
  );
  assert.match(migration, /insert into public\.profiles \(id, email, last_active_at\)/i);
  assert.doesNotMatch(migration, /update\s+public\.profiles/i);
});
