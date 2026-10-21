# VoltFlow Mate integration contract

This public contract describes the VoltFlow endpoints used by a paired VoltFlow Mate
client. Use placeholders in examples; do not publish a real endpoint, credential, or
vehicle identifier.

## Telemetry endpoint

```http
POST https://<host>/api/bydmate/telemetry
Content-Type: application/json
X-API-Key: <paired-client-key>
X-Vehicle-Id: <vehicle-id>
X-Vehicle-Uid: <vehicle-uid>
X-App: VoltFlow-Mate
```

`X-Vehicle-Id` selects the vehicle stream for the authenticated paired key. It is canonical for
the request: the server normalizes queued samples to this value so an item queued before a user
changes the client setting remains retryable. Clients should nevertheless send the configured
vehicle alias in both places and preserve it when retrying.

`X-Vehicle-Uid` (optional, sent by modern APKs from B-03 on) provides a stable hardware install
identity (UUID). On first contact the server binds this UID to the current vehicle alias in
`bydmate_vehicle_identity`. If the owner renames the vehicle in the APK, subsequent telemetry
continues to resolve and store data under the bound canonical key instead of fracturing vehicle history.

`X-App` identifies the client application (`VoltFlow-Mate`).

## Pairing

A signed-in user creates a short-lived pairing code in VoltFlow Settings. The client
redeems it once and stores the returned endpoint and paired-client key.

```http
POST https://<host>/api/bydmate/link-code/redeem
Content-Type: application/json

{ "code": "123456", "client": "dashboard", "app_version": "0.2.0", "version_code": 6 }
```

`client` is optional and identifies which app is pairing: `"dashboard"` for the VoltFlow
Dashboard head unit, anything else (including omitting the field) for Mate. Each client
kind holds its **own** key in `bydmate_devices`, so pairing one never revokes the other —
before that table existed a profile had a single key column, and the second app to redeem
silently evicted the first. Re-pairing the same kind replaces only that kind's key.

`app_version` and `version_code` are optional and describe the build being paired. They
are stored on the device row and shown in VoltFlow Settings; they are display values, never
an authorization input, and a malformed value is dropped rather than stored. Because
re-pairing replaces the row, omitting them clears whatever was recorded before.

Successful responses contain a client key and telemetry endpoint. Pairing codes are
single-use and expire quickly. Client keys must be kept only in the paired client’s secure
configuration and never committed or shared.

## Sample format

One sample:

```json
{
  "schema_version": 1,
  "vehicle_id": "vehicle-example",
  "device_time": "2026-01-01T12:00:00Z",
  "source": "BYDMate",
  "telemetry": { "soc": 50 },
  "location": {}
}
```

A batch wraps samples in an object:

```json
{
  "samples": [
    {
      "schema_version": 1,
      "vehicle_id": "vehicle-example",
      "device_time": "2026-01-01T12:00:00Z",
      "source": "BYDMate",
      "telemetry": { "soc": 50 },
      "location": {}
    }
  ]
}
```

### Client-side hourly rollups

Current Mate clients may attach up to 24 cumulative hourly aggregate blocks to an object
batch. A sample that has already been included in one of these blocks sets
`client_hourly: true`; the server still ingests the sample but skips its normal per-sample
hourly aggregation to avoid double counting. Older clients can omit both fields and retain
the existing server-side aggregation behavior.

Each block belongs to the vehicle in `X-Vehicle-Id` (it does not contain its own
`vehicle_id`) and has this shape:

```json
{
  "hour_start": "2026-01-01T12:00:00Z",
  "sample_count": 60,
  "soc_min": 50,
  "soc_max": 52,
  "soc_last": 52,
  "speed_max": 80,
  "power_avg": 12.4,
  "battery_temp_avg": 25.1,
  "cabin_temp_avg": 21.5,
  "outside_temp_avg": 4.2,
  "power_sample_count": 60,
  "battery_temp_sample_count": 60,
  "cabin_temp_sample_count": 60,
  "outside_temp_sample_count": 60,
  "regen_kwh_sum": 0.3,
  "traction_kwh_sum": 2.1
}
```

`hour_start` and `sample_count` are required. The remaining aggregate values are optional
and may be `null` when no contributing sample has that measurement. `hourly` is optional;
when present it is an array of these blocks alongside `samples`.

### Client-side trip rollups

Modern Mate APKs also attach cumulative trip blocks in the `trips` array of an object batch.
When a sample belongs to a client-owned drive, it sets `client_trip: true` and includes `trip_id: "<uuid>"`.
The server applies the cumulative block via `bydmate_apply_client_trip`, skipping server-side
trip heuristics:

```json
{
  "trip_id": "b3f02b37-2384-4861-a589-3bc87e5b1234",
  "started_at": "2026-01-01T12:00:00Z",
  "last_device_time": "2026-01-01T12:25:00Z",
  "ended_at": "2026-01-01T12:25:00Z",
  "sample_count": 120,
  "distance_km": 14.2,
  "soc_start": 80,
  "soc_end": 76,
  "max_speed_kmh": 85,
  "avg_speed_kmh": 34.1,
  "avg_consumption_kwh_100km": 15.3,
  "regen_energy_kwh": 0.4,
  "traction_energy_kwh": 2.5
}
```

`ended_at` is set once the trip is closed locally (gear P or power off); while open it is omitted or `null`.

### Required fields

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | number | Current public schema version is `1`. |
| `vehicle_id` | string | The paired vehicle identifier. |
| `device_time` | ISO-8601 string | Timestamp created by the client. |
| `source` | string | `BYDMate` for compatibility. |
| `telemetry` | object | Required normalized vehicle metrics; partial payloads are valid. |
| `location` | object | Required; `{}` is valid when location is unavailable or omitted. |

### Optional fields

| Field | Type | Notes |
| --- | --- | --- |
| `diplus` | object or null | Extended vehicle data when available. |
| `autoservice` | object | Optional vehicle metadata when available. |
| `mate_version` | string | Client version metadata (`BuildConfig.VERSION_NAME`). |
| `client_hourly` | boolean | Marks a sample as represented by a companion hourly block in the same object batch. |
| `client_trip` | boolean | Marks a sample as belonging to an APK-owned trip block in `trips`. |
| `trip_id` | string (UUID) | Unique trip identifier matching the client trip block. |
| `live_only` | boolean | Status-only snapshot. When true, the server updates the latest live snapshot but skips durable telemetry, hourly-rollup, and trip writes. |

### Normalized `telemetry` metrics

The `telemetry` object contains core vehicle metrics:
- Standard: `soc` (%), `speed_kmh`, `power_kw`, `battery_temp_c`, `cabin_temp_c`, `outside_temp_c`, `odometer_km`, `soh_percent`.
- Battery & Cells: `battery_voltage_v`, `aux_voltage_v` (12V battery), `cell_voltage_min_v`, `cell_voltage_max_v`, `cell_delta_v`.
- Charging: `is_charging` (boolean), `charge_power_kw` (positive kW), `charge_current_a` (signed pack current in Amps, negative during charge), `charge_type` (`AC`/`DC`), `kwh_charged`.
- Source scales: `soc_source` (`"diplus"` for BMS 0.1% resolution, `"autoservice"` for whole-percent display SOC).
- Trip & Range: `range_est_km`, `current_trip_distance_km`, `current_trip_consumption_kwh_100km`.

Unknown forward-compatible fields are ignored. Numeric values may be represented as JSON
numbers or numeric strings. Batches are limited to 300 samples.

The legacy Supabase Edge Function URL is a compatibility proxy to the canonical
Next.js endpoint above. It must not implement a second ingest path: sanitization,
idempotency verification, notifications, Telegram widgets, automatic charging
sessions, rollups, and reconciliation all belong to `/api/bydmate/telemetry`.
Deployments may override the proxy target with `VOLTFLOW_CANONICAL_TELEMETRY_URL`;
otherwise it uses `NEXT_PUBLIC_SITE_URL` (defaulting to `https://voltflow.life`).

## Acknowledgement and retries

An HTTP success alone does not permit a client to discard queued samples. The client must
receive an application response equivalent to:

```json
{
  "ok": true,
  "inserted_count": 1,
  "duplicate_count": 0,
  "skipped_stale_count": 0,
  "hourly_rollup_applied": 0,
  "trip_rollup_applied": 0,
  "live_fast_seconds": 20,
  "offline_buffer_cap_bytes": 4294967296,
  "battery_capacity_kwh": 45.1
}
```

The acknowledged inserted and duplicate count must cover every submitted sample, and
`skipped_stale_count` must be zero. Network failures and server errors remain retryable;
the client preserves the original `vehicle_id` for every queued sample.

`live_fast_seconds` grants the car a temporary fast-status transmission window (e.g. while an owner has the web app open).
`offline_buffer_cap_bytes` informs the client of its allocated storage quota for offline telemetry queue retention (default 4 GiB).
`battery_capacity_kwh` provides the vehicle profile capacity (from `cars.battery_capacity_kwh`) so the on-car AI Range agrees with cloud calculations.

Automatic charging processing is part of application acknowledgement. If it fails after
telemetry persistence, the endpoint returns HTTP `503` with `ok: false` and `retryable: true`.
Keep and retry the complete batch; telemetry duplicates are safe, and pending charging work
is committed through a versioned transaction. Snapshot-only requests skip charging processing.

`hourly_rollup_applied` and `trip_rollup_applied` are informational and are not part of sample acknowledgement
accounting.

## Command poll and acknowledgement

Compatible Mate clients may poll for abstract commands and acknowledge their outcome with the
same paired identity. The client must still enforce vehicle-safety constraints locally.

```http
GET https://<host>/api/bydmate/commands
X-API-Key: <paired-client-key>
X-Vehicle-Id: <vehicle-id>
```

The response contains `commands` (at most 10 pending commands), `commands_enabled`, and always
includes `live_fast_seconds` and `poll_after_seconds`. A positive `live_fast_seconds` value grants
that vehicle a short, expiring fast-status window;
the client may send `live_only: true` snapshots at its compatible fast cadence while it lasts.
`0` means normal delivery cadence. This signal is not a command and must never be persisted as a
user preference by the client.

`commands_enabled` reports whether remote command delivery is active. When it is `false`, a client
may suspend its fast command loop and fall back to a slow floor poll. It MUST keep polling at that
floor so it learns when command delivery is enabled again. `poll_after_seconds` is the server's
requested delay before that next poll; clients may clamp it to their supported range.

`battery_capacity_kwh` is the vehicle's car-profile capacity (`cars.battery_capacity_kwh`, the row
whose `vehicle_alias` matches, else the account's only unaliased car), sent only when it resolves to
a plausible 10–200 kWh. The APK uses it for the on-car AI Range so the car and the web agree; it is
omitted, not null, when unknown, and older clients ignore it.
The same field rides the telemetry ingest response, which is the carrier that actually reaches
cars while remote commands are suspended: `next.config.ts` then rewrites this poll to a static
JSON file and the route never runs.

`offline_buffer_cap_bytes` informs the client of its allowed on-device storage quota for
offline telemetry queue retention (default 4 GiB).

```json
{
  "ok": true,
  "commands": [
    { "id": "command-id", "type": "lock", "params": {}, "created_at": "2026-01-01T12:00:00Z" }
  ],
  "commands_enabled": true,
  "live_fast_seconds": 20,
  "poll_after_seconds": 6,
  "offline_buffer_cap_bytes": 4294967296,
  "battery_capacity_kwh": 45.1
}
```

```http
POST https://<host>/api/bydmate/commands/ack
Content-Type: application/json
X-API-Key: <paired-client-key>
X-Vehicle-Id: <vehicle-id>
```

```json
{
  "acks": [
    { "id": "command-id", "status": "done", "result": {} }
  ]
}
```

An acknowledgement status is one of `done`, `failed`, or `rejected`. The command lifecycle is
`pending` → `sent` → one of those terminal states; unacknowledged pending commands can expire as
`failed`.

## Completed-trip summaries

When supported by the paired vehicle, a client may submit completed-trip summaries:

```http
POST https://<host>/api/bydmate/trip-summaries
X-API-Key: <paired-client-key>
X-Vehicle-Id: <vehicle-id>
```

This optional path provides completed trip history only. It must not be used alongside an
equivalent live telemetry source for the same drive.

## Reported client build

The Dashboard sends its build on the session request, and the server records it on the
device row so VoltFlow Settings can show which APK the head unit is running.

```http
GET https://<host>/api/bydmate/dashboard/session
X-API-Key: <paired-client-key>
X-Dashboard-Version: 0.2.0
X-Dashboard-Version-Code: 6
```

Both headers are optional; a value that is not a dotted number or a positive integer is
ignored. The server writes only when the reported build differs from the stored one. That
is deliberate and load-bearing: authentication is the ~6 s command-poll hot path shared
with Mate, and `bydmate_devices` has no `last_seen_at` for exactly that reason. Do not
extend this into a heartbeat.

Mate does not use these headers — it already reports `mate_version` through telemetry.

## Cluster layout backup

The VoltFlow Dashboard keeps its cluster layout in device storage with no export path, so a
wipe or a replacement head unit loses it. This endpoint is that backup. It is not a sync
channel: one dashboard device exists per account (`bydmate_devices_user_kind_unique`), and
the cluster never pulls without the driver asking.

```http
GET https://<host>/api/bydmate/dashboard/layout
X-API-Key: <paired-client-key>
```

```json
{ "ok": true, "layout": { "version": 1, "widgets": [] }, "layout_version": 1, "updated_at": "2026-08-16T12:00:00.000Z" }
```

An account that has never backed up returns `ok: true` with `layout`, `layout_version`, and
`updated_at` all `null`. That is a normal state, not an error.

```http
PUT https://<host>/api/bydmate/dashboard/layout
X-API-Key: <paired-client-key>
Content-Type: application/json

{ "layout": { "version": 1, "widgets": [] }, "layout_version": 1 }
```

```json
{ "ok": true, "updated_at": "2026-08-16T12:00:00.000Z" }
```

`layout` is stored verbatim as `jsonb` and is never interpreted server-side — the schema
belongs to the client's `DashboardLayoutConfig`. `layout_version` is that config's version
stamp, kept as a column so a client can refuse to restore a layout written by a newer app
than the one installed.

Both methods require a premium or admin entitlement, re-checked on every call rather than
trusted from the client's own six-hour cache. Voluntary donations do not grant or change
this entitlement. Errors follow the usual vocabulary:
`missing_api_key` (401), `invalid_api_key` (401), `not_entitled` (403), `invalid_payload`
and `invalid_layout_version` (400), and `payload_too_large` (413) above 256 KB.

## Diagnostics upload

```http
POST https://<host>/api/bydmate/diagnostics
X-API-Key: <paired-client-key>
X-Vehicle-Id: <vehicle-id>
X-Vehicle-Uid: <install-uid>            (optional, as for telemetry)
X-Mate-Version: 0.6.2                   (optional)
X-Diagnostics-Comment: <percent-encoded UTF-8, ≤ 500 chars>   (optional)
Content-Type: application/gzip

<gzip of one UTF-8 text bundle, ≤ 4 MB compressed, ≤ 40 MB decompressed>
```

Mate «Отправить диагностику» sends one text bundle; the server relays it as a document to
the developer's Telegram chat (`TELEGRAM_DIAGNOSTICS_CHAT_ID`). The bot token never ships in
the APK. The server **re-redacts** the decompressed text before sending (keys, bearer and bot
tokens, e-mail, all GPS forms, VIN → last 6) even though Mate redacts first; VoltFlow does not
store the bundle, only an audit row in `bydmate_diagnostic_uploads`.

| Status | Meaning |
|---|---|
| `200 {ok:true}` | Delivered to Telegram |
| `400` | Missing `X-Vehicle-Id`, unreadable body, or invalid / oversized gzip |
| `401` | Unknown API key |
| `413` | Body over 4 MB |
| `415` | Body is not gzip |
| `429 {reason}` | `vehicle_hourly` (3 / vehicle / hour) or `user_daily` (10 / user / day); failed sends count too |
| `502` | Telegram refused the upload (counted) |
| `503` | Diagnostics not configured on this server |

Do not retry automatically: show the result to the user and let them tap again.

## Privacy and compatibility

- Omit GPS by sending `location: {}`.
- Keep credentials and vehicle identifiers private.
- Preserve `vehicle_id` and `device_time` when retrying queued samples.
- Treat the contract as backward compatible: add fields rather than changing existing
  field meanings.
