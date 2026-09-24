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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The uid header, or null when absent or not a UUID (treated like an older APK). */
export function parseVehicleUid(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  return value && UUID_RE.test(value) ? value.toLowerCase() : null;
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
