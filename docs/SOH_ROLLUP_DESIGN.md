# Materialised SOH Daily Rollups

## Status and scope

This design is approved. Production rollout phases 1 through 4 completed on
2026-09-04: the schema is installed, production parity is exact, all 404
eligible retained vehicle-days are populated with zero gaps, the three cron
jobs are active, and the premium-gated rollup reader is live. The reader switch
includes the section 5 retention gate and passed its entitlement and production
performance gates. Phase 5, the client range and error/empty-state change,
remains outside this rollout phase and must not be inferred from the database
reader status.

The database performance change and the client error/range correction are two
independently landable changes. The database reader keeps its existing public
interface, so neither change has to wait for the other.

## Context

Before the phase 4 reader switch, `bydmate_soh_daily` scanned
`bydmate_telemetry_samples`, parsed
`telemetry.soh_percent`, sorted raw rows by UTC date and descending device time,
and took one row per day. For the owner vehicle's rolling-year window, the
planner estimated 187,718 candidate index entries. The authenticated production
call exceeded the 8-second `statement_timeout` and returned HTTP 500 instead of
rows.

This is the same scattered-heap-read failure already solved for auxiliary
voltage. The SOH implementation should reuse that proven module shape: a
server-owned daily table, an idempotent one-day materialiser, an idempotent
queue, bounded workers, chunked backfill, independent retention, and a stable
ownership-scoped reader.

### Production predicate-plan finding

The current nullable predicate is independently harmful. A production generic-
plan reproduction of the function body with:

```sql
user_id = $1 and ($2 is null or vehicle_id = $2)
```

used `bydmate_telemetry_samples_user_time_idx` on user and time, then applied
vehicle and SOH as heap filters. The `OR` prevented the tenant+vehicle keys from
forming an index condition. This confirms that optional vehicle scope must be
implemented as two explicit query branches, not one nullable `OR`.

That predicate repair is worthwhile but is **not sufficient** for year history.
The same year query with concrete `user_id = ... and vehicle_id = ...` did use
`bydmate_telemetry_samples_user_vehicle_device_unique`, yet still timed out at
8.12 seconds after selecting an estimated 193,656 raw rows. The original shape
with the SOH partial index also timed out at 8.10 seconds. Therefore there is no
evidence that a predicate-only hotfix makes the owner year query safe; the
rollup remains necessary for both performance and retention.

## 1. Stable reader interface

The external seam remains unchanged:

```sql
public.bydmate_soh_daily(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  device_time timestamptz,
  soh_percent numeric
)
```

It remains `STABLE`, `SECURITY INVOKER`, and ownership-scoped by RLS. Callers do
not learn about queues, backfill, retention, or materialisation. Keeping this
interface makes the database module deep: the operational complexity stays
local to Postgres while all existing callers retain the same contract.

After the reader switch, completed interior UTC days come from the rollup
primary key. Explicit timestamp windows cover the two most recent UTC dates so
the previous day remains available while cron catches up, and cover any partial
historical boundary dates. These bounded raw lookups are necessary because the
existing RPC exposes current values immediately and supports partial boundary
days. The raw work is a small fixed number of tenant-bound day probes and does
not grow with the requested history range.

The reader returns rows ordered by `device_time`, exactly as today. It must not
silently substitute `bydmate_live_snapshots`: live snapshots carry SOH forward
and therefore do not have the same semantics as the raw baseline.

Implement the nullable `p_vehicle_id` interface with explicit branches:

- non-null: `user_id = p_user_id and vehicle_id = p_vehicle_id`;
- null: `user_id = p_user_id` across that user's vehicles.

Do not retain `(p_vehicle_id is null or vehicle_id = p_vehicle_id)` in either
the rollup reader or its bounded raw current-day path. Add a secondary
`(user_id, date, vehicle_id)` rollup index for the supported all-vehicles branch;
the primary key already serves the single-vehicle branch.

The supported analytics ranges use complete UTC-day boundaries except for the
current day. If future callers request arbitrary partial historical days, the
interface must either document full-day rounding or add bounded raw reads for
both partial boundary days; it must not return a full-day rollup for a partial
historical interval.

## 2. Server-only schema

Create `public.bydmate_soh_daily_rollups`:

| Column | Type | Purpose |
| --- | --- | --- |
| `user_id` | `uuid not null` | Owner of the telemetry. |
| `vehicle_id` | `text not null` | Mate telemetry vehicle identifier. |
| `date` | `date not null` | Completed UTC day represented by the row. |
| `device_time` | `timestamptz not null` | Timestamp of the selected latest valid sample. |
| `soh_percent` | `numeric not null` | SOH from that exact source sample. |
| `computed_at` | `timestamptz not null default now()` | Materialisation audit timestamp. |

The primary key is `(user_id, vehicle_id, date)`. It is the single-vehicle
reader's range access path. Add `(user_id, date, vehicle_id)` for the existing
nullable-vehicle interface's all-vehicles branch. Constraints require
`soh_percent between 0 and 100` and require `device_time` to fall within the UTC
`date`; these defend the stored invariant without changing source selection.

Create `public.bydmate_soh_rollup_queue`:

| Column | Type | Purpose |
| --- | --- | --- |
| `user_id` | `uuid not null` | Owner to process. |
| `vehicle_id` | `text not null` | Vehicle to process. |
| `date` | `date not null` | Completed UTC day to process. |
| `reason` | `text not null` | Enqueue, backfill, retry, or repair provenance. |
| `enqueued_at` | `timestamptz not null` | Claim ordering. |
| `attempts` | `integer not null default 0` | Bounded retry accounting. |
| `last_attempt_at` | `timestamptz` | Operational visibility. |
| `last_error` | `text` | Sanitised most recent failure. |

Its primary key is `(user_id, vehicle_id, date)`, making enqueue idempotent. A
claim index follows the auxiliary queue's `(attempts, enqueued_at, user_id,
vehicle_id, date)` shape.

Both tables are server-only: enable RLS; revoke direct access from `PUBLIC`,
`anon`, and `authenticated`; grant no Mate write path. Internal maintenance
functions are `SECURITY DEFINER` with a fixed `search_path`, explicit `PUBLIC`
execute revocation, and execute granted only to the cron owner and
`service_role`. The public reader stays `SECURITY INVOKER`.

## 3. Exact one-day materialisation

`bydmate_materialize_soh_day(p_user_id, p_vehicle_id, p_date)` accepts exactly
one completed UTC day and rejects the current or a future day. It reads the
half-open interval `[p_date 00:00 UTC, p_date + 1 day 00:00 UTC)` and applies the
current definition exactly:

```sql
telemetry ? 'soh_percent'
and public.bydmate_jsonb_numeric(telemetry, 'soh_percent') between 0 and 100
order by device_time desc
limit 1
```

It stores that row's unmodified `device_time` and parsed numeric SOH. If no row
qualifies, it deletes any existing rollup for that key so recomputation cannot
leave stale data. It then removes its queue item in the same transaction.

Every raw lookup in this function must contain equality predicates on both
`user_id` and `vehicle_id`, plus the one-day time bounds. Production
`EXPLAIN (ANALYZE, BUFFERS)` for this shape used
`bydmate_telemetry_samples_soh_analytics_idx`, read five shared buffers, and
returned the latest valid row in **10.568 ms**. This plan is the implementation
gate: a BRIN scan or a plan whose index condition omits either tenant key is a
failure, even if a small fixture runs quickly.

There is no extra averaging, rounding, carry-forward, sampling, or fallback to
another field. Those would change the product meaning and fail parity.

The current table has a unique `(user_id, vehicle_id, device_time)` index, so a
vehicle cannot have two raw rows tied at the selected timestamp. The proposed
ordering therefore matches the existing `DISTINCT ON` tiebreak exactly. If that
uniqueness invariant is ever removed, both the preserved baseline and
materialiser must gain the same deterministic secondary ordering before either
definition changes.

## 4. Queueing and scheduling

The queue module mirrors the auxiliary implementation:

- `bydmate_enqueue_soh_day(date)` drives from configured `(cars.user_id,
  cars.vehicle_alias)` pairs and performs a tenant-and-vehicle-bound lateral
  existence probe for the completed day before inserting queue keys
  idempotently. It must not discover vehicles with one unscoped vehicle/time or
  time-only raw scan.
- `bydmate_enqueue_soh_backfill(user, vehicle, from_date, to_date)` enqueues a
  bounded date range; it never aggregates that range inline. Its eligibility
  probes use equality on the supplied user and vehicle for every day.
- `bydmate_process_soh_rollup_queue(limit default 1)` claims work with `FOR
  UPDATE SKIP LOCKED` and processes one vehicle-day per transaction/invocation.
- failures increment attempt metadata and remain observable and retryable.
- `purge_old_bydmate_soh_rollups()` enforces only SOH rollup retention.

Do not run aggregation on telemetry ingestion. Queueing from `pg_cron` keeps
ingest latency independent of analytics maintenance.

The existing auxiliary jobs run at `10 0 * * *`, every five minutes, and
`30 3 * * *`. Scheduling SOH jobs at those exact instants is a bad idea: it
would deliberately align two raw heap readers and their purge jobs. Use the same
cadence but stagger it:

| Job | Proposed UTC schedule | Purpose |
| --- | --- | --- |
| `enqueue-bydmate-soh-daily` | `15 0 * * *` | Enqueue the newly completed UTC day after auxiliary enqueue. |
| `process-bydmate-soh-rollups` | `2,7,12,17,22,27,32,37,42,47,52,57 * * * *` | Process one queued vehicle-day, offset from auxiliary processing. |
| `purge-bydmate-soh-rollups` | `35 3 * * *` | Enforce SOH retention after the auxiliary purge starts. |

The explicit minute list avoids depending on stepped-range support. Job
creation must be idempotent and must not replace or rename the auxiliary jobs.

## 5. Retention

Keep SOH daily rollups for **five years**, independent of account tier and raw
telemetry retention.

This is required for the feature to become truthful: free-tier raw telemetry is
deleted after 30 days and premium raw telemetry after 365 days, so a year trend
for a free vehicle is impossible by construction today. One narrow row per
vehicle/day is inexpensive, and five years matches the proven auxiliary policy
while providing a meaningful long-term battery-degradation horizon.

`purge_old_bydmate_telemetry_by_tier` must never delete SOH rollups. The SOH
purge is separate, deletes only dates older than five years, and is safe to rerun.
Changing five years later requires an explicit product decision backed by table
and index size measurements.

### Premium read gate (decided)

SOH history beyond the free-tier raw window is a premium feature. The rollup
table still retains five years for every account, but retention and visibility
are deliberately separate policies. `bydmate_soh_daily` must enforce the tier
gate explicitly; raw telemetry deletion must never be the access-control
mechanism.

At the start of each statement, resolve entitlement with the existing
`public.is_user_premium(p_user_id, statement_timestamp())`, which includes
admins, permanent premium flags, and unexpired `premium_until` terms. Derive one
effective lower bound and use it in **both** the rollup and bounded-raw branches:

```sql
v_effective_from := case
  when public.is_user_premium(p_user_id, statement_timestamp()) then p_from
  else greatest(p_from, statement_timestamp() - interval '30 days')
end;
```

Return immediately when `p_to < v_effective_from`. Every timestamp and full-day
eligibility predicate in the reader must use `v_effective_from`, not the
caller-supplied `p_from`, so a free account cannot recover an older rollup row
through a partial boundary or nullable-vehicle branch. RLS remains responsible
for ownership; this lower bound is the separate product-entitlement gate.

Reader-phase tests must cover free, permanent-premium, active-term, expired-term,
and admin users. They must prove that free users receive no points older than
the exact 30-day cutoff even while those rows remain stored, while entitled
users can read the full requested range up to the five-year rollup retention.
Production parity comparisons must distinguish intentional free-tier filtering
from aggregation mismatches and still require exact timestamp/value parity
inside the entitled window.

## 6. Chunked backfill

Backfill is limited by what raw retention still contains; deleted free-tier SOH
cannot be reconstructed. Before enqueueing anything in production, count actual
distinct eligible `(user_id, vehicle_id, UTC date)` keys after applying the
30/365-day tier bounds and the exact valid-SOH predicate. Report free and premium
counts and measure representative recent/old one-day materialisations.

Then enqueue bounded keys and process one vehicle-day per transaction. Start
with a one-second pause between manual worker invocations, as the successful
auxiliary rollout did, and increase throughput only after observing ingest wait
times. Record start/end times, successes, failures, remaining queue depth, and
coverage gaps. Never run a whole-history aggregation or a single large backfill
transaction.

The eligibility count itself must preserve tenant scope. Drive it from the
bounded configured vehicle set and use tenant-bound lateral day probes, or run
one explicitly tenant-bound query per vehicle. Do not use an apparently small
`distinct vehicle/day` result as justification for an unscoped raw scan: the
work is determined by source rows read, not result rows returned.

Because the source selection is only latest-valid-per-day, SOH materialisation
should be cheaper than auxiliary resting-voltage computation, but that is a
measurement hypothesis, not permission to remove throttling.

## 7. Production parity proof

Parity against fixtures is useful for syntax and edge cases but is not the
acceptance proof. The reader cannot switch until a production-data comparison
returns zero mismatches.

### Preserve the real baseline

Before rewriting `bydmate_soh_daily`, copy its current raw SQL verbatim into a
restricted `bydmate_soh_daily_raw_baseline` function. It must read raw telemetry
directly and must not reference the rollup table, a rollup-backed view, or the
rewritten reader. Revoke public execution and permit only the migration/parity
operator.

For a completed UTC day, call the inclusive-upper-bound baseline with:

```sql
p_from := day at time zone 'UTC';
p_to := (day + 1) at time zone 'UTC' - interval '1 microsecond';
```

The one-microsecond subtraction prevents a midnight sample from being assigned
to both days, matching the half-open materialiser interval.

### Production sample set

Choose anonymised production vehicle-days covering at least:

- dense and sparse SOH days;
- values at the valid boundaries 0 and 100 if production contains them;
- invalid, nonnumeric, missing, and null SOH samples where present;
- a day containing valid and invalid samples, proving latest **valid** wins;
- a sample at or nearest UTC midnight;
- a day with no valid SOH, proving both sides omit the row;
- every production vehicle with retained SOH when the bounded set is small
  enough, otherwise all 14 vehicles across representative days.

Freeze baseline results before invoking the materialiser. In one read-only-safe
verification transaction, materialise selected days, full-join frozen baseline
rows to rollups on `(user_id, vehicle_id, date)`, and compare `device_time` and
`soh_percent` using `IS DISTINCT FROM`. Roll back the transaction after
capturing anonymised evidence so the proof itself makes no persistent production
change.

Require:

- mismatch count: **0**;
- missing rollup rows: **0** where baseline has a row;
- extra rollup rows: **0** where baseline has none;
- exact timestamp equality, not merely the same SOH number;
- exact numeric equality with no rounding tolerance.

Commit the executable local parity test and record production output in
`docs/SOH_ROLLUP_PARITY_EVIDENCE.md`. A fixture-only pass is insufficient.

### Post-backfill and reader performance gates

Before switching the public reader:

1. Compare the complete eligible production set to rollups and require zero
   gaps/extras.
2. Require zero permanently failed queue items and explain any retries.
3. Execute the future reader directly as `authenticated` with RLS and the
   8-second timeout for day, week, month, quarter, and year.
4. Test the current-day union path separately.
5. Capture `EXPLAIN (ANALYZE, BUFFERS)` for one-day materialisation, daily
   enqueue eligibility, and backfill eligibility. Require tenant+vehicle index
   conditions and reject BRIN/time-only scans.
6. Test the Analytics page under normal sibling-panel load, because a fast SQL
   query can still wait on a starved connection pool.

## 8. Phased rollout and rollback

Keep deployment phases separable:

1. **Schema phase:** create tables, queue functions, materialiser, purge, and the
   preserved raw baseline. Do not change the public reader or schedule jobs.
2. **Proof phase:** run local tests and rolled-back production parity; publish
   evidence. Stop on any mismatch.
3. **Population phase:** enqueue the measured eligible set, run throttled
   backfill, verify complete coverage, then register staggered cron jobs. Keep
   the old reader active.
4. **Reader phase:** replace only the implementation of `bydmate_soh_daily` and
   verify authenticated timings plus full-page behavior.
5. **Client phase:** land the independently tested error/range correction.

Reader rollback is a `CREATE OR REPLACE` restoration from the preserved raw
baseline body; populated rollups and queue state can remain for diagnosis. Cron
jobs can be unscheduled independently. No destructive table cleanup belongs in
the emergency rollback path.

All migration SQL must be idempotent because self-hosted production has no
`supabase_migrations.schema_migrations` tracking table.

## 9. Independent client correction

Land the client work as a separate commit or PR from the database rollup.

### Error versus empty

Render three distinct outcomes:

- loading: skeleton;
- failed request: explicit localized error copy such as "Couldn't load SOH
  history" plus a retry action;
- successful empty response: "No SOH history available yet."

The server route should preserve safe diagnostic context in logs while returning
a stable user-safe error response. Tests must assert that an HTTP 500 reaches
the error branch and that an empty `points` response reaches only the empty
branch.

### Selected range (decided)

SOH follows the Analytics range selection. Remove the hardcoded year; pass
`range` through the hook, query key, route, and `fetchSohTelemetryHistory`,
validate it with the existing range parser, and use
`resolveTelemetryWindow(range, anchorDate)`.

This makes the interface match what the page communicates, avoids surprising
users, and makes cache entries range-correct. When fewer than two points exist,
the panel presents the latest value without trend language or a misleading
single-point trend visualization.

## 10. Deliberate non-goals

- Do not derive missing historical SOH or carry values between days.
- Do not write SOH rollups from Mate or telemetry ingestion.
- Do not add SOH to the client-written hourly rollup table.
- Do not fix `bydmate_phantom_drain_daily` in this change; profile and design it
  separately even though it can still starve the page pool.
- Do not claim five years of immediate history: history begins with retained
  backfill and accumulates after rollout.
