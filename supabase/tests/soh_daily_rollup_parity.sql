\set ON_ERROR_STOP on
begin;

-- The acceptance proof must also be run against production data. This fixture
-- locks down exact source selection and reader behavior before that rollout gate.
insert into auth.users (id) values
  ('20000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000004');

insert into public.cars (user_id, vehicle_alias, created_at) values
  ('20000000-0000-0000-0000-000000000001', 'latest-valid', '2026-01-01'),
  ('20000000-0000-0000-0000-000000000002', 'zero-boundary', '2026-01-01'),
  ('20000000-0000-0000-0000-000000000003', 'hundred-boundary', '2026-01-01'),
  ('20000000-0000-0000-0000-000000000004', 'no-valid-soh', '2026-01-01');

insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry
) values
  -- Latest valid wins; later invalid/nonnumeric/null/missing samples are ignored.
  ('20000000-0000-0000-0000-000000000001', 'latest-valid', '2026-08-20 00:00:00 UTC', '{"soh_percent":95}'),
  ('20000000-0000-0000-0000-000000000001', 'latest-valid', '2026-08-20 12:34:56.789 UTC', '{"soh_percent":"94.5"}'),
  ('20000000-0000-0000-0000-000000000001', 'latest-valid', '2026-08-20 13:00:00 UTC', '{"soh_percent":120}'),
  ('20000000-0000-0000-0000-000000000001', 'latest-valid', '2026-08-20 14:00:00 UTC', '{"soh_percent":"unknown"}'),
  ('20000000-0000-0000-0000-000000000001', 'latest-valid', '2026-08-20 15:00:00 UTC', '{"soh_percent":null}'),
  ('20000000-0000-0000-0000-000000000001', 'latest-valid', '2026-08-20 16:00:00 UTC', '{}'),
  ('20000000-0000-0000-0000-000000000002', 'zero-boundary', '2026-08-20 23:59:59.999 UTC', '{"soh_percent":0}'),
  ('20000000-0000-0000-0000-000000000003', 'hundred-boundary', '2026-08-20 06:00:00 UTC', '{"soh_percent":100}'),
  ('20000000-0000-0000-0000-000000000004', 'no-valid-soh', '2026-08-20 06:00:00 UTC', '{"soh_percent":-1}'),
  ('20000000-0000-0000-0000-000000000004', 'no-valid-soh', '2026-08-20 07:00:00 UTC', '{}');

select public.bydmate_materialize_soh_day(c.user_id, c.vehicle_alias, '2026-08-20')
from public.cars c
where c.user_id::text like '20000000-%';

\echo 'SOH_PARITY_MISMATCHES (expected: 0 rows)'
with baseline as (
  select
    c.user_id,
    c.vehicle_alias as vehicle_id,
    (b.device_time at time zone 'UTC')::date as date,
    b.device_time,
    b.soh_percent
  from public.cars c
  cross join lateral public.bydmate_soh_daily_raw_baseline(
    c.user_id,
    c.vehicle_alias,
    '2026-08-20 00:00 UTC',
    '2026-08-21 00:00 UTC'::timestamptz - interval '1 microsecond'
  ) b
  where c.user_id::text like '20000000-%'
), rolled_up as (
  select user_id, vehicle_id, date, device_time, soh_percent
  from public.bydmate_soh_daily_rollups
  where user_id::text like '20000000-%' and date = '2026-08-20'
), mismatches as (
  select
    coalesce(b.user_id, r.user_id) user_id,
    coalesce(b.vehicle_id, r.vehicle_id) vehicle_id,
    coalesce(b.date, r.date) date,
    b.device_time baseline_device_time,
    r.device_time rollup_device_time,
    b.soh_percent baseline_soh,
    r.soh_percent rollup_soh
  from baseline b
  full join rolled_up r using (user_id, vehicle_id, date)
  where b.device_time is distinct from r.device_time
     or b.soh_percent is distinct from r.soh_percent
)
select * from mismatches order by vehicle_id;

do $$
begin
  if exists (
    with baseline as (
      select
        c.user_id,
        c.vehicle_alias vehicle_id,
        (b.device_time at time zone 'UTC')::date date,
        b.device_time,
        b.soh_percent
      from public.cars c
      cross join lateral public.bydmate_soh_daily_raw_baseline(
        c.user_id, c.vehicle_alias, '2026-08-20 00:00 UTC',
        '2026-08-21 00:00 UTC'::timestamptz - interval '1 microsecond'
      ) b
      where c.user_id::text like '20000000-%'
    )
    select 1
    from baseline b
    full join public.bydmate_soh_daily_rollups r
      on r.user_id = b.user_id and r.vehicle_id = b.vehicle_id and r.date = b.date
    where coalesce(r.date, b.date) = '2026-08-20'
      and coalesce(r.user_id, b.user_id)::text like '20000000-%'
      and (b.device_time is distinct from r.device_time
        or b.soh_percent is distinct from r.soh_percent)
  ) then
    raise exception 'SOH raw/rollup parity mismatch';
  end if;
end
$$;

\echo 'SOH_EXPECTED_ROLLUPS'
select vehicle_id, date, device_time, soh_percent
from public.bydmate_soh_daily_rollups
where user_id::text like '20000000-%'
order by vehicle_id;

-- The rollup-backed reader must retain the public RPC result exactly.
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000001',
    'latest-valid',
    '2026-08-20 00:00 UTC',
    '2026-08-20 23:59:59.999 UTC'
  )
  where device_time = '2026-08-20 12:34:56.789 UTC'
    and soh_percent = 94.5;

  if v_rows <> 1 then
    raise exception 'SOH rollup reader did not return the expected historical row';
  end if;
end
$$;

-- A current partial UTC day is never materialised; the reader must still expose
-- its latest valid raw sample through the bounded boundary path.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry
) values (
  '20000000-0000-0000-0000-000000000001',
  'latest-valid',
  date_trunc('day', statement_timestamp()) + interval '1 hour',
  '{"soh_percent":93}'
);

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000001',
    'latest-valid',
    date_trunc('day', statement_timestamp()),
    date_trunc('day', statement_timestamp()) + interval '2 hours'
  )
  where soh_percent = 93;

  if v_rows <> 1 then
    raise exception 'SOH reader did not return the current raw boundary row';
  end if;
end
$$;

-- Recomputing a now-empty day removes stale rollup data.
delete from public.bydmate_telemetry_samples
where user_id = '20000000-0000-0000-0000-000000000003'
  and vehicle_id = 'hundred-boundary'
  and device_time >= '2026-08-20 00:00 UTC'
  and device_time < '2026-08-21 00:00 UTC';
select public.bydmate_materialize_soh_day(
  '20000000-0000-0000-0000-000000000003', 'hundred-boundary', '2026-08-20'
);

do $$
begin
  if exists (
    select 1 from public.bydmate_soh_daily_rollups
    where user_id = '20000000-0000-0000-0000-000000000003'
      and vehicle_id = 'hundred-boundary'
      and date = '2026-08-20'
  ) then
    raise exception 'SOH materialiser retained a stale empty-day row';
  end if;
end
$$;

rollback;
