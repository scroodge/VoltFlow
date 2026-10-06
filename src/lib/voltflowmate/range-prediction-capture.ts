import type { SupabaseClient } from "@supabase/supabase-js";

import { dedupeTripsBySource } from "./hero-drive-metrics.ts";
import { estimateRangeFromSoc } from "./range-estimate.ts";
import type { VoltflowMateTripRow } from "@/types/database";

type EndCaptureSession = {
  user_id: string;
  car_id: string;
  battery_capacity_kwh: number | null;
  current_percent: number;
  end_range_soc: number | null;
  end_delta_soc: number | null;
  end_voltflow_est_km: number | null;
};

type EndCaptureCar = {
  vehicle_alias: string | null;
  range_reserve_soc_percent: number | null;
};

const SESSION_SELECT =
  "user_id,car_id,battery_capacity_kwh,current_percent,end_range_soc,end_delta_soc,end_voltflow_est_km";

/**
 * The SOC the end-of-charge predictions are anchored to. Prefer the SOC the car's own
 * estimate was reported at (from the capture RPC), so both predictions grade against
 * the same anchor; fall back to the session row, which can be stale by design.
 */
export function resolveEndAnchorSoc(
  session: Pick<EndCaptureSession, "end_range_soc" | "end_delta_soc" | "current_percent">,
): number | null {
  for (const value of [session.end_range_soc, session.end_delta_soc, session.current_percent]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Freeze Voltflow's own end-of-charge range model into `charging_sessions`
 * (`end_voltflow_est_km`), so a later discharge cycle can grade it like the car's
 * promise (`end_range_est_km`, captured in SQL by the same close hook).
 *
 * Deliberately runs in TypeScript after the `bydmate_capture_session_end_delta` RPC:
 * the estimator lives here and re-implementing it in SQL would drift. Trips are read
 * like the live display does (latest deduped drive) so the stored number matches what
 * the user's "Math Range" was built from.
 *
 * Never throws: a capture failure must not block session close.
 */
export async function captureSessionEndVoltflowEstimate(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  try {
    const { data: sessionRow, error: sessionError } = await supabase
      .from("charging_sessions")
      .select(SESSION_SELECT)
      .eq("id", sessionId)
      .maybeSingle<EndCaptureSession>();

    if (sessionError || !sessionRow || sessionRow.end_voltflow_est_km != null) return;

    const soc = resolveEndAnchorSoc(sessionRow);
    if (soc == null) return;

    const { data: car } = await supabase
      .from("cars")
      .select("vehicle_alias,range_reserve_soc_percent")
      .eq("id", sessionRow.car_id)
      .maybeSingle<EndCaptureCar>();

    let tripsQuery = supabase
      .from("bydmate_trips")
      .select("*")
      .eq("user_id", sessionRow.user_id)
      .order("started_at", { ascending: false })
      .limit(2);
    if (car?.vehicle_alias) tripsQuery = tripsQuery.eq("vehicle_id", car.vehicle_alias);

    const { data: tripRows } = await tripsQuery;
    const recentTrips = dedupeTripsBySource(
      (tripRows ?? []) as VoltflowMateTripRow[],
    ).slice(0, 1);

    const estimate = estimateRangeFromSoc({
      soc,
      batteryCapacityKwh: sessionRow.battery_capacity_kwh,
      recentTrips,
      reserveSocPercent: car?.range_reserve_soc_percent ?? null,
    });
    if (estimate.estimatedRangeKm == null) return;

    const { error: updateError } = await supabase
      .from("charging_sessions")
      .update({ end_voltflow_est_km: Math.round(estimate.estimatedRangeKm * 10) / 10 })
      .eq("id", sessionId);

    if (updateError) {
      console.error("capture end voltflow estimate:", sessionId, updateError.message);
    }
  } catch (error) {
    console.error("capture end voltflow estimate:", sessionId, error);
  }
}
