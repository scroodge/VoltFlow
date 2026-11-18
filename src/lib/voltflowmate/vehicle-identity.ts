/**
 * B-03: the vehicle_id a Mate request is stored under.
 *
 * `X-Vehicle-Id` is the name the owner typed into the APK, and every bydmate_* table keys on
 * it, so a rename used to mint a new vehicle. APKs from B-03 on also send `X-Vehicle-Uid`, a
 * random per-install id; `bydmate_resolve_vehicle_key` binds it to the key the car's history
 * already lives under and returns that key for every later request, whatever the name.
 *
 * Without a uid (every older APK in the field) this is the header value, with no query —
 * byte-for-byte the pre-B-03 behaviour. See migration 20260924120000.
 */

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Normalize a vehicle identifier reported by VoltFlow Mate (e.g. "byd_123456").
 * Ensures it is safe to use as a path component or cache key.
 */
export function parseVehicleUid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 64) return null;
  if (!/^[a-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

export async function resolveVehicleKey(
  supabase: RpcClient,
  userId: string,
  headerVehicleId: string,
  rawVehicleUid: string | null | undefined,
): Promise<string> {
  const vehicleUid = parseVehicleUid(rawVehicleUid);
  if (!vehicleUid) return headerVehicleId;

  const { data, error } = await supabase.rpc("bydmate_resolve_vehicle_key", {
    p_user_id: userId,
    p_vehicle_uid: vehicleUid,
    p_name: headerVehicleId,
  });
  if (error || typeof data !== "string" || !data.trim()) {
    // Falling back to the name is exactly the pre-B-03 behaviour: data keeps flowing and a
    // rename at worst splits history as it always did. Logged, because it hides B-03.
    console.error(
      "bydmate_resolve_vehicle_key failed; storing under X-Vehicle-Id",
      {
        userId,
        vehicleUid,
        error,
      },
    );
    return headerVehicleId;
  }
  return data;
}
