#!/usr/bin/env node
/**
 * Run charging session reconcile for one user (service role).
 *
 *   node --env-file=.env.local scripts/reconcile-user-sessions.mjs --user <uuid> [--vehicle <alias>]
 */
import { createClient } from "@supabase/supabase-js";
import {
  buildReconciledSessionPatch,
  sessionNeedsReconcile,
  summarizeSessionTelemetry,
} from "../src/lib/charging-session-reconcile-logic.ts";

const userIdx = process.argv.indexOf("--user");
const vehicleIdx = process.argv.indexOf("--vehicle");
const userId = userIdx >= 0 ? process.argv[userIdx + 1] : null;
const vehicleFilter = vehicleIdx >= 0 ? process.argv[vehicleIdx + 1] : undefined;

if (!userId) {
  console.error("Usage: --user <uuid> [--vehicle <alias>]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);
const nowMs = Date.now();
const since = new Date(nowMs - 14 * 86_400_000).toISOString();

let carsQuery = supabase.from("cars").select("*").eq("user_id", userId);
if (vehicleFilter) carsQuery = carsQuery.eq("vehicle_alias", vehicleFilter);
const { data: cars, error: carsError } = await carsQuery;
if (carsError) {
  console.error(carsError.message);
  process.exit(1);
}

const carList = cars ?? [];
const carIds = carList.map((c) => c.id);
if (!carIds.length) {
  console.error("No cars found");
  process.exit(1);
}

const { data: sessions, error: sessionsError } = await supabase
  .from("charging_sessions")
  .select("*")
  .eq("user_id", userId)
  .in("car_id", carIds)
  .gte("started_at", since)
  .neq("status", "charging");

if (sessionsError) {
  console.error(sessionsError.message);
  process.exit(1);
}

const carsById = new Map(carList.map((c) => [c.id, c]));
const reconciledIds = [];

for (const session of sessions ?? []) {
  const car = carsById.get(session.car_id);
  const vehicleId = car?.vehicle_alias?.trim();
  if (!vehicleId || !sessionNeedsReconcile(session, nowMs)) continue;

  const startMs = Date.parse(session.started_at);
  const from = new Date(startMs - 5 * 60_000).toISOString();
  const stoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : NaN;
  const endMs =
    Number.isFinite(stoppedMs) && stoppedMs >= startMs ? stoppedMs + 5 * 60_000 : nowMs + 60_000;
  const to = new Date(endMs).toISOString();

  const PAGE = 1000;
  const samples = [];
  let sampleLoadFailed = false;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error: sampleErr } = await supabase
      .from("bydmate_telemetry_samples")
      .select("device_time, telemetry")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .gte("device_time", from)
      .lte("device_time", to)
      .order("device_time", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (sampleErr) {
      console.error(session.id, sampleErr.message);
      sampleLoadFailed = true;
      break;
    }
    samples.push(...(data ?? []));
    if (!data?.length || data.length < PAGE) break;
  }
  if (sampleLoadFailed) continue;

  const summary = summarizeSessionTelemetry(samples ?? [], session);
  const patch = buildReconciledSessionPatch({
    session,
    summary,
    liveSoc: null,
    nowMs,
  });
  if (!patch) continue;

  const { error: updateErr } = await supabase
    .from("charging_sessions")
    .update(patch)
    .eq("id", session.id)
    .eq("user_id", userId);

  if (updateErr) {
    console.error(session.id, updateErr.message);
    continue;
  }
  reconciledIds.push(session.id);
}

console.log("reconciled:", reconciledIds.length, reconciledIds);

const { data: jun1 } = await supabase
  .from("charging_sessions")
  .select("id, started_at, current_percent, charged_energy_kwh, estimated_cost, status")
  .eq("user_id", userId)
  .gte("started_at", "2026-06-01T00:00:00Z")
  .lt("started_at", "2026-06-02T00:00:00Z")
  .order("started_at");

console.log("\n2026-06-01 sessions:");
for (const s of jun1 ?? []) {
  console.log(
    s.started_at?.slice(0, 19),
    s.status,
    `${s.current_percent}%`,
    `${Number(s.charged_energy_kwh).toFixed(2)} kWh`,
    `${Number(s.estimated_cost).toFixed(2)} BYN`,
    s.id.slice(0, 8),
  );
}
