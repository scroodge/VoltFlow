# TPMS data inventory

Inventory date: 2026-08-28. Scope: `BYDMate-own` at `e2b8313`,
`EvAcChargeTimer` at `c72d0d2`, and production telemetry queried at approximately
13:25–13:35 UTC. Production counts are a moving snapshot because ingest continued
during the queries.

## Verdict

- The stack has **four per-wheel pressure readings only**. It has **no per-wheel tyre
  temperature** at the APK source, on the wire, in the ingest schema/sanitizer, or in
  storage. There is no tyre-temperature field being dropped between layers.
- Pressure is stored in **kPa**. The observed non-sentinel median is **245 kPa**
  (2.45 bar, about 35.5 psi). The raw stored range is **0–302 kPa**; zero is an
  unavailable/sentinel value, not a physical pressure.
- TPMS is **not plausibility-clamped** by either the APK parser or server sanitizer.
  Numeric values are written raw to flat numeric columns. This is the same class of
  exposure as raw `diplus_voltage_12v`, and production already contains 303,596 zero
  wheel-readings.
- Of 14 production user/vehicle streams, 12 have non-NULL TPMS at least once, but only
  **9 have any usable reading** (`100 < pressure <= 500` for this inventory). Three
  streams are zero-only and two have no TPMS.
- Usable raw TPMS history begins **2026-05-22**. Most usable streams begin only in late
  July or August. Free-tier raw telemetry, including TPMS, is purged after **30 days**;
  the hourly rollup has no TPMS fields, so no pressure history survives that purge.
- Feature 1, pressure-versus-consumption correlation: **not supportable as a reliable
  product conclusion from the present fleet**. There are many paired rows, but only
  eight materially populated usable streams, a short and tier-dependent history,
  repeated rather than independent samples, no TPMS in long-lived rollups, and severe
  confounding by speed, weather, HVAC, route, load, and driver. The data can support an
  explicitly exploratory per-vehicle analysis, not a defensible fleet feature.
- Feature 2, temperature-compensated self-baselined slow-leak detection: **not safely
  supportable as specified without APK/source changes that provide tyre temperature**.
  Ambient temperature is usually present and could support a lower-confidence
  experiment, but it is not tyre temperature and cannot precisely compensate pressure
  after driving, sun exposure, braking, or garage/outdoor transitions. A raw-pressure
  trend without compensation would produce cold-morning false alarms.

## A. Exact fields, units, and end-to-end path

| Layer | Front left | Front right | Rear left | Rear right | Unit / behavior |
|---|---|---|---|---|---|
| Di+ source labels | `TirePressFL` from `左前轮气压` | `TirePressFR` from `右前轮气压` | `TirePressRL` from `左后轮气压` | `TirePressRR` from `右后轮气压` | Parsed as nullable `Int`; documented/live-probed as kPa |
| APK model | `DiParsData.tirePressFL` | `tirePressFR` | `tirePressRL` | `tirePressRR` | kPa; copied into `TelemetrySnapshot` under the same Kotlin names |
| Autoservice source | `FID_TIRE_PRESSURE_FL` = `-1728052956` | `FID_TIRE_PRESSURE_FR` = `-1728052952` | `FID_TIRE_PRESSURE_RL` = `-1728052948` | `FID_TIRE_PRESSURE_RR` = `-1728052944` | Device 1001, integer read, kPa |
| Wire `diplus` object | `tire_press_fl_kpa` | `tire_press_fr_kpa` | `tire_press_rl_kpa` | `tire_press_rr_kpa` | JSON number; omitted when absent, never intentionally sent as JSON null by current builders |
| Zod ingest schema | same four wire names | | | | `numericSchema`: nullable/optional number; numeric strings are coerced |
| Sanitizer | same four keys survive inside `diplus` | | | | Only `diplus.soc` is range-sanitized. TPMS has no rule, rounding, clamp, or cross-sample check |
| Historical DB | `diplus_tire_press_fl_kpa` | `diplus_tire_press_fr_kpa` | `diplus_tire_press_rl_kpa` | `diplus_tire_press_rr_kpa` | `numeric`, values extracted directly by `bydmate_jsonb_numeric` |
| Live snapshot DB | same four flat column names, plus current `diplus` JSON where that table retains it | | | | `numeric` flat columns; no per-field observation timestamp |

There are three APK payload paths and all carry the same four pressure keys:

1. The main app payload includes them in both parked and non-parked `diplus` shapes.
2. The shell daemon's Di+ payload includes them.
3. The parked/charging autoservice fallback places direct autoservice readings in the
   object named `diplus` for server compatibility.

There is **no APK-to-storage loss for the four pressure fields**. Conversely, an
exhaustive search for tyre/wheel temperature names (English and Chinese) found none.
The source catalogue has battery, cabin, outside, HVAC-setpoint, and coolant
temperatures, but no tyre temperature. Therefore there is no hidden tyre-temperature
reading that merely needs plumbing through the server.

Primary code evidence:

- `BYDMate-own/app/src/main/kotlin/com/bydmate/app/data/remote/DiParsClient.kt`
  (`DiParsData`, Di+ template, and parsing)
- `BYDMate-own/app/src/main/kotlin/com/bydmate/app/data/autoservice/FidRegistry.kt`
- `BYDMate-own/app/src/main/kotlin/com/bydmate/app/data/cloud/CloudTelemetryPayload.kt`
- `BYDMate-own/app/src/main/kotlin/com/bydmate/app/daemon/CommandDaemon.kt`
- `EvAcChargeTimer/src/lib/voltflowmate/ingest-payload.ts`
- `EvAcChargeTimer/src/lib/voltflowmate/telemetry-sanitizer.ts`
- `EvAcChargeTimer/supabase/migrations/20260814180000_diplus_soc_precise.sql`

## B. Per-wheel temperature and ambient substitute

**TPMS reports pressure only. It does not report a temperature per wheel anywhere
visible to this APK.** This is a direct field inventory, not an inference from missing
production values.

The best available temperature substitute is the car's outside/ambient reading:

- APK/normalized telemetry: `outsideTempC` -> wire/storage JSON key
  `telemetry.outside_temp_c`, degrees Celsius. The server sanitizer accepts only
  -60 to 70 °C.
- Di+ diagnostic field: `exteriorTemp` -> `diplus.exterior_temp_c` -> flat DB column
  `diplus_exterior_temp_c`, degrees Celsius. Unlike normalized
  `telemetry.outside_temp_c`, this Di+ column itself has no server clamp.
- `cabin_temp_c`, `inside_temp_c`, battery temperatures, and `ac_temp_c` are not valid
  tyre-temperature substitutes; `ac_temp_c` is a setpoint.

Ambient availability is numerically good but semantically limited. Of roughly 821k
usable TPMS rows during the live query, 796,801 (about 97%) also had sanitized
`telemetry.outside_temp_c`. By observed state, pairing was 100% for active rows,
95.43% for parked rows, and 0% for unknown-state rows. However ambient is whole-degree
car exterior temperature, not the air inside each tyre. It does not capture tyre heat
from driving/braking, solar loading, axle differences, or thermal lag. It is therefore
adequate as a coarse covariate, not precise temperature compensation for leak alerts.

## C. Cadence, parked coverage, and staleness

### Configured collection and delivery

- Main app polls Di+ every **1 second**.
- It queues full samples at 1 s while driving, 10 s while charging below 98%, 1 s in
  the charging tail, and 30 s while parked. State edges can force a sample.
- Driving/charging-tail batches normally flush every 15 s; bulk charging every 60 s;
  parked delivery defaults to 60 s.
- An unchanged parked sample may be `live_only` and update only the current snapshot.
  A full parked history sample is forced at least every **15 minutes**.
- When the app is killed at power-off, the daemon normally sends every **60 seconds**.
  It can send status-only every 3 s during an active live-view grant. When Di+ has been
  unreachable for 15 s, a direct autoservice fallback can provide tyres while parked
  or charging, but never while driving.

### What production actually shows

For usable TPMS rows, median stored-sample spacing was 1.204 s in active state,
1.932 s in parked state (p90 63 s), and 60 s when state was unknown. These are row
cadences, not evidence that a tyre sensor produced a fresh radio measurement each time;
the APK repeatedly samples and stores the current integer-kPa value and carries no TPMS
measurement timestamp.

Pressure tuples did change while parked: production contained 1,344 changes where both
the preceding and following classified rows were parked. Active-to-active changes
numbered 17,104. Across change events, the median interval was about 15.4 s in active
state and 4,532 s (about 75.5 min) in parked state. Those intervals combine true sensor
refresh, integer quantization, pressure stability, state transitions, and sparse
sleep-time delivery; they must not be presented as the TPMS hardware's specified radio
cadence.

### Sleep and stale values

After an observed power-off, the daemon deliberately holds a wake lock for at most
**30 minutes** while parked and unplugged. It then allows platform suspend to protect
the 12 V battery. The measured platform wake rhythm is approximately **15 minutes**,
but it is platform-controlled, not guaranteed by the app. Charging and an active live
view can keep the daemon awake.

There is no TPMS-specific TTL and no per-wheel `measured_at`. When the head unit is
suspended, the last four values remain in the latest snapshot until another payload
replaces them. Consequently their actual measurement age cannot be distinguished from
their row/snapshot age. The web app stops trusting the whole live snapshot as live after
**90 seconds**, labels contact within **20 minutes** as asleep, and labels older contact
stale. Thus the honest answer is: TPMS updates can continue for the first 30 minutes
after a detected shutdown and on later platform wakes, but once the platform suspends,
pressure is already an old last-known value; only the generic snapshot age (90 s live
trust threshold) quantifies that staleness.

## D. Production reality

All queries were `SELECT` statements with PostgreSQL
`default_transaction_read_only=on`. No names, aliases, API keys, or user identifiers
are recorded here.

### Fleet coverage and history

| Measure | Result |
|---|---:|
| Total raw telemetry rows at fleet query | 2,554,168 (increasing during inventory) |
| User/vehicle streams | 14 |
| Streams with any non-NULL TPMS | 12 (85.7%) |
| Streams with at least one usable all-four reading | 9 (64.3%) |
| Streams with zero-only TPMS | 3 |
| Streams with no TPMS | 2 |
| Rows with any TPMS / all four TPMS | 896,173 / 896,173 |
| Oldest telemetry row | 2026-05-18 05:57:26 UTC |
| Oldest non-NULL TPMS row | 2026-05-22 08:07:50 UTC |
| Newest TPMS at query time | 2026-08-28 13:25:51 UTC |

All four wheels had identical overall NULL rates, **64.909%** of all raw telemetry
rows. Every row that had any TPMS had all four columns non-NULL in this snapshot; there
was no partial-wheel NULL pattern. That does not make every four-value tuple usable:
three streams emitted only zeros.

Usable-history coverage is much narrower than the oldest date suggests:

- one stream has usable data from May 22;
- one begins July 18;
- six begin between July 29 and August 1;
- one has only four usable rows;
- the three zero-only streams have no usable history.

### Values and units

| Population | Wheel readings | Minimum | Median | Maximum |
|---|---:|---:|---:|---:|
| Raw non-NULL columns | 3,585,428 | 0 kPa | 245 kPa | 302 kPa |
| Plausibility slice used for inventory (`100..500`) | 3,282,116 | 107 kPa | 245 kPa | 302 kPa |

There were **303,596 zero wheel-readings**. The four-column tuples are otherwise in a
kPa-shaped physical range; 245 kPa equals 2.45 bar / about 35.5 psi. The 107 and 135 kPa
lows are possible severe underinflation but are suspicious enough that an analysis
must not silently treat every value above 100 as normal. The conversion preference
(`kPa`, `psi`, or `bar`) affects display only; storage remains kPa.

## E. Sanitizer exposure

TPMS is written raw, not clamped.

1. The Di+ APK parser applies explicit sanity filters to power, temperatures, and
   large integer sentinels, but calls plain `parseIntNum` for each tyre pressure.
2. Direct autoservice tyre reads accept any returned integer.
3. Zod accepts each pressure as a nullable/optional number.
4. `sanitizePayloadTelemetry` clamps selected keys in the normalized `telemetry`
   object and only range-checks `diplus.soc` in the `diplus` object. None of the four
   pressure keys appears in `numericTelemetryRules`.
5. The database mapping calls `bydmate_jsonb_numeric` and assigns the result directly
   to each `numeric` flat column.

The live UI has a display-only check (`isTyrePressureKpa` requires `> 100`), but that
does not protect persisted history or analytics. Production zero-only streams prove
the exposure is not theoretical.

## F. Retention

The current scheduled purge `purge_old_bydmate_telemetry_by_tier()` deletes entire
`bydmate_telemetry_samples` rows. TPMS has no separate table or rollup, so it is pruned
with each row:

- Free: **30 days** of raw telemetry/TPMS.
- Premium/Admin: retained while the account is active under the current repository
  documentation and migration chain.
- `bydmate_telemetry_hourly` retains longer-lived SOC/speed/power/temperature
  aggregates but has **no tyre-pressure columns**. It cannot reconstruct TPMS after
  raw-row deletion.

## Feature usefulness assessment

### 1. Pressure versus consumption

Eight streams have both substantial usable pressure and moving consumption data.
Per stream, paired moving rows range from about 8k to 96k, and pressure tuples vary
over time. Raw density is therefore sufficient to draw exploratory within-vehicle
plots.

It is not sufficient to claim a pressure effect robustly as a product feature. Rows at
1–2 s cadence are highly autocorrelated, so hundreds of thousands of rows are not
hundreds of thousands of independent observations. Only eight vehicles materially
contribute; histories are mostly about one month; free histories roll away; pressure
variation is coupled to ambient temperature and trips; and consumption is dominated by
speed, HVAC, route/terrain, traffic, load, and driving style. No durable rollup preserves
pressure for longer studies. Verdict: **exploratory analysis only, not a reliable
correlation feature from current data**.

### 2. Temperature-compensated slow-leak detector

The four wheels and parked observations are useful for self-baselining and cross-wheel
comparison, and the fleet demonstrates pressure changes during parked-to-park runs.
But the required compensating variable—per-wheel tyre temperature—does not exist.
Ambient is usually paired and could reduce seasonal/cold-front noise, yet it cannot
correct warm tyres after driving or unequal sun/brake heating. With 30-day free raw
retention, a long baseline is also fragile unless separately aggregated in the future.

Verdict: **the specified temperature-compensated detector is not safely buildable on
existing data alone**. It needs an actual tyre-temperature source (if the vehicle can
expose one) or a deliberately lower-confidence product definition that accepts ambient
proxy limitations. The latter would be a different feature and should not be described
as true temperature compensation.

## Reproduction query outline

The production measurements used only aggregate forms of these expressions:

```sql
-- Presence and field null rates
select count(*),
       count(distinct (user_id, vehicle_id)),
       count(*) filter (where diplus_tire_press_fl_kpa is null)
from public.bydmate_telemetry_samples;

-- Distribution (repeat for all four columns or unnest them together)
select min(kpa), percentile_cont(0.5) within group (order by kpa), max(kpa)
from (
  select unnest(array[
    diplus_tire_press_fl_kpa, diplus_tire_press_fr_kpa,
    diplus_tire_press_rl_kpa, diplus_tire_press_rr_kpa
  ]) as kpa
  from public.bydmate_telemetry_samples
) x
where kpa is not null;
```

The exact query session also grouped anonymized user/vehicle streams, paired pressure
with `telemetry.outside_temp_c` and
`telemetry.current_trip_consumption_kwh_100km`, and used `lag()` over device time to
measure stored-row and observed tuple-change intervals.
