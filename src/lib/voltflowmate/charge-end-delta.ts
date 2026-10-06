import type { SupabaseClient } from "@supabase/supabase-js";

import { captureSessionEndVoltflowEstimate } from "./range-prediction-capture.ts";

/**
 * Freeze the session's end-of-charge readings into `charging_sessions`:
 * the cell delta (Postgres) and both range promises — the car's `end_range_est_km`
 * (derived in the same RPC) and Voltflow's own `end_voltflow_est_km` (TS side).
 *
 * Runs at session close because raw telemetry samples are pruned (30 d free /
 * 365 d premium) — the history cannot be recomputed later, and the range promises
 * are the inputs the next discharge cycle is graded against.
 *
 * Never throws: these are diagnostics, and a session must still close correctly
 * if the capture fails or the migration has not been applied yet.
 */
export async function captureSessionEndDelta(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await supabase.rpc("bydmate_capture_session_end_delta", {
    p_session_id: sessionId,
  });

  if (error) {
    console.error("capture session end delta:", sessionId, error.message);
  }

  await captureSessionEndVoltflowEstimate(supabase, sessionId);
}
