# VoltFlow Mate telemetry schema

APK ingest contract: see `supabase/BYDMATE_APK_API.md`.

This document describes the current VoltFlow Mate telemetry storage model and the Di+
fields that the Android app may send.

## Cloud ingest contract

Endpoint:

```http
POST /api/bydmate/telemetry
Content-Type: application/json
X-API-Key: <profile bydmate_cloud_api_key>
X-Vehicle-Id: <vehicle id>
```

`X-Vehicle-Id` must match every sample `vehicle_id`.

### Device pairing (6-digit code)

Preferred APK setup uses a short code instead of copying a 64-character API key:

1. User opens VoltFlow **Settings → VoltFlow Mate** and taps **Link BYDMate**.
2. Server creates a row in `bydmate_link_codes` (hashed code, 10-minute TTL) and returns `{ code, expires_at }`.
3. User enters the code in VoltFlow Mate on DiLink and taps **Connect**.
4. APK calls `POST /api/bydmate/link-code/redeem` with `{ "code": "482913" }`.
5. Server marks the code redeemed, returns `{ api_key, endpoint_url }`; APK stores them as `cloud_sync_api_key` and `cloud_sync_url`.

API details: `supabase/BYDMATE_APK_API.md`. Migration: `20260531120000_bydmate_link_codes.sql`. Failed redeems are rate-limited via `bydmate_link_redeem_attempts` (10 failures / 15 minutes per hashed client IP). Existing installs that already pasted the full API key keep working.

Dev preview: create code on `/dev/settings` (dev auth bypass). Redeem is not in the web UI — use the APK or curl against `/api/bydmate/link-code/redeem`.

The Android app may send either one sample directly:

```json
{
  "schema_version": 1,
  "vehicle_id": "way",
  "device_time": "2026-05-25T18:00:00Z",
  "source": "BYDMate",
  "telemetry": { "soc": 50 },
  "diplus": null,
  "location": {}
}
```

or a batch:

```json
{
  "samples": [
    {
      "schema_version": 1,
      "vehicle_id": "way",
      "device_time": "2026-05-25T18:00:00Z",
      "source": "BYDMate",
      "telemetry": { "soc": 50 },
      "diplus": null,
      "location": {}
    }
  ]
}
```

Important compatibility rules:

- `schema_version` must be `1`.
- `source` must remain the legacy wire value `BYDMate` for compatibility.
- `telemetry` is required and must be an object; it may contain only a subset of
  fields, for example `{ "soc": 50 }`.
- `location` is required and must be an object; `{}` is valid.
- `diplus` may be an object, `null`, or omitted. VoltFlow normalizes `null` to
  an empty stored Di+ object.
- Numeric telemetry, Di+ and location values may arrive as JSON numbers or
  numeric strings. `is_charging` may arrive as a boolean or `"true"`/`"false"`.
- Batch payloads are capped at 300 samples.

Current VoltFlow Mate Android APK generation (v0.3.2, updated 2026-06-01):

- **In-app updates:** optional check on launch against `scroodge/BYDMate-own` GitHub Releases; user confirms download/install from the gateway screen.
- **Active cadence:** 1 s enqueue while moving or charging; 15 s HTTP flush with batches up to 15 samples.
- **Idle cadence:** 5 min heartbeats; up to 2 consecutive unchanged idle samples may be skipped (SOC/charging/power unchanged).
- **Payload tiers:** idle samples are slim (mostly `soc` + `is_charging`); moving/charging include `power_kw`; null fields are omitted.
- **GPS privacy:** optional Cloud Sync setting sends `location: {}` even when GPS is available (`cloud_sync_omit_gps`).
- **Bad GPS pre-filter:** accuracy > 30 m is dropped before enqueue (server sanitizer remains authoritative).
- `CloudTelemetryPayload.build(...)` emits `schema_version`, `vehicle_id`, `device_time`, `source`, `telemetry`, optional `diplus`, and `location`.
- `CloudTelemetryPayload.buildBatch(...)` wraps previously built sample JSON objects in `{ "samples": [...] }`.
- When Di+ data is unavailable on idle heartbeats, `diplus` is omitted.
- When GPS is unavailable or privacy is enabled, the APK emits `location: {}`.

Full APK wire details: `docs/cloud-telemetry-contract-ru.md` in the VoltFlow Mate Android repo.

Future compatibility checklist:

- Any change to `CloudTelemetryPayload` in the VoltFlow Mate Android APK must be mirrored by a
  VoltFlow parser test in `src/lib/bydmate/ingest-payload.test.mjs`.
- Any change to `src/lib/bydmate/ingest-payload.ts` should keep accepting
  existing APK payloads, especially batch samples with `diplus: null`.
- A production smoke test should include a batch payload with `diplus: null`; a
  valid API key should return `200 {"ok": true, ...}` and an invalid API key
  should pass payload validation and fail as `401 Unauthorized`, not
  `400 Invalid payload`.

## Tables

### `bydmate_live_snapshots`

One row per `(user_id, vehicle_id)` with the latest cloud telemetry payload. Use
this table for live dashboard cards and quick status checks.

This table is published to Supabase Realtime (`supabase_realtime`). The vehicle
page subscribes to changes and invalidates the live query instead of polling
every 5 seconds.

Important columns:

- `user_id`, `vehicle_id`
- `device_time`: timestamp reported by the Android device.
- `received_at`: timestamp when the cloud endpoint accepted the payload.
- `telemetry`: normalized VoltFlow telemetry JSON.
- `location`: latest GPS payload when present.
- `raw_payload`: last accepted raw payload.
- `diplus`: raw Di+ object.
- `diplus_*`: selected Di+ fields materialized for debug screens and simple
  analytics.

### `bydmate_telemetry_samples`

Append-only telemetry history. This is the source of truth for charts, charging
history, and trip sample details.

Important columns:

- `user_id`, `vehicle_id`, `device_time`, `received_at`
- `telemetry`: normalized telemetry JSON.
- `diplus`: raw Di+ object.
- `diplus_min_cell_voltage_v`, `diplus_max_cell_voltage_v`,
  `diplus_cell_delta_v`: materialized cell-voltage values used by the UI.
- Other `diplus_*` columns are materialized for diagnostics and ad hoc analysis;
  they are not broadly indexed.

The table is unique on `(user_id, vehicle_id, device_time)` so client retries do
not create duplicate samples.

### `bydmate_telemetry_hourly`

Hourly rollup for long-range charts. It is updated during ingest and keeps
sample counts plus selected min/max/last/average metrics.

Since migration `20260530121000`, each hour also stores:

- `regen_kwh_sum` — integrated regen energy from `power_kw` trapezoid segments
- `traction_kwh_sum` — integrated traction energy from positive `power_kw`

These sums power month/year regen charts after raw samples expire.

### `bydmate_trips`

Server-side trip segments inferred from telemetry samples. A trip is closed when
the next accepted sample arrives more than five minutes after the previous
sample.

Samples are **not** attached to trips when:

- the vehicle is charging (same as migration `20260526101500`), or
- Di+ reports explicit park gear (`diplus.gear` = `1` / `P`) — migration `20260610120000`, or
- there is no open trip and the sample shows no drive evidence (speed ≤ 5 km/h and gear not D/R/N) — migration `20260610140000`.

Open trips are finalized when a parked or charging sample arrives. Closed trips with fewer than three samples, distance ≤ 0.1 km, and max speed ≤ 3 km/h are **discarded** (deleted) instead of kept — migration `20260610140000`. The trips API also hides these via `isJunkTrip` in `trip-filter.ts`.

Since migration `20260530121000`, closed trips persist:

- `regen_energy_kwh` — total regen for the trip (computed at trip close from samples)
- `traction_energy_kwh` — total traction energy for the trip

The trips API prefers stored values; it only recomputes from raw samples when
those columns are null (legacy trips or pre-migration data).

### `bydmate_trip_track_points`

GPS track points linked to `bydmate_trips`. This table exists because
`bydmate_telemetry_samples` intentionally does not store location history.

The table is unique on `(trip_id, device_time)`.

### Removed legacy table

`bydmate_telemetry_points` was the first VoltFlow Mate history table. Its data was
backfilled into `bydmate_telemetry_samples`; new code should not read it.

## Di+ payload fields

The Android app may send a `diplus` object beside normalized `telemetry`.
The raw object is stored in `diplus`; selected fields are copied to columns.

| Di+ key | Materialized column | Type | Notes |
| --- | --- | --- | --- |
| `soc` | `diplus_soc` | numeric | Battery state of charge. |
| `speed_kmh` | `diplus_speed_kmh` | numeric | Vehicle speed. |
| `mileage_km` | `diplus_mileage_km` | numeric | Odometer/mileage. |
| `power_kw` | `diplus_power_kw` | numeric | Vehicle power. |
| `charge_gun_state` | `diplus_charge_gun_state` | text | Raw Di+ state code. |
| `charging_status` | `diplus_charging_status` | text | Raw Di+ status code. |
| `battery_capacity_kwh` | `diplus_battery_capacity_kwh` | numeric | Reported battery capacity/energy value. |
| `total_elec_consumption_kwh` | `diplus_total_elec_consumption_kwh` | numeric | Total electric consumption. |
| `voltage_12v` | `diplus_voltage_12v` | numeric | Auxiliary battery voltage. |
| `max_cell_voltage_v` | `diplus_max_cell_voltage_v` | numeric | May be overridden by normalized telemetry fallback. |
| `min_cell_voltage_v` | `diplus_min_cell_voltage_v` | numeric | May be overridden by normalized telemetry fallback. |
| `cell_delta_v` | `diplus_cell_delta_v` | numeric | Calculated from max/min when missing. |
| `avg_battery_temp_c` | `diplus_avg_battery_temp_c` | numeric | Average battery temperature. |
| `exterior_temp_c` | `diplus_exterior_temp_c` | numeric | Exterior temperature. |
| `gear` | `diplus_gear` | text | Raw Di+ gear code. |
| `power_state` | `diplus_power_state` | text | Raw Di+ power-state code. |
| `inside_temp_c` | `diplus_inside_temp_c` | numeric | Cabin temperature; sentinel values may appear. |
| `ac_status` | `diplus_ac_status` | text | Raw HVAC state. |
| `ac_temp_c` | `diplus_ac_temp_c` | numeric | HVAC target temperature. |
| `fan_level` | `diplus_fan_level` | numeric | HVAC fan level. |
| `door_fl` | `diplus_door_fl` | text | Front-left door state. |
| `door_fr` | `diplus_door_fr` | text | Front-right door state. |
| `door_rl` | `diplus_door_rl` | text | Rear-left door state. |
| `door_rr` | `diplus_door_rr` | text | Rear-right door state. |
| `window_fl_percent` | `diplus_window_fl_percent` | numeric | Front-left window position. |
| `window_fr_percent` | `diplus_window_fr_percent` | numeric | Front-right window position. |
| `window_rl_percent` | `diplus_window_rl_percent` | numeric | Rear-left window position. |
| `window_rr_percent` | `diplus_window_rr_percent` | numeric | Rear-right window position. |
| `sunroof_percent` | `diplus_sunroof_percent` | numeric | Sunroof position. |
| `trunk` | `diplus_trunk` | text | Trunk state. |
| `hood` | `diplus_hood` | text | Hood state. |
| `tire_press_fl_kpa` | `diplus_tire_press_fl_kpa` | numeric | Front-left tire pressure. |
| `tire_press_fr_kpa` | `diplus_tire_press_fr_kpa` | numeric | Front-right tire pressure. |
| `tire_press_rl_kpa` | `diplus_tire_press_rl_kpa` | numeric | Rear-left tire pressure. |
| `tire_press_rr_kpa` | `diplus_tire_press_rr_kpa` | numeric | Rear-right tire pressure. |
| `drive_mode` | `diplus_drive_mode` | text | Raw Di+ drive-mode code. |
| `work_mode` | `diplus_work_mode` | text | Raw Di+ work-mode code. |
| `auto_park` | `diplus_auto_park` | text | Auto-park state. |
| `rain` | `diplus_rain` | text | Rain sensor/state; sentinel values may appear. |
| `light_low` | `diplus_light_low` | text | Low-beam state. |
| `drl` | `diplus_drl` | text | Daytime running lights state. |

Additional Di+ keys may remain only inside the raw `diplus` JSON until a UI or
analytics query needs them.

## Index policy

Keep hot-path indexes small:

- `bydmate_telemetry_samples(user_id, vehicle_id, device_time desc)`
- `bydmate_telemetry_samples(user_id, device_time desc)`
- optional charging partial index for charging debug/history views
- `bydmate_telemetry_hourly(user_id, vehicle_id, hour_start desc)`
- `bydmate_trips(user_id, vehicle_id, started_at desc)`
- `bydmate_trip_track_points(trip_id, device_time)`

Avoid per-field indexes for every Di+ column unless a production query actually
filters or sorts by that field.

## Retention (tiered by premium)

The original global 90-day/3-year purge (`20260530120000`,
`purge_old_bydmate_telemetry()`) was **superseded** by a premium-tiered purge. The
current authoritative function is `public.purge_old_bydmate_telemetry_by_tier()`
(tiers set across `20260617133000` → `20260617135500` → `20260626130000`):

| Data | Free | Premium + Admin |
| --- | --- | --- |
| `bydmate_telemetry_samples` (`device_time`) | 30 days | **Unlimited** (kept forever) |
| `bydmate_trip_track_points` (`device_time`) | 30 days | **Unlimited** |
| `bydmate_telemetry_hourly` (`hour_start`) | 3 years | 3 years |

`is_user_premium()` returns true for admins too, so premium + admin rows are fully
exempt. Trips, live snapshots, and trip-level energy columns are **not** purged — so
regen/traction on `bydmate_trips` survives after raw samples expire.

A pg_cron job `purge-bydmate-telemetry` runs the tiered purge daily (registered in
`20260624130000`). Manual run (service role):

```sql
select public.purge_old_bydmate_telemetry_by_tier();
```

## Home charger geofence (`cars`)

Migration `20260530123000` adds optional geofence columns on `cars`:

| Column | Purpose |
| --- | --- |
| `home_charger_lat` | Home charger latitude |
| `home_charger_lon` | Home charger longitude |
| `home_charger_radius_m` | Match radius in meters (default 150, max 5000) |

When a charging session starts without an explicit tariff, VoltFlow checks the
latest `bydmate_live_snapshots.location` against the car geofence. If the car is
inside the radius, `profiles.default_price_per_kwh` is applied automatically.

Configure geofence in **Settings → Edit car**.

## Vehicle analytics APIs

New read/export endpoints (authenticated, RLS-scoped):

| Endpoint | Purpose |
| --- | --- |
| `GET /api/vehicle/telemetry?range=&date=&vehicle_id=` | Day/week/month/quarter/year history (hourly + recent raw merge) |
| `GET /api/vehicle/analytics?type=monthly&month=&vehicle_id=` | Monthly distance, regen, charged kWh, cost, consumption |
| `GET /api/vehicle/analytics?type=phantom&vehicle_id=&days=` | Parked SOC drain (idle heartbeats, 4+ h idle) |
| `GET /api/vehicle/analytics?type=cost-per-km&from=&to=&vehicle_id=` | Charging cost divided by trip distance |
| `GET /api/vehicle/analytics?type=period-trips&from=&to=&vehicle_id=` | Trips in a telemetry window with enriched outside-temp averages |
| `GET /api/vehicle/analytics?type=route-insights&vehicle_id=&outside_temp=` | Repeat-route clusters (≥3 trips), consumption vs temp, parked-route list |
| `PUT /api/vehicle/route-labels` | Save user route name and/or park flag (`bydmate_route_labels`) |
| `GET /api/vehicle/lifetime-map?vehicle_id=` | Aggregated GPS track points for lifetime map |
| `GET /api/vehicle/export?format=csv\|json&from=&to=&vehicle_id=` | User data export (sessions, trips, samples) |

UI: **History → Analytics** tab (`/history?tab=analytics`) hosts `vehicle-analytics-panels.tsx`. The Vehicle page shows a teaser linking here when VoltFlow Mate is connected; dev fixtures at `/dev/vehicle` render the panels inline.

### Trip list and calendar

`GET /api/vehicle/trips` accepts optional `?month=YYYY-MM` to return distinct local dates that have trips (for History calendar green dots). Per-day trip lists use the same endpoint with `?date=YYYY-MM-DD`.

Track read path uses `filterDisplayTripTrackPoints()` so stored GPS points are not dropped on display-only sanitization; maps may show up to 2000 downsampled points.

### Trip charts (History trip detail, dev fixtures)

Built in `vehicle-live-view.tsx` → `prepareTelemetryHistory()` from trip samples or hourly rows:

| Chart | Type | Notes |
| --- | --- | --- |
| SOC | Line | % over trip time |
| Speed & power | Dual-axis line | km/h (left) and kW (right) on one card |
| Recovered energy | Bar | Incremental regen per telemetry interval via `calculateRegenRecoverySegments()` / `prepareRegenRecoveryBars()` in `trip-energy.ts`; X-axis prefers `current_trip_distance_km` (or odometer delta), else time; bins to ~72 bars when dense |
| Temperatures | Multi-series line | Battery, outside, cabin |
| Cell delta | Line | Optional; trip and day analytics |
| Cell delta by SOC | Scatter/line | SOC vs delta; fullscreen supports hover |

**Fullscreen hover (all trip and analytics charts):** shared helpers in `chart-interaction.tsx` — vertical crosshair, floating tooltip with series values. Compact card previews do not enable hover.

### Route map (trip detail, route insights, analytics day)

`RouteMap` / `RouteMapPreview` in `vehicle-live-view.tsx`:

- OpenStreetMap raster tiles (`tile.openstreetmap.org`), zoom clamped to **z2–z19** (no app-side ±step cap beyond OSM range).
- Initial fit uses route bounding box; **zoom in/out keeps the viewport center fixed** (pan scales with zoom level).
- Layers: solid route line; **kW** combined drive (red) + regen (green) gradient; speed; SOC.
- Hover near the route line shows tooltip: time, SOC, speed, power (works on compact map and fullscreen).
- Fullscreen adds layer legend, zoom/pan/reset; compact preview is maximize-only.

### `bydmate_route_labels`

Migration `20260530124000` stores per-user route preferences for route insights:

| Column | Purpose |
| --- | --- |
| `route_id` | Stable fingerprint id from route clustering |
| `name` | Optional user label (1–80 chars) |
| `is_park` | When true, route is treated as a parking spot and excluded from repeat-route clustering |

RLS scopes rows by `auth.uid()`. At least one of `name` or `is_park` must be set on insert/update.

## Server-side ingest and read optimizations

Applied in app code and migrations `20260530120000`–`20260530123000`:

- **Day chart cap:** `fetchTelemetryHistory` loads at most 5000 raw day samples before client downsample (`MAX_DAY_RAW_SAMPLES`).
- **Live Realtime:** `useBydmateLiveQuery` subscribes to `bydmate_live_snapshots` postgres changes.
- **Batch push writes:** charge notification state upserts once per vehicle per ingest batch (not per sample).
- **Trip energy at close:** `bydmate_ingest_telemetry` updates hourly regen/traction sums and finalizes trip energy on trip close (charging gap + 5 min gap).
- **Trip chart regen bars:** client integrates negative-power intervals from raw samples (`trip-energy.ts`); hourly rollup path uses `regen_kwh_sum` per bucket when day analytics has no raw power series.

## Trip energy helpers (`src/lib/bydmate/trip-energy.ts`)

| Function | Purpose |
| --- | --- |
| `calculateTripEnergy()` | Total regen/traction kWh for a trip from power samples (trapezoid, max 180 s gap) |
| `calculateCumulativeRegenPoints()` | Legacy cumulative regen line (superseded by bar chart in UI) |
| `calculateRegenRecoverySegments()` | Per-interval regen kWh with optional trip distance km |
| `prepareRegenRecoveryBars()` | Bin segments for bar chart; chooses distance vs time X-axis |

Tests: `src/lib/bydmate/trip-energy.test.mjs`.

## Auto charging sessions from Mate ingest

After each successful ingest batch, `processBydmateAutoChargingSessions`
(`src/lib/bydmate/charging-auto-session.ts`) may create or stop `charging_sessions`
rows for cars with matching `cars.vehicle_alias`.

| Event | Rule |
| --- | --- |
| Auto-start | `isMateAutoSessionCharging`: only `charge_power_kw` (never `power_kw`), parked `speed_kmh ≤ 5`, not 100% tail; **4** consecutive samples; sample within **3 min** of batch end; see [docs/CHARGING_SESSIONS.md](../docs/CHARGING_SESSIONS.md) |
| Auto-stop | **2** consecutive unplug samples, or immediate stop when `speed_kmh > 5`; ignore samples before session `started_at` |
| Reconcile | `charging_session_reconcile` after ingest; repairs bad `stopped_at`, zero kWh, SOC vs telemetry |
| State | `bydmate_auto_charging_session_state` stores consecutive sample counters per `(user_id, vehicle_id)` |

Requires Mate to keep sending ingest while charging. Progress after start is still
updated by the PWA via `ChargingSessionBackgroundSync`.

Ingest success JSON includes:

```json
"auto_charging_sessions": {
  "started": 0,
  "stopped": 1,
  "sessionIds": ["…"],
  "error": "optional message when auto hook failed"
}
```

APK clients can ignore this block; it is for server/debug verification after deploy.

## Charging session integrity (client + manual stop)

These rules complement ingest auto start/stop and prevent false `completed` rows when the user drives away or stops without opening the charging screen.

| Layer | Behavior |
| --- | --- |
| Live bundle | `deriveChargingSessionLiveBundle` — `completionSource: live` or `math`; never math-complete while fresh live SOC is available |
| Background sync | `useChargingSessionLiveSync` — ~1 Hz persist; live/math complete; drive-away → `stopped` |
| Manual stop | `resolveStopProgressForSession` — live snapshot (90s) → last in-session telemetry SOC → math |
| Reconcile (server) | `reconcileChargingSessionsForUser` on ingest + sessions API; `resolveStateToPersist` for open sessions when Mate wakes |

### Debugging false `completed` or frozen percent

1. Compare `charging_sessions` times/percent with `bydmate_telemetry_samples` for `cars.vehicle_alias` as `vehicle_id`.
2. Check movement: any `speed_kmh > 5` in-session implies `stopped`, not `completed`, if SOC never reached target.
3. If telemetry is current but `current_percent` is stale, the PWA was likely closed — not an ingest bug.
4. For server auto stop: confirm production deploy, row in `bydmate_auto_charging_session_state`, and ingest response `auto_charging_sessions`.
5. Historical false `completed` rows (max SOC below target with in-session movement) were corrected by migration `20260602103500_fix_false_completed_charging_sessions.sql`.

## Charging session UX additions

Active charging screen (`charging-session-screen.tsx`):

- **Estimated finish** — wall-clock time when target SOC is reached
- **SOC at 07:00** — projected SOC at next local 07:00 if charging continues
- **Time to target SOC** — seconds remaining from live/math state

Uses helpers in `src/lib/charging-math.ts`: `projectSocAtTime`, `secondsUntilTargetSoc`.

## Compatibility tests

`src/lib/bydmate/ingest-payload.test.mjs` covers:

- Legacy payloads without `diplus`
- Slim idle payloads (SOC only, empty location)
- Old-style 60-sample charging batches from pre-15s-flush APKs
- Numeric string coercion

Any APK payload change must keep these tests green.
