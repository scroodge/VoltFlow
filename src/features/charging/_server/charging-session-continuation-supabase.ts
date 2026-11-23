import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChargingSessionRow } from "@/types/database";
import {
  chargingContinuationBounds,
  planChargingContinuation,
  type ContinuationSample,
} from "./charging-session-continuation";
import { SESSION_WINDOW_PAD_MS } from "./charging-session-reconcile-logic";

export async function mergeChargingContinuations(
  supabase: SupabaseClient,
  userId: string,
  affectedSessionIds: readonly string[],
) {
  if (!affectedSessionIds.length) return;

  const sessions = () => supabase.from("charging_sessions").select("*").eq("user_id", userId);
  const { data: affected, error } = await sessions().in("id", [...new Set(affectedSessionIds)]);
  if (error) throw new Error(error.message);
  for (const changed of (affected ?? []) as ChargingSessionRow[]) {
    if (!changed.started_at || !changed.stopped_at) continue;
    const [car, previous, following] = await Promise.all([
      supabase.from("cars").select("vehicle_alias").eq("user_id", userId).eq("id", changed.car_id).maybeSingle(),
      sessions().eq("car_id", changed.car_id).lt("started_at", changed.started_at)
        .order("started_at", { ascending: false }).limit(1).maybeSingle(),
      sessions().eq("car_id", changed.car_id).gt("started_at", changed.started_at)
        .order("started_at").limit(1).maybeSingle(),
    ]);
    for (const result of [car, previous, following]) {
      if (result.error) throw new Error(result.error.message);
    }
    const vehicleId = car.data?.vehicle_alias;
    if (!vehicleId) continue;

    async function merge(first: ChargingSessionRow, next: ChargingSessionRow) {
      const bounds = chargingContinuationBounds(first, next);
      if (!bounds) return false;
      async function samples(fromMs: number, toMs: number) {
        // Partitioning a high-frequency poll at the PostgREST row limit could
        // hide a disconnect. Treat a saturated scan as insufficient evidence.
        const { data, error } = await supabase.from("bydmate_telemetry_samples")
          .select("device_time,telemetry,diplus_charge_gun_state")
          .eq("user_id", userId).eq("vehicle_id", vehicleId)
          .gte("device_time", new Date(fromMs).toISOString())
          .lte("device_time", new Date(toMs).toISOString())
          .order("device_time").limit(1000);
        if (error) throw new Error(error.message);
        return data?.length === 1000 ? [] : (data ?? []) as ContinuationSample[];
      }
      const [bridge, end] = await Promise.all([
        samples(bounds.firstStopMs - 90_000, bounds.nextStartMs),
        samples(Math.max(bounds.nextStartMs, bounds.nextStopMs - SESSION_WINDOW_PAD_MS), bounds.nextStopMs),
      ]);
      const patch = planChargingContinuation(first, next, bridge, end);
      if (!patch) return false;
      const { data, error } = await supabase.rpc("bydmate_merge_charging_continuation", {
        p_user_id: userId,
        p_car_id: first.car_id,
        p_first_id: first.id,
        p_next_id: next.id,
        p_first_updated_at: first.updated_at,
        p_next_updated_at: next.updated_at,
        p_patch: patch,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== "string") return false;
      Object.assign(first, patch, { updated_at: data });
      return true;
    }

    let first = changed;
    if (previous.data && await merge(previous.data as ChargingSessionRow, changed)) {
      first = previous.data as ChargingSessionRow;
    }
    if (following.data) await merge(first, following.data as ChargingSessionRow);
  }
}
