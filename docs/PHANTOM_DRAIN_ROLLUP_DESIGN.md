# Materialised Phantom-Drain Daily Rollups

## Status and safety boundary

Design date: **2026-09-04**.

Shipped on **2026-09-10** after production parity proof and a bounded backfill.
Schema migration `20260908120000` supplies the table, queue, materialiser, and
frozen baseline; `20260910160000` activates the reader and maintenance schedule;
`20260910161000` keeps the baseline private while inlining the same bounded raw
boundary calculation for the security-invoker reader. Evidence is recorded in
[`PHANTOM_DRAIN_ROLLUP_PARITY_EVIDENCE.md`](PHANTOM_DRAIN_ROLLUP_PARITY_EVIDENCE.md).

## Owner-decided product policies

### Premium read gate: one calendar month for free users

The rollup reader needs the same explicit entitlement boundary as SOH. The UI
currently requests only the latest 14 days, so normal free users will see no
change. However, the public RPC accepts arbitrary `p_from` and `p_to` values.
Once rollups outlive raw telemetry, an authenticated free user could call that
RPC directly for history that the 30-day raw purge makes unavailable today.

The reader must therefore derive one effective lower bound with
`is_user_premium(p_user_id, statement_timestamp())`. Free users are limited to
the exact trailing **one calendar month**; entitled users retain the caller's
requested lower bound. This is an access rule, not an accidental consequence
of raw deletion. The rule must also cover direct table reads through RLS so the
RPC cannot be bypassed through PostgREST.

The implementation uses PostgreSQL `interval '1 month'`, not
`interval '30 days'`. This is a deliberate product distinction from SOH's
30-day free cutoff. At month boundaries the phantom window therefore spans
28, 29, 30, or 31 days while preserving the statement's time of day. All
entitlement tests must freeze the statement timestamp so the exact cutoff is
deterministic.

### Rollup retention: five calendar years

Retain phantom-drain rollups for **five calendar years**, independently of raw
telemetry retention.

This is not chosen merely because SOH uses five years. Phantom drain is strongly
seasonal and can change after vehicle firmware, Mate releases, accessory
changes, and gradual battery ageing. Five annual cycles support meaningful
year-over-year diagnosis across a normal ownership period. The maximum current
fleet footprint is only 14 vehicles × 1,826 days = **25,564 daily keys**, before
excluding days with no eligible drain. That is negligible beside the raw sample
volume causing the present timeout.

Five years is an upper retention boundary, not a promise that five years can be
backfilled: initially only retained raw days can be reconstructed. A dedicated
idempotent `purge_old_bydmate_phantom_drain_rollups()` function deletes only
rollup dates strictly older than five calendar years. Its predicate is:

```sql
date < (
  (statement_timestamp() at time zone 'UTC')::date - interval '5 years'
)::date
```

It is safe to rerun and does not touch the queue or raw telemetry. Conversely,
`purge_old_bydmate_telemetry_by_tier` must never delete from the phantom-rollup
table. Raw retention and rollup retention remain separate policies. Any later
retention change requires an explicit product decision and measured table/index
size.

## Context and measured failure

The panel calls the unchanged public reader with the owner, vehicle, and a
rolling 14-day timestamp window:

```sql
public.bydmate_phantom_drain_daily(
  p_user_id,
  p_vehicle_id,
  now() - interval '14 days',
  now()
)
```

The function scans `bydmate_telemetry_samples`, classifies every source row,
runs ordered window passes, groups parked intervals, then aggregates them by UTC
day. Its predicate is already correct: exact `user_id`, `vehicle_id`, and time
bounds, with no nullable OR and no `generate_series`.

A production one-day plan used
`bydmate_telemetry_samples_user_vehicle_device_unique`, but still fetched 8,445
rows from 5,048 heap blocks and spilled a 4,384 kB external sort. It took
3.689 seconds cold and 499.683 ms warm. The real 14-day RPC was cancelled by the
live eight-second statement timeout in 8.045 seconds.

Before PR #38, that failure triggered a paginated raw fallback and eventually
returned HTTP 200 in 17.9 seconds under normal sibling load, hiding the timeout
as empty data. PR #38 removed that amplification and made the failure visible;
it did not make the underlying reader faster.

## 1. Frozen raw baseline

Production was read directly on 2026-09-04. The deployed function is `STABLE`,
`SECURITY INVOKER`, has 2,449 bytes of `prosrc`, and has this source identity:

```text
md5(prosrc) = e15b2fe97744739e7822b5489ed96888
```

It matches the definition in
`20260826172117_aux_voltage_daily.sql`. Schema phase must copy that source
verbatim to the restricted function:

```sql
public.bydmate_phantom_drain_daily_raw_baseline(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  date date,
  soc_start numeric,
  soc_end numeric,
  drain_percent numeric,
  idle_hours numeric
)
```

The frozen semantic contract is:

1. Read only the caller's exact user, vehicle, and inclusive timestamp window.
2. Parse `telemetry.soc` with `bydmate_jsonb_numeric`; do not add a 0–100
   filter that the baseline does not have.
3. Classify parked samples with the shared
   `bydmate_is_parked_unplugged(telemetry, diplus_charge_gun_state)` function.
4. Start a new parked interval when the previous sample is not parked, the UTC
   date changes, timestamps do not increase, or the gap is at least six hours.
5. Build SOC endpoints from the first and last **nonnull parsed SOC** inside
   each parked interval. Missing, null, and nonnumeric SOC samples remain in the
   interval timing but not in the endpoint array.
6. Keep only intervals lasting at least four hours whose first SOC is greater
   than their last SOC.
7. For each UTC date, return the first eligible interval's start SOC, the last
   eligible interval's end SOC, the exact sum of interval drains, and the exact
   sum of eligible interval durations in hours.

The UTC-date change deliberately splits a parked stretch at midnight. The
rollup must preserve that behavior; carrying an interval across midnight would
be a parity bug. The baseline must never be rewritten to reference the rollup
table or a rollup-backed view. Revoke execution from `PUBLIC`, `anon`, and
`authenticated`; grant it only to the migration/parity operator.

## 2. Server-owned schema

Create `public.bydmate_phantom_drain_daily_rollups`:

| Column | Type | Purpose |
| --- | --- | --- |
| `user_id` | `uuid not null` | Telemetry owner. |
| `vehicle_id` | `text not null` | Mate vehicle identifier. |
| `date` | `date not null` | Completed UTC day. |
| `soc_start` | `numeric not null` | First eligible interval's first valid SOC. |
| `soc_end` | `numeric not null` | Last eligible interval's last valid SOC. |
| `drain_percent` | `numeric not null` | Sum of positive interval SOC losses. |
| `idle_hours` | `numeric not null` | Sum of eligible parked-interval durations. |
| `computed_at` | `timestamptz not null default now()` | Audit timestamp. |

Use `(user_id, vehicle_id, date)` as the primary key. That is the reader and
materialiser access path; no second range index is justified initially. Do not
add SOC range constraints: the current reader accepts any numeric SOC and parity
must preserve that behavior. Constraints may require `drain_percent > 0`,
`idle_hours >= 4`, and a completed UTC date because those follow directly from
the frozen calculation.

Create `public.bydmate_phantom_drain_rollup_queue`:

| Column | Type | Purpose |
| --- | --- | --- |
| `user_id` | `uuid not null` | Owner to process. |
| `vehicle_id` | `text not null` | Vehicle to process. |
| `date` | `date not null` | One completed UTC day. |
| `reason` | `text not null` | Daily, backfill, retry, or repair provenance. |
| `enqueued_at` | `timestamptz not null` | Claim order. |
| `attempts` | `integer not null default 0` | Retry accounting. |
| `last_attempt_at` | `timestamptz` | Operational visibility. |
| `last_error` | `text` | Sanitised latest failure. |

Its primary key is also `(user_id, vehicle_id, date)`, so enqueue uses
`INSERT ... ON CONFLICT` and is idempotent. Add the proven claim index on
`(attempts, enqueued_at, user_id, vehicle_id, date)`.

Both tables are server-owned and have RLS enabled. Grant no writes to Mate,
`anon`, or `authenticated`. The queue has no authenticated read policy. The
rollup table may be selected by authenticated callers only through an
ownership-and-tier RLS policy:

- `(select auth.uid()) = user_id`; and
- premium/admin may read retained dates; otherwise only full UTC dates strictly
  after the date containing the exact one-calendar-month cutoff are directly
  visible.

The cutoff date itself is excluded from direct rollup reads because its stored
daily aggregate can include samples older than the exact timestamp cutoff. The
public reader reconstructs only the allowed part of that boundary date from
bounded raw telemetry. This keeps direct table access from bypassing the reader
gate while allowing the public reader to remain `SECURITY INVOKER`.

Maintenance functions are `SECURITY DEFINER`, set an explicit `search_path`,
revoke `PUBLIC` execution, and grant execution only to `service_role` and the
cron owner.

## 3. Exact one-day materialiser

`bydmate_materialize_phantom_drain_day(p_user_id, p_vehicle_id, p_date)` accepts
exactly one completed UTC day and rejects null identities, a blank vehicle, and
the current or a future UTC date.

It runs the frozen calculation over the half-open interval
`[p_date 00:00 UTC, p_date + 1 day 00:00 UTC)`. No lookbehind is used: the
baseline itself starts a new interval whenever the UTC date changes, so a prior
day's sample cannot belong to the materialised interval.

Every source query includes equality on `user_id` and `vehicle_id` plus those
one-day bounds. It calls the shared parked predicate exactly. It must not copy
that predicate, prefer flat Di+ motion values, add a fallback, clamp SOC, round
results, carry SOC between intervals, or merge intervals separated by six
hours. Production AUX parity already showed that changing motion-field
precedence changes parked classification.

The operation is retry-safe:

1. Delete any previous rollup row for the exact key.
2. Insert the one row returned by the frozen calculation, if any.
3. Delete the corresponding queue item in the same transaction.

If no interval qualifies, step 1 deliberately leaves no rollup row. This proves
recomputation cannot leave a stale positive-drain day after source data or
classification changes.

## 4. Queue, bounded worker, and schedules

Provide two enqueue seams, neither of which aggregates:

- `bydmate_enqueue_phantom_drain_day(p_date)` drives from configured
  `(cars.user_id, cars.vehicle_alias)` pairs and runs one tenant-, vehicle-, and
  day-bound `EXISTS` probe for each pair before idempotently queueing yesterday.
- `bydmate_enqueue_phantom_drain_key(p_user_id, p_vehicle_id, p_date, p_reason)`
  queues at most one explicitly supplied key after one equally bounded existence
  probe. Backfill orchestration calls this one date at a time.

There is intentionally **no date-range enqueue function and no
`generate_series`**. In particular, do not copy
`bydmate_enqueue_soh_backfill`; its apparently bounded series still produced
the wrong execution shape in production.

`bydmate_process_phantom_drain_rollup_queue()` claims exactly one row ordered by
attempt count and enqueue time with `FOR UPDATE SKIP LOCKED`. One invocation is
one vehicle-day transaction. Success removes the queue key; failure increments
attempt metadata, stores a bounded error string, and leaves the item observable
for retry. Cap automatic attempts at five. Do not offer a multi-day batch that
would silently put several materialisations in one transaction.

Do not align the new raw reader with AUX or SOH maintenance:

| Job | Proposed UTC schedule | Purpose |
| --- | --- | --- |
| `enqueue-bydmate-phantom-drain-daily` | `18 0 * * *` | Queue the completed day after SOH enqueue. |
| `process-bydmate-phantom-drain-rollups` | `4,9,14,19,24,29,34,39,44,49,54,59 * * * *` | Process one key, offset from AUX and SOH workers. |
| `purge-bydmate-phantom-drain-rollups` | `40 3 * * *` | Apply independent five-year retention. |

Job registration is a separate migration after population proof. It must be
idempotent and must not rename or replace existing AUX/SOH jobs. Aggregation
never runs on the ingest path.

## 5. Narrow, chunked backfill

Raw retention bounds what can be populated. Before enqueueing production work:

1. Read the small configured car list.
2. Determine each owner's current entitlement once at a fixed statement time.
3. Generate candidate UTC dates in the administrative client, not SQL.
4. Probe exactly one `(user_id, vehicle_id, date)` at a time with the composite
   tenant/vehicle/time predicate.
5. Record every completed vehicle-day containing any source telemetry as an
   eligible materialisation key, including days expected to produce no rollup
   row.

Use the same bounded **initial reconstruction** horizon approved for SOH:
30 days for free owners and 365 days for premium/admin owners, evaluated at one
fixed timestamp, and report the measured split by tier. This is a safety bound
for probing retained raw telemetry, not the phantom read-entitlement rule. The
free read gate is one calendar month, so on dates where that means 31 days the
oldest visible day might not be reconstructable during initial backfill; daily
materialisation fills the full product window going forward. Do not discover or
backfill older premium rows merely because they happen to remain physically
present; widening that horizon needs separate approval. Do not run an unscoped
distinct scan, a whole-retention query, or even a 31-day chunk: both wider
discovery shapes previously hit the eight-second timeout.

Enqueue keys individually through the one-key function. Run the worker once per
transaction with a one-second pause between invocations. Record start/end time,
successes, failures, retries, queue depth, and ingest wait observations. If the
run materially exceeds the estimate from representative recent and old one-day
measurements, stop and report rather than increasing concurrency.

Coverage compares the frozen baseline result set with rollups. A processed day
whose baseline has no row is complete, not a gap. Require zero missing positive
days, zero extra rollup days, zero value mismatches, zero failed queue keys, and
an empty runnable queue before scheduling.

## 6. Stable premium-gated reader

Keep the public signature and result columns unchanged:

```sql
public.bydmate_phantom_drain_daily(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  date date,
  soc_start numeric,
  soc_end numeric,
  drain_percent numeric,
  idle_hours numeric
)
```

It remains `STABLE`, `SECURITY INVOKER`, explicitly scoped to the supplied user
and vehicle, and ordered by date. A null vehicle continues to return no rows;
do not introduce a nullable-OR all-vehicle branch that the current contract does
not have.

At statement start:

```sql
v_effective_from := case
  when public.is_user_premium(p_user_id, statement_timestamp()) then p_from
  else greatest(p_from, statement_timestamp() - interval '1 month')
end;
```

Return immediately when `p_to < v_effective_from`. No predicate may retain the
caller-supplied `p_from`; after deriving the bound, both the rollup branch and
every raw-boundary branch use only `v_effective_from`.

Fully contained completed UTC dates read only the rollup primary key. Bounded
raw branches preserve the old arbitrary timestamp semantics for:

- the partial date containing `v_effective_from`;
- the current UTC date containing `p_to`;
- yesterday only when its expected rollup is not yet present during the daily
  enqueue/worker delay; and
- a partial historical upper-bound date when it differs from the first boundary.

Raw windows are deduplicated by UTC date, and rollup dates covered by a raw
window are excluded. Because the frozen algorithm resets intervals at every UTC
date, evaluating separate boundary dates cannot change interval grouping.
There is no broad fallback for missing historical rollups: coverage is a rollout
gate, and silently scanning a large gap would recreate the timeout.

The reader switch must retain the PR #38 missing-function-only application
fallback. Operational database failures must continue to reach the explicit UI
error state.

## 7. Parity proof before population or reader switch

Fixtures are necessary for exact edge construction, but production parity is
the acceptance gate. The schema phase includes an executable parity test and
the frozen baseline; the proof phase runs representative production comparisons
inside a transaction that is always rolled back.

For each completed day, call the inclusive baseline with:

```sql
p_from := p_date::timestamp at time zone 'UTC';
p_to := ((p_date + 1)::timestamp at time zone 'UTC') - interval '1 microsecond';
```

Freeze those results in a temporary table **before** invoking the materialiser.
Full-join baseline and rollup on `(user_id, vehicle_id, date)` and compare
`soc_start`, `soc_end`, `drain_percent`, and `idle_hours` with
`IS DISTINCT FROM`. Numeric values must match exactly; no rounding tolerance is
allowed.

The fixture suite and representative production set together must cover:

- multiple eligible parked intervals on one UTC date, proving first-start,
  last-end, sum-of-drains, and sum-of-hours behavior;
- a parked sequence crossing UTC midnight, proving the two dates remain
  separate rather than carrying the interval across midnight;
- gaps below, above, and exactly at six hours, proving `>= 6 hours` starts a
  new interval;
- missing, null, nonnumeric, and numeric-but-out-of-normal-range SOC, proving
  only parsing—not a new 0–100 validity rule—affects endpoints;
- parked intervals shorter than four hours and intervals without SOC loss;
- a telemetry day with no eligible output; insert a sentinel rollup inside the
  rolled-back proof and prove the materialiser deletes it;
- sparse and dense real production days; and
- Di+ unplugged state plus the shared parked predicate's JSON motion-field
  behavior.

If production lacks an exact boundary class such as a precisely six-hour gap,
prove it with the committed fixture but still require exact parity on all
selected real production days. Production discovery for these classes stays
tenant-, vehicle-, and at most one/two-day bound; do not search the fleet with a
wide raw scan.

The gate is:

- value mismatches: **0**;
- missing rollup rows where baseline has a row: **0**;
- extra rollup rows where baseline has none: **0**;
- no-eligible sentinel remaining after recomputation: **0**.

Save the executable SQL and raw anonymised output in
`docs/PHANTOM_DRAIN_ROLLUP_PARITY_EVIDENCE.md` before requesting population
approval.

## 8. Performance, entitlement, and page gates

Before population, capture `EXPLAIN (ANALYZE, BUFFERS)` for one recent and one
old materialisation, daily enqueue existence, and one-key backfill existence.
Reject any plan whose raw index condition omits user, vehicle, or one-day time
bounds, or falls to BRIN/time-only scanning.

Before switching the reader:

1. Require complete eligible-set coverage and an empty runnable queue.
2. Test free, permanent-premium, active-term, expired-term, and admin callers.
3. With a frozen statement timestamp, prove a free caller receives nothing
   older than the exact `statement_timestamp() - interval '1 month'` cutoff
   while those rollup rows remain stored, and an entitled caller receives the
   full requested retained range. Include month-end cases where the calendar
   month differs from 30 days and assert the exact time-of-day boundary.
4. Prove direct authenticated table selection cannot bypass that cutoff.
5. Execute the future RPC as `authenticated` under the live eight-second
   timeout for the application's 14-day window and wider retained ranges.
6. Test first/last partial dates, current day, and the missing-yesterday seam.
7. Remeasure a warm Analytics page under normal sibling load.

The page gate is not merely SQL latency. PR #38 created a 3.465-second
critical/noncritical start separation, but route insights and lifetime map were
not made faster. Report the actual phantom timing and sibling results without
attributing unrelated improvements to this rollup. If the authenticated reader
is not comfortably below eight seconds, restore the preserved raw body and
stop.

## 9. Separable rollout and rollback

1. **Schema phase:** create rollup/queue tables, RLS, one-day materialiser,
   enqueue/worker/purge functions, frozen raw baseline, and tests. Do not enqueue,
   schedule, or change the public reader.
2. **Proof phase:** reapply schema for idempotency; run fixtures and rolled-back
   production parity; measure eligible keys and one-day plans. Stop on any
   mismatch or unsafe plan.
3. **Population phase:** enqueue the measured keys, run paced one-day workers,
   prove coverage, then apply the separate schedule migration. The raw reader
   stays active.
4. **Reader phase:** add the premium gate and rollup/raw-boundary reader, test
   entitlement and direct-table enforcement, then switch and measure. Restore
   the verbatim baseline body if any gate fails.

Populated rollups and queue state may remain for diagnosis during a reader
rollback. Cron jobs can be unscheduled independently. Destructive table cleanup
is not part of emergency rollback. All SQL must be idempotent because this
self-hosted production database has no migration tracking table.

## 10. Deliberate non-goals

- Do not change `bydmate_is_parked_unplugged` or SOC validity semantics.
- Do not add an all-vehicle nullable reader branch.
- Do not write rollups from Mate or telemetry ingestion.
- Do not reuse the client-written hourly rollup table.
- Do not broaden the UI beyond its current 14-day phantom window in this work.
- Do not implement lifetime-map, route-insight, or period-overview query work.
- Do not claim that scheduling made the lower panels faster; it only separated
  their start from the critical group.
