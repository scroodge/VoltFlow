# VoltFlow Mate telemetry

This document describes the public data model for telemetry received from a compatible
VoltFlow Mate installation. The wire contract is in
[BYDMATE_APK_API.md](BYDMATE_APK_API.md).

## Data sources

VoltFlow Mate may provide live vehicle telemetry, location data when the user enables it,
and completed-trip summaries from supported vehicle data sources. Availability depends on
the vehicle, firmware, permissions, and configured integration.

Completed-trip summaries are a fallback for trip history. They do not provide live state,
charging state, remote commands, or route tracks.

## Ingest

The authenticated telemetry endpoint accepts one sample or a batch. Each sample contains:

- `schema_version`, `vehicle_id`, `device_time`, and `source`;
- required `telemetry` and `location` objects;
- optional `diplus`, `autoservice`, and `mate_version` metadata.

The server validates the authenticated vehicle identity, normalizes accepted values,
sanitizes location data, and processes retries idempotently. A client retains queued data
until it receives a complete application-level acknowledgement.

## Delivery behavior

The current Mate client adapts collection to vehicle state:

| State | Collection cadence | Typical delivery |
| --- | --- | --- |
| Driving | 1 second | small batches at short intervals |
| Charging below 98% | 10 seconds | bulk batches |
| Charging tail at or above 98% | 1 second | small batches at short intervals |
| Parked | 30 seconds | periodic status updates |

The client supports offline delivery, optional GPS omission, and state-specific payload
tiers. Exact device configuration is intentionally not part of this public document.

## Storage model

### `bydmate_live_snapshots`

One latest row per authenticated user and vehicle. This is the source for live dashboard
cards and authenticated realtime updates.

Important fields include normalized telemetry, latest location when available, selected
vehicle metadata, and timestamps for device and receipt time.

### `bydmate_telemetry_samples`

Append-only normalized telemetry history. It supports vehicle charts, charging history,
and trip details. Retention follows the account entitlement.

### `bydmate_telemetry_hourly`

Compact hourly aggregates for longer-range analytics.

### Trips and tracks

The ingest flow creates or extends trips from valid movement telemetry. Optional track
points are sanitized before storage. Trip summaries from a fallback source are upserted
separately to avoid duplicate trips.

## Charging integrity

Charging state is determined from charging-specific fields, not traction power. Automatic
session detection and reconciliation are documented in
[../docs/CHARGING_SESSIONS.md](../docs/CHARGING_SESSIONS.md).

## Privacy and security

- Vehicle data is scoped to the authenticated user through Row Level Security.
- GPS can be omitted by the user; invalid or low-quality locations are rejected.
- Credentials are used only by trusted server or paired-client paths and must never be
  published in source control.
- The latest snapshot is intended for realtime display; historical views use bounded and
  entitlement-aware data.
