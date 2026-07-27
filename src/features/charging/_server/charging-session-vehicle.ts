import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves BYDMate vehicle_id for a charging session chart/API call.
 * Never defaults to a global alias like "way" — returns null when unknown so
 * callers can query all telemetry for the user in the session time window.
 */
export async function resolveChargingSessionVehicleId({
  supabase,
  userId,
  sessionId,
  queryVehicleId,
}: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  queryVehicleId?: string | null;
}): Promise<string | null> {
  const explicit = queryVehicleId?.trim();
  if (explicit) return explicit;

  const { data: session, error: sessionError } = await supabase
    .from("charging_sessions")
    .select("car_id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (sessionError) throw sessionError;

  const carId = session?.car_id as string | undefined;
  if (carId) {
    const { data: car, error: carError } = await supabase
      .from("cars")
      .select("vehicle_alias")
      .eq("id", carId)
      .eq("user_id", userId)
      .maybeSingle();
    if (carError) throw carError;

    const alias = (car?.vehicle_alias as string | null | undefined)?.trim();
    if (alias) return alias;
  }

  const { data: liveRows, error: liveError } = await supabase
    .from("bydmate_live_snapshots")
    .select("vehicle_id")
    .eq("user_id", userId)
    .order("received_at", { ascending: false })
    .limit(1);
  if (liveError) throw liveError;

  const liveVehicleId =
    (liveRows?.[0] as { vehicle_id?: string } | undefined)?.vehicle_id?.trim() ?? "";
  return liveVehicleId || null;
}
