-- Run only against an explicitly selected test account after applying the migration.
-- psql ... -v test_user_id=<uuid> -v test_vehicle_id=<alias> -f <this file>
-- Requires a car for that account/alias, no open sessions, and no pending charging work.
-- All test writes roll back. This is a single-connection transaction contract test;
-- simultaneous-connection locking still requires a separate integration exercise.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '15s';
set local lock_timeout = '3s';
create temporary table charging_test_scope(user_id uuid, vehicle_id text) on commit drop;
insert into charging_test_scope values (:'test_user_id'::uuid, :'test_vehicle_id');

do $$
declare
  u uuid;
  v text;
  snap jsonb;
  state jsonb;
  outcome jsonb;
  ops jsonb;
  times jsonb;
  version bigint;
  session_id uuid := gen_random_uuid();
  measured timestamptz := now();
  failed boolean := false;
  role_name text;
  fn regprocedure;
begin
  select user_id, vehicle_id into u, v from charging_test_scope;
  snap := public.bydmate_read_charging_batch(u, v);
  if snap->'car' = 'null'::jsonb or snap->'sessions' <> '[]'::jsonb
    or snap->'samples' <> '[]'::jsonb then
    raise exception 'Use a test account with a matching car, no open sessions and no pending work';
  end if;
  if not (select relrowsecurity from pg_class
    where oid = 'public.bydmate_pending_charging_samples'::regclass) then
    raise exception 'Queue RLS is disabled';
  end if;
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.bydmate_pending_charging_samples', 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege(role_name, 'public.bydmate_auto_charging_session_state', 'INSERT,UPDATE,DELETE') then
      raise exception 'Unexpected client table privilege for %', role_name;
    end if;
    for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('bydmate_enqueue_charging_samples',
        'bydmate_read_charging_batch', 'bydmate_commit_charging_batch') loop
      if has_function_privilege(role_name, fn, 'EXECUTE')
        or not has_function_privilege('service_role', fn, 'EXECUTE') then
        raise exception 'Incorrect function grant: % / %', role_name, fn;
      end if;
    end loop;
  end loop;
  -- Duplicate measurement, snapshot-only and foreign-vehicle inputs.
  for version in 1..2 loop
    perform public.bydmate_enqueue_charging_samples(u, v, jsonb_build_array(
      jsonb_build_object('vehicle_id', v, 'device_time', measured, 'telemetry',
        '{"soc":50,"charge_power_kw":0,"is_charging":true}'::jsonb,
        'diplus', '{"charge_gun_state":1,"unneeded_field":999}'::jsonb),
      jsonb_build_object('vehicle_id', v, 'device_time', measured + interval '1 second', 'live_only', true),
      jsonb_build_object('vehicle_id', v || '-other', 'device_time', measured)));
  end loop;
  snap := public.bydmate_read_charging_batch(u, v);
  if jsonb_array_length(snap->'samples') <> 1
    or snap #>> '{samples,0,diplus,charge_gun_state}' <> '1'
    or (snap #> '{samples,0,diplus}') ? 'unneeded_field' then
    raise exception 'Queue deduplication/filtering/projection failed';
  end if;
  version := coalesce((snap #>> '{state,state_version}')::bigint, 0);
  state := coalesce(nullif(snap->'state', 'null'::jsonb),
    '{"consecutive_charging_samples":0,"consecutive_unplug_samples":0,"last_is_charging":false}'::jsonb)
    || jsonb_build_object('last_device_time', measured);
  times := jsonb_build_array(measured);
  ops := jsonb_build_array(jsonb_build_object('kind', 'start', 'row', jsonb_build_object(
    'id', session_id, 'user_id', u, 'car_id', snap #>> '{car,id}',
    'start_percent', 50, 'current_percent', 50, 'target_percent', 100,
    'battery_capacity_kwh', snap #> '{car,battery_capacity_kwh}',
    'charger_power_kw', 7, 'efficiency_percent', 98, 'tariff_type', 'home', 'provider_type', 'home',
    'tariff_manual', false, 'price_per_kwh', 1, 'charged_energy_kwh', 0,
    'estimated_cost', 0, 'status', 'charging', 'started_at', measured)));
  outcome := public.bydmate_commit_charging_batch(u, v, version + 1, snap->'sessions',
    snap->'car', state, ops, times);
  if outcome->>'conflict' <> 'true' then raise exception 'Stale version accepted'; end if;
  -- A failed operation after an INSERT must roll back that INSERT and cursor changes.
  begin
    perform public.bydmate_commit_charging_batch(u, v, version, snap->'sessions',
      snap->'car', state, ops || '[{"kind":"invalid"}]'::jsonb, times);
  exception when raise_exception then
    if sqlerrm <> 'Unknown charging operation' then raise; end if;
    failed := true;
  end;
  if not failed or exists(select 1 from public.charging_sessions where id = session_id)
    or (select count(*) from public.bydmate_pending_charging_samples where user_id = u and vehicle_id = v) <> 1
    or (select state_version from public.bydmate_auto_charging_session_state where user_id = u and vehicle_id = v) <> version then
    raise exception 'Failed commit changed durable effects';
  end if;
  outcome := public.bydmate_commit_charging_batch(u, v, version, snap->'sessions',
    snap->'car', state, ops, times);
  if outcome->>'committed' <> 'true' then raise exception 'Valid commit rejected'; end if;
  outcome := public.bydmate_commit_charging_batch(u, v, version, snap->'sessions',
    snap->'car', state, ops, times);
  if outcome->>'conflict' <> 'true' then raise exception 'Replay accepted'; end if;
  snap := public.bydmate_read_charging_batch(u, v);
  if snap->'samples' <> '[]'::jsonb or jsonb_array_length(snap->'sessions') <> 1
    or (snap #>> '{state,state_version}')::bigint <> version + 1 then
    raise exception 'Commit did not atomically consume queue and create session';
  end if;
  outcome := public.bydmate_commit_charging_batch(u, v, version + 1, snap->'sessions',
    snap->'car', state, jsonb_build_array(jsonb_build_object('kind', 'stop', 'id', session_id,
      'patch', jsonb_build_object('stopped_at', measured + interval '1 minute',
        'current_percent', 51, 'charged_energy_kwh', 1, 'estimated_cost', 1))), '[]'::jsonb);
  if outcome->>'committed' <> 'true'
    or not exists(select 1 from public.charging_sessions where id = session_id and status = 'stopped') then
    raise exception 'Stop commit failed';
  end if;
end;
$$;
rollback;
