# Materialised 12 V Auxiliary-Battery Daily Rollups

## Context

`bydmate_aux_voltage_daily` currently recomputes every requested day from raw
`bydmate_telemetry_samples`. A one-week `EXPLAIN (ANALYZE, BUFFERS)` took 105
seconds: the index scan took only 1.1 seconds, while the bitmap heap scan took
89.8 seconds to fetch 63,699 rows from 43,545 heap blocks (about 353 MB at about
4 MB/s). Concurrent inserts scatter one vehicle's samples across the heap at
about 1.5 relevant rows per block. Another index cannot remove those heap reads.
The authenticated role has an 8-second `statement_timeout`, so week, month,
quarter, and year requests return 500 and are temporarily disabled.

The solution is a server-owned daily aggregate that reads each completed UTC day
once and serves longer ranges without returning to the raw telemetry heap.

## 1. Server-only schema

Create `public.bydmate_aux_voltage_daily_rollups` with:

| Column | Type | Purpose |
| --- | --- | --- |
| `user_id` | `uuid not null` | Owner of the telemetry. |
| `vehicle_id` | `text not null` | Telemetry vehicle identifier (`cars.vehicle_alias`). |
| `date` | `date not null` | Completed UTC day represented by the row. |
| `v_min` | `numeric` | Minimum sanitized auxiliary voltage for the day. |
| `v_max` | `numeric` | Maximum sanitized auxiliary voltage for the day. |
| `v_resting` | `numeric` | Median of samples that pass resting qualification and the chemistry ceiling. |
| `resting_sample_count` | `integer not null` | Number of samples included in `v_resting`. |
| `battery_chemistry` | `text` | Effective chemistry used for the computation, including model fallback. |
| `resting_ceiling_v` | `numeric` | Exact ceiling used; nullable for `other`. |
| `computed_at` | `timestamptz not null default now()` | Rollup freshness and audit timestamp. |

The primary key is `(user_id, vehicle_id, date)`. That key is also the reader's
required access path, so no second range index is initially necessary. If
maintenance needs to find stale chemistry rows independently of a vehicle, add a
secondary `(user_id, vehicle_id, battery_chemistry, resting_ceiling_v)` index
only after measuring that query.

The table is server-only: enable RLS, grant no direct write privileges to Mate,
`anon`, or `authenticated`, and revoke default access. Maintenance functions are
internal `SECURITY DEFINER` functions with a fixed `search_path`, explicit
`PUBLIC` execute revocation, and execute granted only to `service_role`/the cron
owner. The public analytics RPC remains `SECURITY INVOKER` and performs the
ownership-scoped read. Mate never writes this table, avoiding a second
implementation of parked/resting detection alongside the server.

A second server-only queue table,
`public.bydmate_aux_voltage_rollup_queue`, contains `(user_id, vehicle_id, date)`,
`reason`, `enqueued_at`, attempt metadata, and an optional last error. Its primary
key is `(user_id, vehicle_id, date)`, making enqueue idempotent.

## 2. Incremental completed-day population

A one-day maintenance function accepts one user, vehicle, and UTC date. It:

1. Rejects the current or a future UTC date.
2. Reads only `[date - 2 hours, date + 1 day)` from raw telemetry. The preceding
   two hours preserve the existing parked-interval qualification across midnight;
   only samples within `date` contribute to the output.
3. Applies the current RPC's voltage sanitization, parked/unplugged predicate,
   two-hour resting qualification, and effective chemistry ceiling.
4. Upserts exactly one rollup row and removes the corresponding queue item in the
   same transaction.

Where semantics are identical, calculation will prefer the flat
`diplus_speed_kmh`, `diplus_power_kw`, and `diplus_charge_gun_state` columns and
fall back to JSON for legacy rows. `charge_power_kw` remains JSON because there
is no equivalent flat column. Sanitized `telemetry.aux_voltage_v` remains the
source for min/max, while resting voltage retains the existing
`diplus_voltage_12v` fallback; merging those intentionally distinct sources
would break parity.

A `pg_cron` scheduler, not telemetry ingestion, triggers the work. After a UTC
day is complete, it enqueues that date for vehicles having telemetry in the
completed day. A separate bounded worker claims a small number of queue rows
using `FOR UPDATE SKIP LOCKED` and computes one vehicle-day at a time. Retry-safe
upserts and the queue primary key make repeated cron invocations harmless. Heavy
aggregation therefore never runs on the telemetry ingest hot path.

## 3. Chemistry staleness

The effective ceiling is:

| Effective chemistry | Ceiling |
| --- | --- |
| `flooded` | 12.9 V |
| `efb` | 13.0 V |
| `agm` | 13.1 V |
| `lifepo4` | 13.5 V |
| `other` | `NULL` |

Each row stores the effective chemistry and exact ceiling used. A median cannot
be reconstructed from a stored median, so changing chemistry never updates the
stored value arithmetically.

An `AFTER UPDATE OF battery_chemistry, model_generation` trigger on `cars`
compares the old and new effective chemistry/ceiling. If either changes, it
enqueues every already-materialised date for that vehicle for one-day
recomputation. `model_generation` is included because it supplies the effective
chemistry when `battery_chemistry` is null. Until recomputation finishes, the
reader excludes rows whose stored provenance differs from the vehicle's current
effective chemistry/ceiling; a temporary gap is preferable to a stale median.

## 4. Chunked backfill and runtime

Backfill uses an administrative enqueue function with one vehicle and a bounded
date range. It generates queue entries but does not aggregate the range inline.
The worker processes each `(user, vehicle, date)` as an independent transaction,
so progress survives timeouts and failures. Batch size remains configurable and
starts conservatively at one vehicle-day per worker invocation; it is increased
only after production timings demonstrate safe headroom.

Observed timings bound the estimate:

- The 105-second one-week query is about 15 seconds per vehicle-day on cold,
  scattered history.
- A 90-day query exceeded 180 seconds, establishing a lower observed average of
  more than 2 seconds per vehicle-day.

Plan on **2-15 seconds per vehicle-day**. Thus one vehicle-year is approximately
12-91 minutes, and 100 vehicle-years approximately 20-152 hours. Before starting
a production backfill, count the actual eligible vehicle-days and report
`vehicle_days * 2-15 seconds` as the estimated range. Time representative recent
and old one-day chunks to refine it. Backfill must remain throttled and resumable;
it must never run as one 90-day or whole-history statement.

## 5. Stable reader API

The public signature remains unchanged:

```sql
public.bydmate_aux_voltage_daily(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  date date,
  v_min numeric,
  v_max numeric,
  v_resting numeric,
  resting_sample_count integer
)
```

Only its implementation changes to an indexed read of matching, chemistry-current
rollup rows. Consequently the chart and PR #24's alerts cron require no caller
changes, and restoring week/month/quarter/year is a small revert of PR #25's
temporary unavailable state.

## 6. Parity proof before switching readers

Before replacing the public RPC body, preserve its current raw-sample SQL as a
restricted baseline function. Do not compare the rollup with the rewritten RPC,
a view over the rollup, or values captured after the switch.

For representative completed UTC days, the verification will:

1. Invoke the preserved raw baseline for exactly `[day 00:00 UTC, next day 00:00
   UTC)`, adapting the baseline's inclusive upper-bound predicate so the midnight
   sample cannot be attributed to both days.
2. Compute the same day through the one-day materializer.
3. Full-join baseline and rollup on `date` and compare `v_min`, `v_max`,
   `v_resting`, and `resting_sample_count` with `IS DISTINCT FROM` so nulls and
   missing rows are visible.
4. Require zero mismatches before changing the public reader.

The sample set must include parked intervals crossing midnight, days with no
resting samples, sanitized voltage with Di+ fallback, sparse and dense days, and
all effective chemistry ceilings. The comparison SQL and its output will be
saved with the rollout evidence, explicitly identifying the preserved pre-change
RPC as the baseline. Reader performance will then be checked under the
8-second authenticated timeout.

No production schema change, backfill, or reader switch occurs without a
separate check-in and approval.
