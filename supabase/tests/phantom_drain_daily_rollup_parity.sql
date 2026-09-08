\set ON_ERROR_STOP on
begin;

-- Fixture proof for the frozen phantom-drain definition. Production parity is
-- a separate phase-2 gate; this transaction always rolls back.
insert into auth.users (id) values
  ('30000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000005'),
  ('30000000-0000-0000-0000-000000000006'),
  ('30000000-0000-0000-0000-000000000007');

insert into public.cars (
  user_id, name, battery_capacity_kwh, vehicle_alias, created_at
) values
  ('30000000-0000-0000-0000-000000000001', 'Multiple intervals', 60, 'multiple-intervals', '2026-01-01'),
  ('30000000-0000-0000-0000-000000000002', 'Cross midnight', 60, 'cross-midnight', '2026-01-01'),
  ('30000000-0000-0000-0000-000000000003', 'Six-hour gaps', 60, 'six-hour-gaps', '2026-01-01'),
  ('30000000-0000-0000-0000-000000000004', 'Invalid SOC', 60, 'invalid-soc', '2026-01-01'),
  ('30000000-0000-0000-0000-000000000005', 'No eligible', 60, 'no-eligible', '2026-01-01'),
  ('30000000-0000-0000-0000-000000000006', 'JSON motion wins', 60, 'json-motion-wins', '2026-01-01'),
  ('30000000-0000-0000-0000-000000000007', 'Empty source', 60, 'empty-source', '2026-01-01');

-- Two eligible intervals separated by a moving sample. Daily output must use
-- the first interval's start, last interval's end, and sums from both.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_charge_gun_state
) values
  ('30000000-0000-0000-0000-000000000001', 'multiple-intervals', '2022-08-20 00:00 UTC', '{"soc":80,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000001', 'multiple-intervals', '2022-08-20 04:00 UTC', '{"soc":78,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000001', 'multiple-intervals', '2022-08-20 05:00 UTC', '{"soc":77,"speed_kmh":20,"power_kw":3,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000001', 'multiple-intervals', '2022-08-20 06:00 UTC', '{"soc":77,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000001', 'multiple-intervals', '2022-08-20 10:00 UTC', '{"soc":75.5,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1');

-- One continuous parked sequence crosses midnight. The UTC date change must
-- split it into independent eligible intervals rather than carry state over.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_charge_gun_state
) values
  ('30000000-0000-0000-0000-000000000002', 'cross-midnight', '2022-08-19 19:30 UTC', '{"soc":90,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000002', 'cross-midnight', '2022-08-19 23:59 UTC', '{"soc":89,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000002', 'cross-midnight', '2022-08-20 00:00 UTC', '{"soc":89,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000002', 'cross-midnight', '2022-08-20 04:00 UTC', '{"soc":88,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1');

-- 5:59 remains one interval. A gap exactly equal to six hours and a gap above
-- six hours each start a new interval.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_charge_gun_state
) values
  ('30000000-0000-0000-0000-000000000003', 'six-hour-gaps', '2022-08-20 00:00 UTC', '{"soc":70,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000003', 'six-hour-gaps', '2022-08-20 05:59 UTC', '{"soc":69,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000003', 'six-hour-gaps', '2022-08-20 11:59 UTC', '{"soc":69,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000003', 'six-hour-gaps', '2022-08-20 15:59 UTC', '{"soc":68,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000003', 'six-hour-gaps', '2022-08-20 22:00 UTC', '{"soc":67.5,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1');

-- Invalid SOC samples contribute to interval timing but not endpoints. Values
-- outside 0..100 remain valid because the frozen reader imposes no SOC clamp.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_charge_gun_state
) values
  ('30000000-0000-0000-0000-000000000004', 'invalid-soc', '2022-08-20 00:00 UTC', '{"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000004', 'invalid-soc', '2022-08-20 01:00 UTC', '{"soc":null,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000004', 'invalid-soc', '2022-08-20 02:00 UTC', '{"soc":"invalid","speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000004', 'invalid-soc', '2022-08-20 03:00 UTC', '{"soc":150,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000004', 'invalid-soc', '2022-08-20 07:00 UTC', '{"soc":140,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1');

-- Equal endpoints create no eligible output. The materialiser must delete the
-- sentinel rollup instead of leaving stale data behind.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_charge_gun_state
) values
  ('30000000-0000-0000-0000-000000000005', 'no-eligible', '2022-08-20 00:00 UTC', '{"soc":50,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1'),
  ('30000000-0000-0000-0000-000000000005', 'no-eligible', '2022-08-20 04:00 UTC', '{"soc":50,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', '1');

-- The shared JSON predicate wins over contradictory flat Di+ motion fields.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_speed_kmh,
  diplus_power_kw, diplus_charge_gun_state
) values
  ('30000000-0000-0000-0000-000000000006', 'json-motion-wins', '2022-08-20 00:00 UTC', '{"soc":60,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 40, 5, '1'),
  ('30000000-0000-0000-0000-000000000006', 'json-motion-wins', '2022-08-20 04:00 UTC', '{"soc":59,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 40, 5, '1');

create temporary table phantom_fixture_keys (
  user_id uuid,
  vehicle_id text,
  date date,
  primary key (user_id, vehicle_id, date)
) on commit drop;

insert into phantom_fixture_keys values
  ('30000000-0000-0000-0000-000000000001', 'multiple-intervals', '2022-08-20'),
  ('30000000-0000-0000-0000-000000000002', 'cross-midnight', '2022-08-19'),
  ('30000000-0000-0000-0000-000000000002', 'cross-midnight', '2022-08-20'),
  ('30000000-0000-0000-0000-000000000003', 'six-hour-gaps', '2022-08-20'),
  ('30000000-0000-0000-0000-000000000004', 'invalid-soc', '2022-08-20'),
  ('30000000-0000-0000-0000-000000000005', 'no-eligible', '2022-08-20'),
  ('30000000-0000-0000-0000-000000000006', 'json-motion-wins', '2022-08-20');

-- Freeze the independent raw results before invoking the materialiser.
create temporary table phantom_fixture_baseline on commit drop as
select k.user_id, k.vehicle_id, b.*
from phantom_fixture_keys k
cross join lateral public.bydmate_phantom_drain_daily_raw_baseline(
  k.user_id,
  k.vehicle_id,
  k.date::timestamp at time zone 'UTC',
  ((k.date + 1)::timestamp at time zone 'UTC') - interval '1 microsecond'
) b;

insert into public.bydmate_phantom_drain_daily_rollups (
  user_id, vehicle_id, date, soc_start, soc_end, drain_percent, idle_hours
) values (
  '30000000-0000-0000-0000-000000000005',
  'no-eligible',
  '2022-08-20',
  51,
  50,
  1,
  4
);

select public.bydmate_materialize_phantom_drain_day(
  k.user_id, k.vehicle_id, k.date
)
from phantom_fixture_keys k;

\echo 'PHANTOM_FIXTURE_PARITY_MISMATCHES (expected: 0 rows)'
select
  coalesce(b.user_id, r.user_id) as user_id,
  coalesce(b.vehicle_id, r.vehicle_id) as vehicle_id,
  coalesce(b.date, r.date) as date,
  b.soc_start as baseline_soc_start,
  r.soc_start as rollup_soc_start,
  b.soc_end as baseline_soc_end,
  r.soc_end as rollup_soc_end,
  b.drain_percent as baseline_drain,
  r.drain_percent as rollup_drain,
  b.idle_hours as baseline_hours,
  r.idle_hours as rollup_hours
from phantom_fixture_baseline b
full join public.bydmate_phantom_drain_daily_rollups r
  on r.user_id = b.user_id
 and r.vehicle_id = b.vehicle_id
 and r.date = b.date
where coalesce(r.user_id, b.user_id)::text like '30000000-%'
  and (
    b.soc_start is distinct from r.soc_start
    or b.soc_end is distinct from r.soc_end
    or b.drain_percent is distinct from r.drain_percent
    or b.idle_hours is distinct from r.idle_hours
  )
order by vehicle_id, date;

do $$
begin
  if exists (
    select 1
    from phantom_fixture_baseline b
    full join public.bydmate_phantom_drain_daily_rollups r
      on r.user_id = b.user_id
     and r.vehicle_id = b.vehicle_id
     and r.date = b.date
    where coalesce(r.user_id, b.user_id)::text like '30000000-%'
      and (
        b.soc_start is distinct from r.soc_start
        or b.soc_end is distinct from r.soc_end
        or b.drain_percent is distinct from r.drain_percent
        or b.idle_hours is distinct from r.idle_hours
      )
  ) then
    raise exception 'Phantom raw/rollup fixture parity mismatch';
  end if;

  if exists (
    select 1
    from public.bydmate_phantom_drain_daily_rollups
    where user_id = '30000000-0000-0000-0000-000000000005'
      and vehicle_id = 'no-eligible'
      and date = '2022-08-20'
  ) then
    raise exception 'Phantom materialiser retained a stale no-eligible row';
  end if;
end
$$;

-- Lock down the exact multi-interval and six-hour-boundary calculations.
do $$
declare
  v_row record;
begin
  select * into v_row
  from public.bydmate_phantom_drain_daily_rollups
  where user_id = '30000000-0000-0000-0000-000000000001'
    and vehicle_id = 'multiple-intervals'
    and date = '2022-08-20';
  if v_row.soc_start <> 80 or v_row.soc_end <> 75.5
     or v_row.drain_percent <> 3.5 or v_row.idle_hours <> 8 then
    raise exception 'Unexpected multiple-interval result: %', row_to_json(v_row);
  end if;

  select * into v_row
  from public.bydmate_phantom_drain_daily_rollups
  where user_id = '30000000-0000-0000-0000-000000000003'
    and vehicle_id = 'six-hour-gaps'
    and date = '2022-08-20';
  if v_row.soc_start <> 70 or v_row.soc_end <> 68
     or v_row.drain_percent <> 2
     or v_row.idle_hours <> (599::numeric / 60) then
    raise exception 'Unexpected six-hour-gap result: %', row_to_json(v_row);
  end if;
end
$$;

-- Explicit-key enqueue is one tenant/vehicle/day, idempotent, and ignores a
-- source-empty key.
delete from public.bydmate_phantom_drain_rollup_queue
where user_id::text like '30000000-%';

do $$
declare
  v_queued boolean;
  v_count integer;
  v_result jsonb;
begin
  v_queued := public.bydmate_enqueue_phantom_drain_key(
    '30000000-0000-0000-0000-000000000001',
    'multiple-intervals',
    '2022-08-20',
    'backfill'
  );
  if not v_queued then raise exception 'Expected explicit key to enqueue'; end if;

  perform public.bydmate_enqueue_phantom_drain_key(
    '30000000-0000-0000-0000-000000000001',
    'multiple-intervals',
    '2022-08-20',
    'retry'
  );

  select count(*) into v_count
  from public.bydmate_phantom_drain_rollup_queue
  where user_id = '30000000-0000-0000-0000-000000000001'
    and vehicle_id = 'multiple-intervals'
    and date = '2022-08-20';
  if v_count <> 1 then raise exception 'Explicit enqueue was not idempotent'; end if;

  v_queued := public.bydmate_enqueue_phantom_drain_key(
    '30000000-0000-0000-0000-000000000007',
    'empty-source',
    '2022-08-20',
    'backfill'
  );
  if v_queued then raise exception 'Source-empty key was queued'; end if;

  v_result := public.bydmate_process_phantom_drain_rollup_queue();
  if v_result <> '{"failed": 0, "processed": 1}'::jsonb then
    raise exception 'Unexpected worker result: %', v_result;
  end if;

  select count(*) into v_count
  from public.bydmate_phantom_drain_rollup_queue
  where user_id::text like '30000000-%';
  if v_count <> 0 then raise exception 'Worker did not remove successful key'; end if;
end
$$;

-- Daily enqueue probes each configured car separately and remains idempotent.
do $$
declare
  v_count integer;
begin
  v_count := public.bydmate_enqueue_phantom_drain_day('2022-08-20');
  if v_count <> 6 then
    raise exception 'Daily enqueue expected 6 eligible source keys, got %', v_count;
  end if;

  perform public.bydmate_enqueue_phantom_drain_day('2022-08-20');
  select count(*) into v_count
  from public.bydmate_phantom_drain_rollup_queue
  where user_id::text like '30000000-%';
  if v_count <> 6 then
    raise exception 'Daily enqueue was not idempotent; queue depth %', v_count;
  end if;
end
$$;

-- Purge deletes only rollup dates strictly older than five calendar years and
-- returns zero when rerun.
insert into public.bydmate_phantom_drain_daily_rollups (
  user_id, vehicle_id, date, soc_start, soc_end, drain_percent, idle_hours
) values (
  '30000000-0000-0000-0000-000000000007',
  'empty-source',
  ((statement_timestamp() at time zone 'UTC')::date - interval '5 years 1 day')::date,
  51,
  50,
  1,
  4
);

do $$
declare
  v_deleted bigint;
begin
  v_deleted := public.purge_old_bydmate_phantom_drain_rollups();
  if v_deleted <> 1 then raise exception 'Purge expected 1 row, got %', v_deleted; end if;

  v_deleted := public.purge_old_bydmate_phantom_drain_rollups();
  if v_deleted <> 0 then raise exception 'Purge rerun expected 0 rows, got %', v_deleted; end if;
end
$$;

-- Server-owned privilege boundary: authenticated can select through RLS but
-- cannot write or invoke maintenance/parity functions.
do $$
begin
  if not has_table_privilege(
    'authenticated',
    'public.bydmate_phantom_drain_daily_rollups',
    'select'
  ) then
    raise exception 'Authenticated role lacks rollup SELECT';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.bydmate_phantom_drain_daily_rollups',
    'insert'
  ) or has_table_privilege(
    'authenticated',
    'public.bydmate_phantom_drain_rollup_queue',
    'select'
  ) then
    raise exception 'Authenticated role has server-owned table privileges';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.bydmate_materialize_phantom_drain_day(uuid,text,date)',
    'execute'
  ) then
    raise exception 'Authenticated role can invoke phantom maintenance';
  end if;
end
$$;

rollback;
