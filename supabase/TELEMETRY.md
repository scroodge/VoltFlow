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

### Third-party webhook telemetry senders (experimental)

`POST /api/bydmate/webhook-telemetry/[token]` accepts a single flat JSON object from an
external app's own "send telemetry to my server" feature — currently AndyShaman/BYDMate's
Settings → "Webhook — telemetry" (a separate app from VoltFlow Mate). Unlike the Mate
contract above, these senders carry no vehicle id, no `X-API-Key`/`X-Vehicle-Id` headers,
and no batching; identity comes entirely from an opaque per-(user, vehicle) token embedded
in the URL, minted with `scripts/mint-bydmate-webhook-token.mjs` and stored hashed in
`bydmate_webhook_tokens` (never plaintext). The route maps the third-party fields into the
normalized `telemetry`/`location` shape (`src/lib/voltflowmate/bydmate-webhook-mapper.ts`)
and writes through the same `bydmate_ingest_telemetry` RPC as the Mate path, tagged
`source: "bydmate-app-webhook"` — but deliberately skips auto-charging-session detection,
notifications, Telegram widgets, rollups, and trip inference for this source; it is a live
snapshot + history writer only. `charge_power_kw` is recomputed as `abs(voltage × current)`
rather than trusting the sender's own signed `power` field, which mixes motor and battery
power outside charging. See BACKLOG.md for the full field-mapping rationale.

## Ingest

The authenticated telemetry endpoint accepts one sample or a batch. Each sample contains:

- `schema_version`, `vehicle_id`, `device_time`, and `source`;
- required `telemetry` and `location` objects;
- optional `diplus`, `autoservice`, and `mate_version` metadata.

## Telemetry cadence monitoring

The server runs `bydmate_detect_telemetry_cadence_collapses()` every ten minutes. It
writes app-owned operational audit rows to
`bydmate_telemetry_cadence_alarm_audits`; these rows are not a user-facing telemetry
data model and are not exposed through client RLS.

- `low_24h_count` opens when an otherwise recently-contacted vehicle has fewer than
  500 accepted samples in the trailing 24 hours. It resolves after the count reaches
  500 again. This is the sustained sender-offline signal.
- `moving_gap` records an in-motion gap larger than eight seconds between consecutive
  moving samples. It is diagnostic-only: it is retained for operations but never
  sends an owner notification.
- The detector skips a vehicle that has already been completely stale for 24 hours;
  it does not manufacture a new episode from an old disconnected snapshot.

For a newly-opened `low_24h_count`, delivery is eligible only when the same profile
already has a linked `profiles.telegram_id`. The owner receives one plain-language
Telegram notice with the vehicle name, last contact, sample count, affected features
(live status, remote commands, automatic charging updates), and on-device checks.
No linked Telegram account means no enqueue, message, or retry. A Telegram send failure
is retryable; a recovered sender followed by another outage opens a new eligible notice.
The notice never includes the owner's email or account ID.

`profiles.telegram_id` is existing **user-owned** account-link data in Postgres. The
cadence audit and delivery fields are **app-owned** operational data in Postgres. No
new preference, client storage, or telemetry table is created for this feature.

> **Release status (2026-10-07):** the database migration is applied to production and
> the application route is committed, but the route still needs a scoped Vercel
> deployment. Until that deployment completes, this policy is enforced at enqueue time,
> while the previously deployed route remains the delivery handler.

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

**Offline buffer grant.** The car queues samples locally while it has no internet and uploads
them on reconnect. Until a server response carries `offline_buffer_cap_bytes`, the client keeps
a legacy 1000-row guard that silently deletes the oldest rows, so a long outage loses data.
The telemetry success response and every command-poll response therefore carry
`offline_buffer_cap_bytes` (4 GiB, `src/lib/voltflowmate/offline-buffer.ts`); the client clamps
it to its device storage limit and persists it. While remote commands are disabled the poll is
served by the static `public/bydmate-commands-disabled.json` (a `next.config.ts` rewrite — the
route handler never runs), so that file carries the same literal value; a test keeps the two in
sync. Never remove the field: a car that stops
receiving it falls back to the 1000-row guard only if its persisted grant is lost.

When someone is actively watching a vehicle in VoltFlow, the command-poll response may grant a
short `live_fast_seconds` window. During that window, compatible app and car-off daemon senders
can submit `live_only: true` status snapshots about every three seconds. A `live_only` sample
updates the latest snapshot but intentionally skips durable sample, hourly-rollup, and trip
writes. The grant expires without a client-side “off” request, so normal batched delivery resumes
automatically when the view is no longer active.

Telegram-widget eligibility (`profiles.telegram_id`) is carried by the existing API-key profile
lookup into ingest fan-out, so a `live_only` status ping does not add a second profile query just
to establish that no Telegram chat is linked. Linked chats retain the normal widget throttle.

The server treats a batch as snapshot-only only when every sample explicitly sets `live_only: true`
and it carries no client hourly or trip rollup. Such a batch skips persisted-snapshot verification,
charging/session and notification fan-out, and rollup application; ordinary samples remain the
authority for history, charging sessions, trips, and notifications. Its inactivity timestamp is
refreshed at most hourly. Telegram widget edits retain their 30-second throttle, and a throttled
edit does not load car metadata or construct widget HTML.

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
