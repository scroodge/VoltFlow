/**
 * Offline buffer grant — tells the car how much of its own storage it may spend queueing
 * telemetry while it has no internet.
 *
 * Mate keeps every sample in a local Room queue and uploads it when connectivity returns.
 * Until a server response carries `offline_buffer_cap_bytes`, the client falls back to a
 * legacy 1000-row guard (BYDMate `OfflineBufferPolicy.DEFAULT_MAX_ROWS`) that silently
 * deletes the oldest rows — about 17 minutes of driving or ~3 hours of charging. A
 * 20-hour offline weekend therefore lost both charging sessions (2026-10-03/04).
 *
 * The client persists the grant, so an offline car keeps using the last value it received.
 * It still clamps the grant to its own device limit
 * (`min(4 GiB, max(256 MiB, allocatable − max(5 GiB, 10% of storage)))`), so this value is a
 * ceiling, not a reservation. It matches the client's `MAX_CAP_BYTES`; asking for more is
 * pointless because the client coerces it down.
 *
 * Shared by the telemetry ingest response and the command poll — the same two carriers as
 * `live_fast_seconds`, so a car learns the grant on its first successful contact either way.
 */
export const OFFLINE_BUFFER_CAP_BYTES = 4 * 1024 * 1024 * 1024;

/** Response field shared by both carriers. Spread into the JSON body. */
export function offlineBufferGrantField(): {
  offline_buffer_cap_bytes: number;
} {
  return { offline_buffer_cap_bytes: OFFLINE_BUFFER_CAP_BYTES };
}
