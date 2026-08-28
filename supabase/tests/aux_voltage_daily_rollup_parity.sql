\set ON_ERROR_STOP on
begin;

-- Baseline is public.bydmate_aux_voltage_daily_raw_baseline: a frozen copy of
-- the pre-rollup RPC, never the rewritten reader or a view over rollups.
insert into auth.users (id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000004'),
  ('10000000-0000-0000-0000-000000000005'),
  ('10000000-0000-0000-0000-000000000006'),
  ('10000000-0000-0000-0000-000000000007');

insert into public.cars (
  user_id, vehicle_alias, battery_chemistry, model_generation, created_at
) values
  ('10000000-0000-0000-0000-000000000001', 'midnight-flooded', 'flooded', 'gen1_2024', '2026-01-01'),
  ('10000000-0000-0000-0000-000000000002', 'sparse-efb', 'efb', 'gen1_2024', '2026-01-01'),
  ('10000000-0000-0000-0000-000000000003', 'dense-agm', 'agm', 'gen1_2024', '2026-01-01'),
  ('10000000-0000-0000-0000-000000000004', 'fallback-lifepo4', 'lifepo4', 'gen2_2025', '2026-01-01'),
  ('10000000-0000-0000-0000-000000000005', 'other', 'other', 'gen1_2024', '2026-01-01'),
  ('10000000-0000-0000-0000-000000000006', 'no-resting', 'flooded', 'gen1_2024', '2026-01-01'),
  -- NULL chemistry exercises the model-generation fallback as well.
  ('10000000-0000-0000-0000-000000000007', 'derived-lifepo4', null, 'gen2_2025', '2026-01-01');

-- Parked interval begins on the previous UTC date and qualifies after midnight.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_voltage_12v,
  diplus_speed_kmh, diplus_power_kw, diplus_charge_gun_state
)
select
  '10000000-0000-0000-0000-000000000001', 'midnight-flooded', sample_time,
  jsonb_build_object('aux_voltage_v', 12.4, 'speed_kmh', 0, 'power_kw', 0, 'charge_power_kw', 0),
  12.4, 0, 0, '1'
from generate_series(
  '2026-08-19 22:00 UTC'::timestamptz,
  '2026-08-20 03:00 UTC'::timestamptz,
  interval '30 minutes'
) sample_time;

-- Sparse EFB day. The 13.2 V value contributes to min/max but is above the
-- resting ceiling and must not contribute to the median/count.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_voltage_12v,
  diplus_speed_kmh, diplus_power_kw, diplus_charge_gun_state
) values
  ('10000000-0000-0000-0000-000000000002', 'sparse-efb', '2026-08-20 00:00 UTC', '{"aux_voltage_v":12.8,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 12.8, 0, 0, '1'),
  ('10000000-0000-0000-0000-000000000002', 'sparse-efb', '2026-08-20 02:00 UTC', '{"aux_voltage_v":12.6,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 12.6, 0, 0, '1'),
  ('10000000-0000-0000-0000-000000000002', 'sparse-efb', '2026-08-20 03:00 UTC', '{"aux_voltage_v":13.2,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 13.2, 0, 0, '1');

-- Dense AGM day (361 source samples, including the two-hour lookbehind).
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_voltage_12v,
  diplus_speed_kmh, diplus_power_kw, diplus_charge_gun_state
)
select
  '10000000-0000-0000-0000-000000000003', 'dense-agm', sample_time,
  jsonb_build_object(
    'aux_voltage_v', 12.5 + (extract(minute from sample_time)::integer % 8) / 10.0,
    'speed_kmh', 0, 'power_kw', 0, 'charge_power_kw', 0
  ),
  12.5 + (extract(minute from sample_time)::integer % 8) / 10.0,
  0, 0, '1'
from generate_series(
  '2026-08-19 22:00 UTC'::timestamptz,
  '2026-08-20 04:00 UTC'::timestamptz,
  interval '1 minute'
) sample_time;

-- Sanitized-with-Di+-fallback case: the qualified 02:30 sample has no JSON
-- voltage, so it affects resting median/count but not sanitized min/max.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_voltage_12v,
  diplus_speed_kmh, diplus_power_kw, diplus_charge_gun_state
) values
  ('10000000-0000-0000-0000-000000000004', 'fallback-lifepo4', '2026-08-20 00:00 UTC', '{"aux_voltage_v":13.0,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 13.0, 0, 0, '1'),
  ('10000000-0000-0000-0000-000000000004', 'fallback-lifepo4', '2026-08-20 02:00 UTC', '{"aux_voltage_v":13.2,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 13.2, 0, 0, '1'),
  ('10000000-0000-0000-0000-000000000004', 'fallback-lifepo4', '2026-08-20 02:30 UTC', '{"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 13.4, 0, 0, '1');

-- Other chemistry has no ceiling.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_voltage_12v,
  diplus_speed_kmh, diplus_power_kw, diplus_charge_gun_state
) values
  ('10000000-0000-0000-0000-000000000005', 'other', '2026-08-20 00:00 UTC', '{"aux_voltage_v":14.2,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 14.2, 0, 0, '1'),
  ('10000000-0000-0000-0000-000000000005', 'other', '2026-08-20 02:00 UTC', '{"aux_voltage_v":14.0,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 14.0, 0, 0, '1'),
  ('10000000-0000-0000-0000-000000000005', 'other', '2026-08-20 03:00 UTC', '{"aux_voltage_v":14.4,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 14.4, 0, 0, '1');

-- A day with valid voltage but no resting samples.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_voltage_12v,
  diplus_speed_kmh, diplus_power_kw, diplus_charge_gun_state
) values
  ('10000000-0000-0000-0000-000000000006', 'no-resting', '2026-08-20 10:00 UTC', '{"aux_voltage_v":12.1,"speed_kmh":20,"power_kw":3,"charge_power_kw":0}', 12.1, 20, 3, '1'),
  ('10000000-0000-0000-0000-000000000006', 'no-resting', '2026-08-20 10:30 UTC', '{"aux_voltage_v":12.3,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 12.3, 0, 0, '1');

-- Model-derived LiFePO4 ceiling.
insert into public.bydmate_telemetry_samples (
  user_id, vehicle_id, device_time, telemetry, diplus_voltage_12v,
  diplus_speed_kmh, diplus_power_kw, diplus_charge_gun_state
) values
  ('10000000-0000-0000-0000-000000000007', 'derived-lifepo4', '2026-08-20 00:00 UTC', '{"aux_voltage_v":13.1,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 13.1, 0, 0, '1'),
  ('10000000-0000-0000-0000-000000000007', 'derived-lifepo4', '2026-08-20 02:00 UTC', '{"aux_voltage_v":13.3,"speed_kmh":0,"power_kw":0,"charge_power_kw":0}', 13.3, 0, 0, '1');

select public.bydmate_materialize_aux_voltage_day(c.user_id, c.vehicle_alias, '2026-08-20')
from public.cars c;

\echo 'PARITY_MISMATCHES (expected: 0 rows)'
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
  select user_id, vehicle_id, date, v_min, v_max, v_resting, resting_sample_count
  from public.bydmate_aux_voltage_daily_rollups
  where date = '2026-08-20'
),
mismatches as (
  select
    coalesce(b.user_id, r.user_id) as user_id,
    coalesce(b.vehicle_id, r.vehicle_id) as vehicle_id,
    coalesce(b.date, r.date) as date,
    b.v_min as baseline_v_min, r.v_min as rollup_v_min,
    b.v_max as baseline_v_max, r.v_max as rollup_v_max,
    b.v_resting as baseline_v_resting, r.v_resting as rollup_v_resting,
    b.resting_sample_count as baseline_count,
    r.resting_sample_count as rollup_count
  from baseline b
  full join rolled_up r using (user_id, vehicle_id, date)
  where b.v_min is distinct from r.v_min
     or b.v_max is distinct from r.v_max
     or b.v_resting is distinct from r.v_resting
     or b.resting_sample_count is distinct from r.resting_sample_count
)
select * from mismatches order by vehicle_id;

-- Make the script fail, rather than merely print differences.
do $$
begin
  if exists (
    with baseline as (
      select c.user_id, c.vehicle_alias as vehicle_id, b.*
      from public.cars c
      cross join lateral public.bydmate_aux_voltage_daily_raw_baseline(
        c.user_id, c.vehicle_alias, '2026-08-20 00:00 UTC',
        '2026-08-21 00:00 UTC'::timestamptz - interval '1 microsecond'
      ) b
    )
    select 1
    from baseline b
    full join public.bydmate_aux_voltage_daily_rollups r
      on r.user_id = b.user_id and r.vehicle_id = b.vehicle_id and r.date = b.date
    where coalesce(r.date, b.date) = '2026-08-20'
      and (b.v_min is distinct from r.v_min
        or b.v_max is distinct from r.v_max
        or b.v_resting is distinct from r.v_resting
        or b.resting_sample_count is distinct from r.resting_sample_count)
  ) then
    raise exception 'aux voltage raw/rollup parity mismatch';
  end if;
end
$$;

\echo 'CHEMISTRY_PROVENANCE'
select vehicle_id, battery_chemistry, resting_ceiling_v
from public.bydmate_aux_voltage_daily_rollups
order by vehicle_id;

\echo 'MIDNIGHT_DATES (expected: only 2026-08-20)'
select date
from public.bydmate_aux_voltage_daily_raw_baseline(
  '10000000-0000-0000-0000-000000000001', 'midnight-flooded',
  '2026-08-20 00:00 UTC',
  '2026-08-21 00:00 UTC'::timestamptz - interval '1 microsecond'
);

\echo 'CHEMISTRY_REBUILD_QUEUE (expected: 1 row with chemistry_changed)'
update public.cars
set battery_chemistry = 'agm'
where user_id = '10000000-0000-0000-0000-000000000001'
  and vehicle_alias = 'midnight-flooded';
select vehicle_id, date, reason
from public.bydmate_aux_voltage_rollup_queue
where user_id = '10000000-0000-0000-0000-000000000001';

rollback;
