# VoltFlow Mate API contract

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

`X-Vehicle-Id` must match `vehicle_id` in every submitted sample. The server validates the
paired key and authorizes the vehicle for the associated account.

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
  "skipped_stale_count": 0
}
```

The acknowledged inserted and duplicate count must cover every submitted sample, and
`skipped_stale_count` must be zero. Network failures and server errors remain retryable;
the client preserves the original `vehicle_id` for every queued sample.

## Completed-trip summaries

When supported by the paired vehicle, a client may submit completed-trip summaries:

```http
POST https://<host>/api/bydmate/trip-summaries
X-API-Key: <paired-client-key>
X-Vehicle-Id: <vehicle-id>
```

This optional path provides completed trip history only. It must not be used alongside an
equivalent live telemetry source for the same drive.

## Remote commands

Paired clients may poll and acknowledge abstract vehicle commands only when the connected
vehicle integration supports them. Commands are authenticated with the same paired-client
identity and must enforce vehicle-safety constraints on the client.

## Privacy and compatibility

- Omit GPS by sending `location: {}`.
- Keep credentials and vehicle identifiers private.
- Preserve `vehicle_id` and `device_time` when retrying queued samples.
- Treat the contract as backward compatible: add fields rather than changing existing
  field meanings.
