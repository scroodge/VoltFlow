# VoltFlow Mate APK API Contract

Last updated: 2026-06-01

This file is the handoff contract for the Android APK. Keep it in sync with
`src/lib/bydmate/ingest-payload.ts` and `src/app/api/bydmate/telemetry/route.ts`.

**Cadence, payload tiers, GPS privacy:** see VoltFlow Mate Android repo
`docs/cloud-telemetry-contract-ru.md` (v0.3.2: GitHub auto-update on gateway;
6-digit link code; 1 s active enqueue, 15 s flush, slim idle payloads,
`cloud_sync_omit_gps`).

## Endpoint

```http
POST https://<voltflow-domain>/api/bydmate/telemetry
Content-Type: application/json
X-API-Key: <profile bydmate_cloud_api_key>
X-Vehicle-Id: <vehicle_id>
```

`X-Vehicle-Id` must match every sample `vehicle_id`.

`vehicle_id` is the per-car alias configured in VoltFlow (`cars.vehicle_alias`), e.g. `way`, `cl`, or any string the user sets. JSON examples below use `"way"` only as a sample value — production charts and session APIs resolve the alias from the car/session, not from a global default.

## Device pairing (6-digit code)

Preferred setup: user generates a short code in VoltFlow Settings (logged in),
then enters it in VoltFlow Mate on DiLink. The APK redeems the code once and stores the full
`bydmate_cloud_api_key` locally. Existing installs that already pasted the API
key keep working unchanged.

### Create code (VoltFlow web, authenticated)

```http
POST https://<voltflow-domain>/api/bydmate/link-code
```

Requires a logged-in Supabase session (browser cookie) or dev bypass in local
preview.

Success:

```json
{
  "ok": true,
  "code": "482913",
  "expires_at": "2026-05-31T12:10:00.000Z"
}
```

- Code is 6 numeric digits, valid for 10 minutes, single use.
- Creating a new code invalidates previous unused codes for that user.
- Ensures `profiles.bydmate_cloud_api_key` exists (auto-generates if missing).

### Redeem code (VoltFlow Mate APK, public)

```http
POST https://<voltflow-domain>/api/bydmate/link-code/redeem
Content-Type: application/json

{ "code": "482913" }
```

Success:

```json
{
  "ok": true,
  "api_key": "<profile bydmate_cloud_api_key>",
  "endpoint_url": "https://<voltflow-domain>/api/bydmate/telemetry"
}
```

Errors:

```json
{ "ok": false, "error": "Invalid or expired code" }
```

```json
{ "ok": false, "error": "Too many attempts" }
```

Rate limit: failed redeems per client IP (hashed server-side), 10 failures per
15 minutes. After success, use `api_key` as `X-API-Key` on the telemetry
endpoint above.

Manual API key paste remains supported in VoltFlow Mate **Advanced** (Gateway or Settings → Cloud Sync).

**APK implementation:** `VoltflowLinkClient` derives redeem URL from the telemetry endpoint  
(`…/api/bydmate/telemetry` → `…/api/bydmate/link-code/redeem`). See `docs/cloud-telemetry-contract-ru.md` in the Mate repo.

## Sample Shape

```ts
{
  schema_version: 1;
  vehicle_id: string;
  device_time: string;
  source: "BYDMate";
  telemetry: Telemetry;
  location: Location;
  diplus?: Diplus | null;
}
```

Rules:

- `schema_version` must be `1`.
- `source` must remain the legacy wire value `"BYDMate"` for compatibility.
- `vehicle_id` must be 1..160 chars.
- `device_time` should be ISO-8601, for example `2026-05-26T10:30:00.000Z`.
- `telemetry` is required and must be an object. `{}` is valid.
- `location` is required and must be an object. `{}` is valid.
- `diplus` may be an object, `null`, or omitted.
- Numeric values may be JSON numbers or numeric strings.
- Batch size is 1..300 samples.

## Single Sample

```json
{
  "schema_version": 1,
  "vehicle_id": "way",
  "device_time": "2026-05-26T10:30:00.000Z",
  "source": "BYDMate",
  "telemetry": {
    "soc": 57,
    "speed_kmh": 0,
    "power_kw": -1.2,
    "is_charging": true,
    "charge_power_kw": 7.1
  },
  "diplus": null,
  "location": {}
}
```

## Batch

Preferred batch shape:

```json
{
  "samples": [
    {
      "schema_version": 1,
      "vehicle_id": "way",
      "device_time": "2026-05-26T10:30:00.000Z",
      "source": "BYDMate",
      "telemetry": {
        "soc": 57
      },
      "diplus": null,
      "location": {}
    }
  ]
}
```

A direct JSON array is also accepted:

```json
[
  {
    "schema_version": 1,
    "vehicle_id": "way",
    "device_time": "2026-05-26T10:30:00.000Z",
    "source": "BYDMate",
    "telemetry": {
      "soc": 57
    },
    "location": {}
  }
]
```

## Telemetry

All fields are optional. Unknown extra keys are accepted and preserved in the
raw payload.

```ts
type Telemetry = {
  soc?: number | string | null;
  speed_kmh?: number | string | null;
  power_kw?: number | string | null;
  battery_temp_c?: number | string | null;
  cabin_temp_c?: number | string | null;
  outside_temp_c?: number | string | null;
  battery_voltage_v?: number | string | null;
  aux_voltage_v?: number | string | null;
  cell_voltage_min_v?: number | string | null;
  cell_voltage_max_v?: number | string | null;
  cell_delta_v?: number | string | null;
  diplus_min_cell_voltage_v?: number | string | null;
  diplus_max_cell_voltage_v?: number | string | null;
  diplus_cell_delta_v?: number | string | null;
  odometer_km?: number | string | null;
  soh_percent?: number | string | null;
  is_charging?: boolean | "true" | "false" | null;
  charge_power_kw?: number | string | null;
  charge_type?: string | null;
  kwh_charged?: number | string | null;
  range_est_km?: number | string | null;
  current_trip_distance_km?: number | string | null;
  current_trip_consumption_kwh_100km?: number | string | null;
};
```

Charging samples are stored in live/history telemetry, but they do not create or
extend driving trips. The server treats a sample as charging when any of these
are true:

- `telemetry.is_charging` is true.
- `telemetry.charge_power_kw` is greater than `0.1`.
- `diplus.charging_status` is one of `charging`, `charge`, `active`, `on`,
  `true`, `1`, `yes`.
- `diplus.charge_gun_state` is one of `connected`, `plugged`, `inserted`, `on`,
  `true`, `yes`.

## Location

All fields are optional. `{}` is valid.

```ts
type Location = {
  lat?: number | string | null;
  lon?: number | string | null;
  accuracy_m?: number | string | null;
  bearing_deg?: number | string | null;
};
```

The server may drop suspicious GPS points before persistence.

## Di+

`diplus` may be omitted or set to `null` when Di+ data is unavailable. All
fields are optional. Unknown extra keys are accepted and preserved in the raw
payload.

```ts
type Diplus = {
  soc?: number | string | null;
  speed_kmh?: number | string | null;
  mileage_km?: number | string | null;
  power_kw?: number | string | null;
  charge_gun_state?: string | number | null;
  charging_status?: string | number | null;
  battery_capacity_kwh?: number | string | null;
  total_elec_consumption_kwh?: number | string | null;
  voltage_12v?: number | string | null;
  max_cell_voltage_v?: number | string | null;
  min_cell_voltage_v?: number | string | null;
  cell_delta_v?: number | string | null;
  avg_battery_temp_c?: number | string | null;
  exterior_temp_c?: number | string | null;
  gear?: string | number | null;
  power_state?: string | number | null;
  inside_temp_c?: number | string | null;
  ac_status?: string | number | boolean | null;
  ac_temp_c?: number | string | null;
  fan_level?: number | string | null;
  door_fl?: string | number | boolean | null;
  door_fr?: string | number | boolean | null;
  door_rl?: string | number | boolean | null;
  door_rr?: string | number | boolean | null;
  window_fl_percent?: number | string | null;
  window_fr_percent?: number | string | null;
  window_rl_percent?: number | string | null;
  window_rr_percent?: number | string | null;
  sunroof_percent?: number | string | null;
  trunk?: string | number | boolean | null;
  hood?: string | number | boolean | null;
  tire_press_fl_kpa?: number | string | null;
  tire_press_fr_kpa?: number | string | null;
  tire_press_rl_kpa?: number | string | null;
  tire_press_rr_kpa?: number | string | null;
  drive_mode?: string | number | null;
  work_mode?: string | number | null;
  auto_park?: string | number | boolean | null;
  rain?: string | number | boolean | null;
  light_low?: string | number | boolean | null;
  drl?: string | number | boolean | null;
};
```

## Success Response

```json
{
  "ok": true,
  "persisted": {
    "vehicle_id": "way",
    "received_at": "2026-05-26T10:30:01.000Z",
    "device_time": "2026-05-26T10:30:00.000Z",
    "diplus": {},
    "diplus_min_cell_voltage_v": null,
    "diplus_max_cell_voltage_v": null,
    "diplus_cell_delta_v": null
  },
  "vehicle_id": "way",
  "sample_count": 1,
  "inserted_count": 1,
  "duplicate_count": 0,
  "skipped_stale_count": 0,
  "dropped_location_count": 0,
  "dropped_telemetry_field_count": 0,
  "charge_notifications": {
    "sent": 0,
    "thresholds": []
  },
  "auto_charging_sessions": {
    "started": 0,
    "stopped": 0,
    "sessionIds": []
  },
  "received_at": "2026-05-26T10:30:01.000Z",
  "ingest": {
    "duplicate": false
  }
}
```

`auto_charging_sessions` is server-side only (VoltFlow web app auto start/stop of
`charging_sessions` when `cars.vehicle_alias` matches `X-Vehicle-Id`). The APK does
not need to read it. On failure inside the hook, `error` is set and counts stay zero.

The exact `ingest` object may include fields such as `duplicate`, `charging`,
`trip_id`, `closed_trip_id`, `sample_count`, `inserted_count`, `duplicate_count`,
`track_point_count`, `skipped_stale_count`, `vehicle_id`, and `last_device_time`.

### Delivery acknowledgment (APK queue)

VoltFlow Mate must **not** dequeue a batch on HTTP `2xx` alone. Treat a batch as
delivered only when:

- `ok` is `true`, and
- `skipped_stale_count` is `0`, and
- `inserted_count + duplicate_count >=` the number of samples in the POST body.

Batch ingest always attempts to persist historical samples into
`bydmate_telemetry_samples` (live snapshot monotonicity is enforced separately).
`skipped_stale_count` should normally be `0`; a non-zero value means the server
rejected part of the batch and the APK should retry.

Persist `cloud_sync_last_ack` for diagnostics, e.g. `15 sent, 12 ins, 3 dup, 0 skip`.

## Error Responses

```json
{ "ok": false, "error": "Missing X-Vehicle-Id" }
```

```json
{ "ok": false, "error": "Invalid JSON" }
```

```json
{ "ok": false, "error": "Invalid payload", "issues": {} }
```

```json
{ "ok": false, "error": "Vehicle ID mismatch" }
```

```json
{ "ok": false, "error": "Unauthorized" }
```

```json
{ "ok": false, "error": "Telemetry ingest failed" }
```

## APK Checklist

- Send `X-API-Key` and `X-Vehicle-Id` on every request.
- Keep `X-Vehicle-Id` equal to every sample `vehicle_id`.
- Prefer `{ "samples": [...] }` for batches.
- Send at most 300 samples per request.
- Always send `telemetry` and `location` as objects.
- Use `diplus: null` when Di+ data is unavailable.
- Retry is safe: `(user_id, vehicle_id, device_time)` is idempotent.
