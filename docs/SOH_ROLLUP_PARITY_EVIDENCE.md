# SOH rollup parity evidence

## Baseline and comparison

`bydmate_soh_daily_raw_baseline` is a frozen copy of the pre-rollup raw reader.
It reads `bydmate_telemetry_samples` directly and does not reference the rollup
table or rewritten reader.

The executable fixture is `supabase/tests/soh_daily_rollup_parity.sql`. It uses a
half-open materialiser day and calls the baseline with an inclusive upper bound
of the next midnight minus one microsecond. The null-safe full join compares
both `device_time` and `soh_percent` exactly.

The fixture covers:

- latest-valid selection when later values are above 100, nonnumeric, null, or
  missing;
- exact valid boundary values 0 and 100;
- a day with no valid SOH row;
- a sample at `23:59:59.999` UTC;
- stale-row deletion after source data no longer qualifies;
- current partial-day raw fallback in the rewritten reader.

## Local PostgreSQL 17 result

All three migrations were applied to an isolated PostgreSQL 17 schema. The
schema and reader migrations were reapplied to verify idempotency. The parity
fixture completed successfully and rolled back its data:

```text
SOH_PARITY_MISMATCHES (expected: 0 rows)
 user_id | vehicle_id | date | baseline_device_time | rollup_device_time | baseline_soh | rollup_soh
---------+------------+------+----------------------+--------------------+--------------+------------
(0 rows)

SOH_EXPECTED_ROLLUPS
    vehicle_id    |    date    |        device_time         | soh_percent
------------------+------------+----------------------------+-------------
 hundred-boundary | 2026-08-20 | 2026-08-20 06:00:00+00     |         100
 latest-valid     | 2026-08-20 | 2026-08-20 12:34:56.789+00 |        94.5
 zero-boundary    | 2026-08-20 | 2026-08-20 23:59:59.999+00 |           0
(3 rows)
```

The current-day reader assertion and stale-row deletion assertion also passed.

## Initial production gate status (superseded)

Local fixture parity is not sufficient to switch production. Before applying
the scheduling or reader-switch migrations, production must complete the design
gates in `docs/SOH_ROLLUP_DESIGN.md`:

1. Apply only `20260903120000_soh_daily_rollups.sql`.
2. Freeze baseline results for representative retained production vehicle-days.
3. Materialise and compare in a transaction that is rolled back.
4. Require zero timestamp/value mismatches, missing rows, and extra rows.
5. Measure the eligible set, run the throttled backfill, and require zero
   coverage gaps and failed queue items.
6. Verify the future authenticated reader under the 8-second timeout and under
   normal Analytics-page sibling load.
7. Only then apply the schedule and reader-switch migrations.

No production migration or backfill had been performed when the initial local
evidence above was created. The production phase 1 and phase 2 results below
supersede that status.

## Production phases 1–2 — 2026-09-04

### Phase 1: additive schema and idempotency

Only `20260903120000_soh_daily_rollups.sql` was applied through direct `psql`
with TLS disabled and `ON_ERROR_STOP=1`, inside a single transaction. File
SHA-256 at application time:

```text
48c62123f8a84c147aa173ff7b13a0f5952893f06def1c070349c8fbcc5365cc
```

The schema was first applied to production on 2026-09-03. The direct `psql`
command began at `14:03:11.091703 UTC` and completed at
`14:03:12.772031 UTC` (`17:03:12.772031` Europe/Minsk). Its authorization was
the owner's direct human instruction: “apply schema migration using agent
memmory procedures.” This occurred before the numbered phase 1/2 work order.

After that first application exposed production's explicit default function
ACLs, the migration was hardened and the same schema file was reapplied on
2026-09-03. No other SOH migration was applied outside the subsequently
ordered rollout phases. Within those phases, phase 1 reapplied this schema
migration twice on 2026-09-04, phase 3 applied only the scheduling migration,
and phase 4 applied only the reader-switch migration.

Both phase 1 reapplications completed cleanly. Existing tables and indexes
produced only the expected `already exists, skipping` notices; policies,
functions, revokes, and grants were recreated successfully. This proves the
production migration is idempotent.

Post-application verification:

- `bydmate_soh_daily_rollups`: RLS enabled, 0 rows;
- `bydmate_soh_rollup_queue`: RLS enabled, 0 rows;
- all six internal/baseline functions: execution denied to `anon` and
  `authenticated`, allowed to `service_role`;
- SOH cron jobs: 0;
- `bydmate_soh_daily` still reads raw telemetry and does not reference the
  rollup table.

Neither `20260903121000_schedule_soh_daily_rollups.sql` nor
`20260903122000_read_soh_daily_rollups.sql` was applied.

### Tenant-bound eligible-key measurement

Production contained 14 configured vehicle identities: 11 free and 3 premium.
The measurement applied the current tier bounds from section 6: 30 completed
days for free accounts and 365 completed days for premium accounts. Every raw
probe bound an exact `user_id`, exact `vehicle_id`, and one UTC day.

| Tier | Configured vehicles | Vehicles with eligible days | Eligible vehicle-days | Retained date span |
| --- | ---: | ---: | ---: | --- |
| Free | 11 | 7 | 200 | 2026-08-05 through 2026-09-03 |
| Premium | 3 | 3 | 204 | 2026-06-05 through 2026-09-03 |
| **Total** | **14** | **10** | **404** | **2026-06-05 through 2026-09-03** |

An initial tenant-bound whole-retention query and a second attempt using
31-day chunks each hit the live 8-second statement timeout. Both transactions
aborted before materialisation and persisted nothing. The successful audit
therefore reduced discovery to one independently executed vehicle-day probe per
statement. It completed in approximately 6 minutes 40 seconds without a
per-statement timeout. This is operational evidence that eligible-key discovery
must remain paced and narrowly bounded.

### Phase 2: production parity proof

The proof covered the oldest and newest retained valid day for every production
vehicle with eligible SOH, plus available production edge classes. Baseline
rows were frozen before invoking the materialiser. All materialisation and
comparison work ran in one transaction that ended with `ROLLBACK`.

Exact result:

| Check | Count |
| --- | ---: |
| Timestamp mismatches | **0** |
| SOH value mismatches | **0** |
| Missing rollup rows | **0** |
| Extra rollup rows | **0** |

Coverage was 25 representative vehicle-days across all 10 vehicles with
retained valid SOH: 24 valid-SOH days and one raw day with no valid SOH. Vehicle
labels below are stable only within this anonymised audit.

| Vehicle | UTC date | Coverage reason |
| --- | --- | --- |
| V01 | 2026-08-05 | oldest valid |
| V01 | 2026-09-03 | newest valid; latest valid SOH exactly 100 |
| V02 | 2026-07-18 | oldest valid |
| V02 | 2026-09-03 | newest valid |
| V04 | 2026-06-05 | oldest valid |
| V04 | 2026-06-20 | raw samples but no valid SOH |
| V04 | 2026-09-01 | valid SOH mixed with missing-key samples |
| V04 | 2026-09-03 | newest valid |
| V07 | 2026-08-05 | oldest valid |
| V07 | 2026-09-03 | newest valid |
| V08 | 2026-08-05 | oldest valid |
| V08 | 2026-09-03 | newest valid |
| V09 | 2026-08-05 | oldest valid |
| V09 | 2026-08-08 | dense sample: 31,556 valid rows |
| V09 | 2026-08-12 | selected latest-valid point nearest UTC midnight |
| V09 | 2026-09-03 | newest valid |
| V10 | 2026-08-06 | oldest valid |
| V10 | 2026-09-03 | newest valid |
| V12 | 2026-08-05 | oldest valid |
| V12 | 2026-09-01 | newest valid |
| V13 | 2026-06-06 | oldest valid |
| V13 | 2026-08-12 | sparse sample: 5 valid rows |
| V13 | 2026-09-02 | newest valid |
| V14 | 2026-08-05 | oldest valid |
| V14 | 2026-09-03 | newest valid |

Within the tier-bounded production source, the audit found no days containing
valid SOH mixed with null, nonnumeric, or out-of-range SOH values. Those
nonexistent production classes could not be selected; the committed fixture
continues to cover them. Production did provide the 100 boundary, missing-key,
no-valid, dense, sparse, and near-midnight classes.

Measured `psql` wall time for the materialiser call itself:

- recent: V01, 2026-09-03 — **36.390 ms**;
- old: V04, 2026-06-05 — **33.052 ms**.

After rollback, both SOH tables contained 0 rows, the SOH cron-job count was 0,
and the public reader still did not reference the rollup table. No backfill was
enqueued, no cron job was registered, and no reader switch was performed.

## Production phase 3 — 2026-09-04

### Population

The first population attempt called `bydmate_enqueue_soh_backfill` with a
single date per invocation. It still hit the live 8-second statement timeout
before enqueueing a row. Post-failure checks confirmed 0 queued keys, 0
rollups, and 0 SOH cron jobs.

`EXPLAIN` of the helper's generic plan identified the cause: the
`generate_series` join left the UTC-day predicates as a join filter and planned
to materialise the tenant/vehicle's SOH candidates first. For the first
vehicle, PostgreSQL estimated 21,222 index rows even though the function was
called for one day. A direct one-day probe instead produced an index scan whose
index condition contained `user_id`, `vehicle_id`, lower `device_time`, and
upper `device_time` bounds.

Population therefore used direct idempotent queue inserts, one independently
committed tenant/vehicle/day probe at a time. This preserved the exact valid-SOH
predicate and the measured 30/365-day tier windows without invoking the broken
range shape. It enqueued exactly 404 expected keys:

```text
population started: 2026-09-04 08:38:51.402446+00
enqueue finished:   2026-09-04 08:39:48.560168+00
eligible keys:      404
queued keys:        404
preexisting rows:   0
```

The queue worker then ran once per transaction with batch size 1 and a one-
second pause between invocations:

```text
processing started:  2026-09-04 08:39:48.697670+00
processing finished: 2026-09-04 08:46:50.631042+00
processing seconds:  421.933
worker invocations:  404
successes:           404
failures:            0
```

Exact post-backfill coverage:

| Check | Count |
| --- | ---: |
| Expected eligible keys | **404** |
| Populated keys | **404** |
| Missing keys | **0** |
| Extra keys | **0** |
| Remaining queue depth | **0** |
| Queued items with failures | **0** |

The full enqueue-and-process operation ended at
`2026-09-04 08:46:50.733193+00` and took **479.331 seconds**.

`bydmate_enqueue_soh_backfill` must not be reused for production backfill until
its `generate_series` plan is repaired and the tenant/vehicle/day index bounds
are demonstrated in the actual function plan. This does not affect the daily
enqueue function, which accepts one date directly and has no internal
`generate_series`.

### Scheduling

After the zero-gap population gate passed, only
`20260903121000_schedule_soh_daily_rollups.sql` was applied. Production
registered three active jobs:

| Job | UTC schedule | Command |
| --- | --- | --- |
| `enqueue-bydmate-soh-daily` | `15 0 * * *` | `select public.bydmate_enqueue_soh_day()` |
| `process-bydmate-soh-rollups` | `2,7,12,17,22,27,32,37,42,47,52,57 * * * *` | `select public.bydmate_process_soh_rollup_queue(1)` |
| `purge-bydmate-soh-rollups` | `35 3 * * *` | `select public.purge_old_bydmate_soh_rollups()` |

Phase-boundary verification returned 404 rollup rows, 0 queued rows, and all
three jobs active. `bydmate_soh_daily` still references
`bydmate_telemetry_samples` and does not reference
`bydmate_soh_daily_rollups`. The reader-switch migration was not applied.

## Production phase 4 — 2026-09-04

### Premium read gate and reader tests

Before the reader switch, `20260903122000_read_soh_daily_rollups.sql` was
updated to derive one lower bound at statement time:

```sql
v_effective_from := case
  when public.is_user_premium(p_user_id, statement_timestamp()) then p_from
  else greatest(p_from, statement_timestamp() - interval '30 days')
end;
```

Both the completed-day rollup branch and every bounded-raw branch use
`v_effective_from`. If `p_to < v_effective_from`, the function returns before
touching either source. The caller-supplied `p_from` remains only in the
function signature and in the assignment above; it does not survive in any
source predicate. Execute was also explicitly revoked from `anon`, while
remaining granted to `authenticated` and `service_role`.

The SQL reader test was run in an isolated PostgreSQL 17 database. The reader
migration was applied twice to confirm idempotency, and the transaction rolled
back after all assertions passed. It covered:

- free: the 45-day-old point stayed stored but was hidden, while the 10-day-old
  point was returned;
- permanent premium: both points were returned;
- active-term premium: both points were returned;
- expired-term premium: only the 10-day-old point was returned;
- admin: both points were returned;
- exact cutoff: a raw point one minute before the 30-day cutoff was hidden and
  one minute after it was returned; a wholly older request took the early
  return path.

The existing materialisation, parity, invalid-value, latest-valid tiebreak,
stale-row deletion, and current partial-day assertions also passed in the same
test transaction. The post-migration ACL assertion returned `anon_execute =
false` and `authenticated_execute = true`.

### Production reader switch

Only `20260903122000_read_soh_daily_rollups.sql` was then applied. Its applied
SHA-256 was
`176ca72beca86dd440b94a95bf5350a06e4f934a5da273544799f28b4cc1d953`.
Immediate verification returned:

```text
reader_uses_rollup          t
reader_has_premium_gate     t
reader_has_effective_bound  t
anon_execute                f
authenticated_execute       t
rollup_rows                 404
queue_rows                  0
active_soh_jobs             3
```

### Authenticated performance gate

The owner call ran as the `authenticated` role with its JWT subject set and the
live `statement_timeout = 8s`:

| Requested range | Points | psql time |
| --- | ---: | ---: |
| Day | 2 | 124.653 ms |
| Week | 5 | 263.891 ms |
| Month | 30 | 127.879 ms |
| Quarter | 88 | 168.781 ms |
| Year | 89 | 128.269 ms |

The year call completed in 128.269 ms, leaving substantial margin below the
8-second gate.

### Analytics sibling-load gate

The production-backed Analytics page was loaded with the normal year-range
sibling requests. The SOH request returned HTTP 200 and rendered a 97.0% value
with its chart. Server-side route timing was **1.453 seconds** on the cold run
and **2.6 seconds** on the warm, fully concurrent run; browser-observed request
durations were 1.523 and 2.723 seconds respectively. The cold document itself
included about six seconds of development compilation, which is separate from
the SOH route timing.

Other existing Analytics siblings continued to demonstrate pool pressure on
the warm run (`period analytics` 3.4s, `lifetime` 10.7s, `route insights`
11.3s, and `phantom drain` 17.9s), but the rollup-backed SOH route remained
comfortably below eight seconds while they were active. Those sibling panels
are outside this phase.

The reader performance gates passed, so the preserved raw baseline was not
restored. Phase 4 stopped with the rollup reader active, 404 rollup rows, zero
queued rows, and all three SOH cron jobs active. Phase 5 was not started.
