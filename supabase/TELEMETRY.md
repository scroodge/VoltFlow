# VoltFlow Mate telemetry

This document describes the public data model for telemetry received from a compatible
VoltFlow Mate installation. The wire contract is in
[VoltFlow Mate API](VOLTFLOW_MATE_API.md).

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

`X-Vehicle-Id` is the canonical vehicle identity for a request. The server scopes the request
to the account authenticated by its paired key and normalizes queued samples to that header;
clients should still send their configured vehicle alias consistently. See
[VoltFlow Mate API](VOLTFLOW_MATE_API.md) for the precise wire contract.

Compatible Mate clients may include cumulative hourly rollup blocks in an object batch. A
sample already represented in one of those blocks is marked `client_hourly: true`, so the
server does not aggregate that sample into the hour a second time. The companion hourly
blocks belong to the vehicle identified by the request header and are applied separately
from sample ingest; a rollup-processing problem does not change the sample acknowledgement.
See [VoltFlow Mate API](VOLTFLOW_MATE_API.md) for the batch fields and block shape.

## Delivery behavior

The current Mate client adapts collection to vehicle state:

| State | Collection cadence | Typical delivery |
| --- | --- | --- |
| Driving | 1 second | small batches about every 15 seconds |
| Charging below 98% | 10 seconds | bulk batches about every 60 seconds |
| Charging tail at or above 98% | 1 second | small batches about every 15 seconds |
| Parked | 30 seconds | status updates about every 60 seconds |

The client supports offline delivery, optional GPS omission, and state-specific payload
tiers.

When someone is actively watching a vehicle in VoltFlow, the command-poll response may grant a
short `live_fast_seconds` window. During that window, compatible app and car-off daemon senders
can submit `live_only: true` status snapshots about every three seconds. A `live_only` sample
updates the latest snapshot but intentionally skips durable sample, hourly-rollup, and trip
writes. The grant expires without a client-side “off” request, so normal batched delivery resumes
automatically when the view is no longer active.

## Storage model

### `bydmate_live_snapshots`

One latest row per authenticated user and vehicle. This is the source for live dashboard
cards and authenticated realtime updates.

Important fields include normalized telemetry, latest location when available, selected
vehicle metadata, and timestamps for device and receipt time. When no newer sample arrives for
24 hours, exact GPS is removed from the snapshot and its diagnostic payload; live state remains.

### `bydmate_telemetry_samples`

Append-only normalized telemetry history. It supports vehicle charts, charging history,
and trip details. Free accounts retain raw samples and tracks for 30 days; Premium/Admin data,
including original route points and hourly aggregates, remains indefinitely while the account is
active.

### `bydmate_telemetry_hourly`

Compact hourly aggregates for longer-range analytics. They are derived from individual
samples for standard clients, or from cumulative client-provided hourly blocks for
compatible Mate clients. The latter replaces an hour only with an equal-or-larger cumulative
sample count, so delayed retries cannot replace a more complete aggregate with an older one.

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
- The latest snapshot is intended for realtime display; stale exact GPS is cleared after 24 h.
- Free historical views are bounded; Premium/Admin historical telemetry and exact tracks are
  retained indefinitely while the account is active.
