import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Default BYDMate vehicle_id for local `/dev/*` mirrors and tests only.
 * Production routes must resolve per-user alias via `resolveChargingSessionVehicleId`
 * (`src/lib/charging-session-vehicle.ts`), never assume this value.
 */
export const DEV_WAY_VEHICLE_ID = "way";

/** VoltFlow account impersonated in local /dev/* mirrors. */
export const DEV_USER_EMAIL = "scroodgemac@gmail.com";

export type WayDevContext = {
  vehicleId: string;
  /** VoltFlow account that owns charging_sessions for this vehicle. */
  appUserId: string | null;
  /** cars.id rows with vehicle_alias matching vehicleId. */
  carIds: string[];
};

/**
 * Resolves the VoltFlow “way” car (vehicle_alias) for dev pages.
 * BYDMate rows may use a different user_id than the app account; sessions
 * must be loaded via car_id / app user, not live-snapshot user_id alone.
 */
async function resolveDevUserId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", DEV_USER_EMAIL)
    .maybeSingle();

  return (profile?.id as string | undefined) ?? null;
}

export async function resolveWayDevContext(
  supabase: SupabaseClient,
  vehicleId: string = DEV_WAY_VEHICLE_ID,
): Promise<WayDevContext> {
  const devUserId = await resolveDevUserId(supabase);

  const { data: cars } = await supabase
    .from("cars")
    .select("id, user_id, vehicle_alias")
    .eq("vehicle_alias", vehicleId);

  const matched = (cars ?? []).filter(
    (car) => !devUserId || car.user_id === devUserId,
  );

  if (matched.length > 0) {
    return {
      vehicleId,
      appUserId: (matched[0].user_id as string) ?? devUserId,
      carIds: matched.map((car) => car.id as string),
    };
  }

  if (devUserId) {
    return { vehicleId, appUserId: devUserId, carIds: [] };
  }

  const { data: liveRows } = await supabase
    .from("bydmate_live_snapshots")
    .select("user_id")
    .eq("vehicle_id", vehicleId)
    .order("received_at", { ascending: false })
    .limit(1);

  const fallbackUserId =
    (liveRows?.[0] as { user_id?: string } | undefined)?.user_id ?? null;

  return { vehicleId, appUserId: fallbackUserId, carIds: [] };
}

export type WaySessionFilter =
  | { kind: "car"; carIds: string[] }
  | { kind: "user"; userId: string }
  | null;

export function waySessionFilter(ctx: WayDevContext): WaySessionFilter {
  if (ctx.carIds.length > 0) return { kind: "car", carIds: ctx.carIds };
  if (ctx.appUserId) return { kind: "user", userId: ctx.appUserId };
  return null;
}
