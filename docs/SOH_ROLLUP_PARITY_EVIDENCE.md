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

## Production gate: pending

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

No production migration or backfill was performed while creating this evidence.
