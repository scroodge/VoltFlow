"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * How far ahead each heartbeat pushes the window. The PWA re-stamps well inside this, so
 * closing the app or backgrounding the tab lets it lapse within a few seconds and the car
 * falls back to its normal batched cadence on its next command poll.
 */
const LIVE_FAST_WINDOW_SECONDS = 20;

/**
 * Tell the car that someone is watching, so Mate switches to its fast (~3s) `live_only`
 * status cadence instead of the batched 15-60s delivery.
 *
 * This is a heartbeat, not a toggle: it is only ever extended, never cleared. An expiry
 * is what stops the fast cadence, so a crashed tab, a lost network, or a force-quit can
 * never strand a car in fast mode — the worst case is one window's worth of extra pushes.
 *
 * Writes the caller's own profile row under the existing `profiles_update_own` RLS policy;
 * no service-role client is involved.
 */
export async function requestLiveFastStatus(vehicleId: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const };

  const until = new Date(Date.now() + LIVE_FAST_WINDOW_SECONDS * 1000).toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ live_fast_until: until, live_fast_vehicle_id: vehicleId })
    .eq("id", user.id);

  // Best-effort by design: a failed heartbeat costs latency on the next status change,
  // never correctness, so it must not surface an error into the live view.
  if (error) return { ok: false as const };
  return { ok: true as const };
}
