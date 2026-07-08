import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildReconciledSessionPatch,
  buildSilenceClosePatch,
  RECONCILE_LOOKBACK_DAYS,
  sessionNeedsReconcile,
  summarizeSessionTelemetry,
  type TelemetrySampleRow,
} from "@/lib/charging-session-reconcile-logic";
import { isFreshLiveSnapshot, snapshotSoc } from "@/lib/charging-live";
import type { BydmateLiveSnapshotRow, Car, ChargingSessionRow } from "@/types/database";

export type ChargingSessionReconcileResult = {
  reconciled: number;
  sessionIds: string[];
};

export {
  buildReconciledSessionPatch,
  sessionNeedsReconcile,
  summarizeSessionTelemetry,
} from "@/lib/charging-session-reconcile-logic";

const TELEMETRY_PAGE_SIZE = 1000;
/** Matches the telemetry-loading pad below — a live snapshot outside this is from a
 *  later, unrelated charge, not evidence for this session. */
const SESSION_WINDOW_PAD_MS = 5 * 60_000;

/**
 * Live SOC is only trustworthy for a *closed* session's repair patch when it was captured
 * near that session's own timeframe. Without this, the car's *current* SOC (fresh relative
 * to now, unrelated to this session) bled into a closed session on every later app open,
 * ratcheting its current_percent up through an entirely separate subsequent charge (car
 * `way`, 2026-07-06: a stopped DC session absorbed the following AC session's SOC gain).
 */
function liveSocWithinSessionWindow(
  session: ChargingSessionRow,
  liveRow: BydmateLiveSnapshotRow | null,
): number | null {
  if (!liveRow || !session.started_at) return null;
  const receivedMs = Date.parse(liveRow.received_at);
  const startMs = Date.parse(session.started_at);
  if (!Number.isFinite(receivedMs) || !Number.isFinite(startMs)) return null;
  const stoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : NaN;
  const endMs = Number.isFinite(stoppedMs) ? stoppedMs + SESSION_WINDOW_PAD_MS : receivedMs;
  if (receivedMs < startMs || receivedMs > endMs) return null;
  return snapshotSoc(liveRow);
}

async function loadSessionTelemetry(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
  session: ChargingSessionRow,
  nowMs: number,
) {
  const startMs = Date.parse(session.started_at!);
  const from = new Date(startMs - 5 * 60_000).toISOString();
  const stoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : NaN;
  const endMs =
    Number.isFinite(stoppedMs) && stoppedMs >= startMs ? stoppedMs + 5 * 60_000 : nowMs + 60_000;
  const to = new Date(endMs).toISOString();

  const rows: TelemetrySampleRow[] = [];
  for (let offset = 0; ; offset += TELEMETRY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("bydmate_telemetry_samples")
      .select("device_time, telemetry")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .gte("device_time", from)
      .lte("device_time", to)
      .order("device_time", { ascending: true })
      .range(offset, offset + TELEMETRY_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as TelemetrySampleRow[];
    rows.push(...page);
    if (page.length < TELEMETRY_PAGE_SIZE) break;
  }
  return rows;
}

async function reconcileOneSession({
  supabase,
  userId,
  car,
  session,
  nowMs,
}: {
  supabase: SupabaseClient;
  userId: string;
  car: Car;
  session: ChargingSessionRow;
  nowMs: number;
}): Promise<string | null> {
  const vehicleId = car.vehicle_alias?.trim();
  if (!vehicleId) return null;
  // Open sessions take the silence-close path (auto-stop never got its unplug samples);
  // closed sessions take the normal value-repair path.
  const isOpen = session.status === "charging";
  if (!isOpen && !sessionNeedsReconcile(session, nowMs)) return null;

  const [samples, liveResult] = await Promise.all([
    loadSessionTelemetry(supabase, userId, vehicleId, session, nowMs),
    supabase
      .from("bydmate_live_snapshots")
      .select("received_at, telemetry, vehicle_id")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .maybeSingle(),
  ]);

  const summary = summarizeSessionTelemetry(samples, session);
  const liveRow = liveResult.data as BydmateLiveSnapshotRow | null;
  const liveSocFresh = liveRow != null && isFreshLiveSnapshot(liveRow, nowMs);
  const liveSoc = liveSocFresh ? snapshotSoc(liveRow) : null;

  const patch = isOpen
    ? buildSilenceClosePatch({
        session,
        summary,
        lastSampleMs:
          samples.length > 0 ? Date.parse(samples[samples.length - 1]!.device_time) : null,
        liveSocFresh,
        liveSoc,
        nowMs,
      })
    : buildReconciledSessionPatch({
        session,
        summary,
        liveSoc: liveSocWithinSessionWindow(session, liveRow),
        nowMs,
      });
  if (!patch) return null;

  const { error } = await supabase
    .from("charging_sessions")
    .update(patch)
    .eq("id", session.id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
  return session.id;
}

export async function reconcileChargingSessionsForUser({
  supabase,
  userId,
  vehicleIds,
  nowMs = Date.now(),
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleIds?: string[];
  nowMs?: number;
}): Promise<ChargingSessionReconcileResult> {
  const since = new Date(nowMs - RECONCILE_LOOKBACK_DAYS * 86_400_000).toISOString();

  let carsQuery = supabase.from("cars").select("*").eq("user_id", userId);
  if (vehicleIds?.length) {
    carsQuery = carsQuery.in("vehicle_alias", vehicleIds);
  }
  const { data: cars, error: carsError } = await carsQuery;
  if (carsError) throw new Error(carsError.message);

  const carList = (cars ?? []) as Car[];
  if (!carList.length) return { reconciled: 0, sessionIds: [] };

  const carIds = carList.map((car) => car.id);
  const { data: sessions, error: sessionsError } = await supabase
    .from("charging_sessions")
    .select("*")
    .eq("user_id", userId)
    .in("car_id", carIds)
    .gte("started_at", since);

  if (sessionsError) throw new Error(sessionsError.message);

  const carsById = new Map(carList.map((car) => [car.id, car]));
  const sessionIds: string[] = [];

  for (const session of (sessions ?? []) as ChargingSessionRow[]) {
    const car = carsById.get(session.car_id);
    if (!car?.vehicle_alias) continue;
    try {
      const id = await reconcileOneSession({ supabase, userId, car, session, nowMs });
      if (id) sessionIds.push(id);
    } catch (err) {
      console.error("charging session reconcile:", session.id, err);
    }
  }

  return { reconciled: sessionIds.length, sessionIds };
}
