/**
 * Fast live-status grants — the signal that tells a car someone has the live view open,
 * so Mate switches to its ~3s `live_only` cadence instead of the batched 15-60s delivery.
 *
 * Shared by the command poll and the telemetry ingest route. Both already load the
 * caller's profile row for auth, so emitting a grant costs neither of them a query.
 *
 * Carrying it on *both* channels is what lets the command poll slow down: the poll used
 * to be the only carrier, which pinned it at ~6s per car purely to keep live-view entry
 * latency low. See `docs/archive/EGRESS_CPU_MASTER_PLAN.md`.
 */

/**
 * Seconds of fast cadence granted per response. Deliberately longer than the carrier's
 * own interval so a single dropped response does not drop the car out of fast mode
 * mid-view, and short enough that closing the app stops the traffic promptly.
 */
export const LIVE_FAST_GRANT_SECONDS = 20;

export type LiveFastProfile = {
  liveFastUntil: string | null;
  liveFastVehicleId: string | null;
};

/**
 * How much longer (if at all) this vehicle should keep pushing `live_only` status at the
 * fast cadence. Derived from the profile row the caller already fetched.
 */
export function liveFastSecondsFor(
  profile: LiveFastProfile,
  vehicleId: string,
): number {
  if (!profile.liveFastUntil) return 0;
  // A multi-car account watching car A must not speed up car B. A null vehicle id means
  // the window was set before we knew which car, so honour it rather than dropping it.
  if (profile.liveFastVehicleId && profile.liveFastVehicleId !== vehicleId) return 0;
  const remainingMs = new Date(profile.liveFastUntil).getTime() - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.min(LIVE_FAST_GRANT_SECONDS, Math.ceil(remainingMs / 1000));
}
