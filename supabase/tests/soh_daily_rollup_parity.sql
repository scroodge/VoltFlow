\set ON_ERROR_STOP on
begin;

-- The acceptance proof must also be run against production data. This fixture
-- locks down exact source selection and reader behavior before that rollout gate.
insert into auth.users (id) values
  ('20000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000004'),
  ('20000000-0000-0000-0000-000000000011'),
  ('20000000-0000-0000-0000-000000000012'),
  ('20000000-0000-0000-0000-000000000013'),
  ('20000000-0000-0000-0000-000000000014'),
  ('20000000-0000-0000-0000-000000000015');

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

-- Keep the fixed historical parity fixture entitled regardless of when this
-- script is run; tier-gate behavior is covered independently below.
insert into public.profiles (id, is_premium, premium_until)
values ('20000000-0000-0000-0000-000000000001', true, null)
on conflict (id) do update
set is_premium = excluded.is_premium,
    premium_until = excluded.premium_until;

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

-- Reader entitlement matrix. Old rollup rows remain stored for every tier;
-- the reader alone controls visibility beyond the exact 30-day free cutoff.
insert into public.profiles (id, is_premium, premium_until) values
  ('20000000-0000-0000-0000-000000000011', false, null),
  ('20000000-0000-0000-0000-000000000012', true, null),
  ('20000000-0000-0000-0000-000000000013', false, statement_timestamp() + interval '1 day'),
  ('20000000-0000-0000-0000-000000000014', false, statement_timestamp() - interval '1 day'),
  ('20000000-0000-0000-0000-000000000015', false, null)
on conflict (id) do update
set is_premium = excluded.is_premium,
    premium_until = excluded.premium_until;

insert into public.admin_users (user_id, email)
values ('20000000-0000-0000-0000-000000000015', 'soh-reader-admin@example.invalid')
on conflict (user_id) do nothing;

insert into public.bydmate_soh_daily_rollups (
  user_id, vehicle_id, date, device_time, soh_percent
)
select
  entitlement.user_id,
  'tier-gate',
  day.date,
  (day.date::timestamp at time zone 'UTC') + interval '12 hours',
  day.soh_percent
from (values
  ('20000000-0000-0000-0000-000000000011'::uuid),
  ('20000000-0000-0000-0000-000000000012'::uuid),
  ('20000000-0000-0000-0000-000000000013'::uuid),
  ('20000000-0000-0000-0000-000000000014'::uuid),
  ('20000000-0000-0000-0000-000000000015'::uuid)
) entitlement(user_id)
cross join lateral (values
  ((statement_timestamp() at time zone 'UTC')::date - 45, 88::numeric),
  ((statement_timestamp() at time zone 'UTC')::date - 10, 89::numeric)
) day(date, soh_percent);

do $$
declare
  v_from timestamptz := statement_timestamp() - interval '60 days';
  v_to timestamptz := (
    (((statement_timestamp() at time zone 'UTC')::date - 2)::timestamp at time zone 'UTC')
      + interval '23 hours 59 minutes 59.999 seconds'
  );
  v_count integer;
begin
  -- Free: old row is retained but hidden.
  select count(*) into v_count
  from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000011', 'tier-gate', v_from, v_to
  );
  if v_count <> 1 then
    raise exception 'Free SOH reader expected 1 in-window row, got %', v_count;
  end if;

  if exists (
    select 1 from public.bydmate_soh_daily(
      '20000000-0000-0000-0000-000000000011', 'tier-gate', v_from, v_to
    ) where device_time < statement_timestamp() - interval '30 days'
  ) then
    raise exception 'Free SOH reader exposed a row older than the exact 30-day cutoff';
  end if;

  if not exists (
    select 1 from public.bydmate_soh_daily_rollups
    where user_id = '20000000-0000-0000-0000-000000000011'
      and vehicle_id = 'tier-gate'
      and date = (statement_timestamp() at time zone 'UTC')::date - 45
  ) then
    raise exception 'Free entitlement test did not retain its hidden old rollup row';
  end if;

  -- Permanent premium, active term, and admin receive the full requested range.
  select count(*) into v_count from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000012', 'tier-gate', v_from, v_to
  );
  if v_count <> 2 then raise exception 'Permanent premium expected 2 rows, got %', v_count; end if;

  select count(*) into v_count from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000013', 'tier-gate', v_from, v_to
  );
  if v_count <> 2 then raise exception 'Active-term premium expected 2 rows, got %', v_count; end if;

  -- Expired term behaves like free while its old row remains stored.
  select count(*) into v_count from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000014', 'tier-gate', v_from, v_to
  );
  if v_count <> 1 then raise exception 'Expired premium expected 1 row, got %', v_count; end if;

  select count(*) into v_count from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000015', 'tier-gate', v_from, v_to
  );
  if v_count <> 2 then raise exception 'Admin premium expected 2 rows, got %', v_count; end if;
end
$$;

-- The same effective lower bound must constrain partial historical raw reads.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry
) values
  (
    '20000000-0000-0000-0000-000000000011',
    'tier-gate',
    statement_timestamp() - interval '30 days 1 minute',
    '{"soh_percent":70}'
  ),
  (
    '20000000-0000-0000-0000-000000000011',
    'tier-gate',
    statement_timestamp() - interval '29 days 23 hours 59 minutes',
    '{"soh_percent":71}'
  );

do $$
declare
  v_count integer;
begin
  -- Without the early-return gate, the older raw sample lies inside this
  -- caller-requested window and would be returned.
  select count(*) into v_count
  from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000011',
    'tier-gate',
    statement_timestamp() - interval '31 days',
    statement_timestamp() - interval '30 days 30 seconds'
  );
  if v_count <> 0 then
    raise exception 'Free SOH raw reader ignored the exact-cutoff early return';
  end if;

  select count(*) into v_count
  from public.bydmate_soh_daily(
    '20000000-0000-0000-0000-000000000011',
    'tier-gate',
    statement_timestamp() - interval '31 days',
    statement_timestamp() - interval '29 days 23 hours 58 minutes'
  )
  where device_time >= statement_timestamp() - interval '30 days';
  if v_count <> 1 then
    raise exception 'Free SOH raw reader did not return only the post-cutoff sample';
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
