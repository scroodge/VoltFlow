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
```

`X-Vehicle-Id` selects the vehicle stream for the authenticated paired key. It is canonical for
the request: the server normalizes queued samples to this value so an item queued before a user
changes the client setting remains retryable. Clients should nevertheless send the configured
vehicle alias in both places and preserve it when retrying.

## Pairing

A signed-in user creates a short-lived pairing code in VoltFlow Settings. The client
redeems it once and stores the returned endpoint and paired-client key.

```http
POST https://<host>/api/bydmate/link-code/redeem
Content-Type: application/json

{ "code": "123456" }
```

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
| `mate_version` | string | Client version metadata. |
| `client_hourly` | boolean | Marks a sample as represented by a companion hourly block in the same object batch. |
| `live_only` | boolean | Status-only snapshot. When true, the server updates the latest live snapshot but skips durable telemetry, hourly-rollup, and trip writes. |

Unknown forward-compatible fields are ignored. Numeric values may be represented as JSON
numbers or numeric strings. Batches are limited to 300 samples.

## Acknowledgement and retries

An HTTP success alone does not permit a client to discard queued samples. The client must
receive an application response equivalent to:

```json
{
  "ok": true,
  "inserted_count": 1,
  "duplicate_count": 0,
  "skipped_stale_count": 0,
  "hourly_rollup_applied": 0
}
```

The acknowledged inserted and duplicate count must cover every submitted sample, and
`skipped_stale_count` must be zero. Network failures and server errors remain retryable;
the client preserves the original `vehicle_id` for every queued sample.

`hourly_rollup_applied` is informational and is not part of sample acknowledgement
accounting.

## Command poll and acknowledgement

Compatible Mate clients may poll for abstract commands and acknowledge their outcome with the
same paired identity. The client must still enforce vehicle-safety constraints locally.

```http
GET https://<host>/api/bydmate/commands
X-API-Key: <paired-client-key>
X-Vehicle-Id: <vehicle-id>
```

The response contains `commands` (at most 10 pending commands) and always includes
`live_fast_seconds`. A positive value grants that vehicle a short, expiring fast-status window;
the client may send `live_only: true` snapshots at its compatible fast cadence while it lasts.
`0` means normal delivery cadence. This signal is not a command and must never be persisted as a
user preference by the client.

```json
{
  "ok": true,
  "commands": [
    { "id": "command-id", "type": "lock", "params": {}, "created_at": "2026-01-01T12:00:00Z" }
  ],
  "live_fast_seconds": 20
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

## Privacy and compatibility

- Omit GPS by sending `location: {}`.
- Keep credentials and vehicle identifiers private.
- Preserve `vehicle_id` and `device_time` when retrying queued samples.
- Treat the contract as backward compatible: add fields rather than changing existing
  field meanings.
