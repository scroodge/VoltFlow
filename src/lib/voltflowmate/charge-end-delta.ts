import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Freeze the session's end-of-charge cell delta into `charging_sessions`.
 *
 * Runs at session close because raw telemetry samples are pruned (30 d free /
 * 365 d premium) — the historical trend cannot be recomputed later. The whole
 * computation stays in Postgres (`bydmate_capture_session_end_delta`); nothing
 * is transferred to the app.
 *
 * Never throws: the delta is a diagnostic, and a session must still close
 * correctly if the capture fails or the migration has not been applied yet.
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
}
