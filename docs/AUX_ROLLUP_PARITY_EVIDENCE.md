# Auxiliary-voltage rollup parity evidence

## Baseline construction

The migration preserves the exact pre-rollup body of
`bydmate_aux_voltage_daily` as the restricted function
`bydmate_aux_voltage_daily_raw_baseline`. It still reads
`bydmate_telemetry_samples` directly. It does not read the daily rollup table or
a view over it.

The executable fixture and comparison are in
`supabase/tests/aux_voltage_daily_rollup_parity.sql`. Each baseline call covers
one half-open UTC day by passing:

```sql
p_from := '2026-08-20 00:00 UTC';
p_to   := '2026-08-21 00:00 UTC'::timestamptz - interval '1 microsecond';
```

Subtracting one microsecond is necessary because the preserved RPC uses an
inclusive `device_time <= p_to` predicate. It prevents a sample at the next
midnight from being attributed to both days. The materialiser itself uses the
natural half-open interval `[day, day + 1)` and a two-hour lookbehind.

The fixture covers:

- a parked interval that starts on the preceding UTC date;
- a day with no qualified resting samples;
- sanitized JSON voltage with a Di+ fallback-only resting sample;
- sparse and dense telemetry (the dense fixture has 361 samples);
- flooded, EFB, AGM, LiFePO4, and other ceilings;
- a LiFePO4 ceiling derived from model generation rather than an override.

## Comparison SQL

The full executable query is committed in the test file. Its comparison core is:

```sql
with baseline as (
  select c.user_id, c.vehicle_alias as vehicle_id, b.*
  from public.cars c
  cross join lateral public.bydmate_aux_voltage_daily_raw_baseline(
    c.user_id,
    c.vehicle_alias,
    '2026-08-20 00:00 UTC',
    '2026-08-21 00:00 UTC'::timestamptz - interval '1 microsecond'
  ) b
),
rolled_up as (
  select user_id, vehicle_id, date, v_min, v_max, v_resting,
         resting_sample_count
  from public.bydmate_aux_voltage_daily_rollups
  where date = '2026-08-20'
)
select *
from baseline b
full join rolled_up r using (user_id, vehicle_id, date)
where b.v_min is distinct from r.v_min
   or b.v_max is distinct from r.v_max
   or b.v_resting is distinct from r.v_resting
   or b.resting_sample_count is distinct from r.resting_sample_count;
```

The test repeats the comparison inside a `DO` block and raises an exception on
any mismatch, so an empty printed result cannot be overlooked.

## Local PostgreSQL 17 output

The schema migration was applied twice to a clean local fixture database to
verify syntax and idempotency. No production database was changed.

```text
PARITY_MISMATCHES (expected: 0 rows)
 user_id | vehicle_id | date | baseline_v_min | rollup_v_min | baseline_v_max | rollup_v_max | baseline_v_resting | rollup_v_resting | baseline_count | rollup_count
---------+------------+------+----------------+--------------+----------------+--------------+--------------------+------------------+----------------+--------------
(0 rows)

CHEMISTRY_PROVENANCE
    vehicle_id    | battery_chemistry | resting_ceiling_v
------------------+-------------------+-------------------
 dense-agm        | agm               |              13.1
 derived-lifepo4  | lifepo4           |              13.5
 fallback-lifepo4 | lifepo4           |              13.5
 midnight-flooded | flooded           |              12.9
 no-resting       | flooded           |              12.9
 other            | other             |
 sparse-efb       | efb               |              13.0
(7 rows)

MIDNIGHT_DATES (expected: only 2026-08-20)
    date
------------
 2026-08-20
(1 row)

CHEMISTRY_REBUILD_QUEUE (expected: 1 row with chemistry_changed)
    vehicle_id    |    date    |      reason
------------------+------------+-------------------
 midnight-flooded | 2026-08-20 | chemistry_changed
(1 row)
```

A production reader switch still requires the same comparison against approved,
representative production vehicle-days after the phase-A schema is approved for
application. The reader has not been changed.

## Tier-bounded production estimate query

Before any production backfill, run the following read-only count. It applies the
30-day non-premium and 365-day premium raw-retention bounds before counting
actual distinct vehicle-days:

```sql
with eligible as (
  select distinct
    s.user_id,
    s.vehicle_id,
    (s.device_time at time zone 'UTC')::date as date,
    public.is_user_premium(s.user_id) as is_premium
  from public.bydmate_telemetry_samples s
  where s.device_time < date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    and s.device_time >= now() - case
      when public.is_user_premium(s.user_id) then interval '365 days'
      else interval '30 days'
    end
    and (
      public.bydmate_jsonb_numeric(s.telemetry, 'aux_voltage_v') between 6 and 18
      or s.diplus_voltage_12v between 6 and 18
    )
)
select
  is_premium,
  count(*) as eligible_vehicle_days,
  count(*) * 2 as optimistic_seconds,
  count(*) * 15 as conservative_seconds
from eligible
group by is_premium
order by is_premium;
```

Its actual result must be reported before enqueueing production backfill. No such
query or backfill has been run against production yet.

## Production parity (2026-08-28)

After approved phase-A application, the tier-bounded eligible set contained 449
vehicle-days: 229 free-tier days and 220 premium days. At the measured planning
range, the bounded backfill estimate is 898-6,735 seconds (about 15 minutes to 1
hour 52 minutes). No backfill was started.

The production comparison captured frozen raw-baseline values before invoking the
materialiser, compared with a null-safe full join, and rolled the entire parity
transaction back. Six real vehicle-days covered eight labels:

- flooded, LiFePO4, and other (the effective chemistries represented in retained
  production telemetry; local fixtures additionally cover EFB and AGM);
- dense and sparse days;
- no resting samples;
- sanitized voltage with Di+ fallback;
- a parked interval crossing UTC midnight.

A flat-first experiment initially produced one mismatch: identical min/max/median
but resting count 2 versus 3. Thirteen source samples classified differently
because JSON and flat power diverged. A JSON-first/flat-fallback audit then found
9 classification shifts among 212 eligible rows with missing JSON motion data.
The final materialiser therefore invokes the shared
`bydmate_is_parked_unplugged` predicate exactly, with no duplicated or flat
fallback motion logic.

The full six-day/eight-label production rerun after that correction returned:

```text
PARITY_MISMATCH_COUNT
 mismatch_count
----------------
              0
(1 row)

PARITY_MISMATCH_DETAIL_ANONYMISED (expected: 0 rows)
 vehicle_hash | date | baseline_v_min | rollup_v_min | baseline_v_max | rollup_v_max | baseline_v_resting | rollup_v_resting | baseline_count | rollup_count
--------------+------+----------------+--------------+----------------+--------------+--------------------+------------------+----------------+--------------
(0 rows)
```

Follow-up question, not part of this performance change: should missing JSON
speed/power continue to mean stationary? Changing that shared predicate affects
both auxiliary resting voltage and phantom drain, so the 9-of-212 evidence must
inform a separate design decision rather than an incidental rollup optimization.
