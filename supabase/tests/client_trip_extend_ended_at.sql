-- Contract test for 20261027120000_bydmate_client_trip_extend_ended_at.sql.
-- Run against an explicitly selected test account:
-- psql ... -v test_user_id=<uuid> -v rehearsal=1 -f supabase/tests/client_trip_extend_ended_at.sql
-- `rehearsal=1` applies the migration inside this transaction before testing it. The function
-- definition and the closed synthetic trip are both rolled back; omit it after a real apply.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '15s';
set local lock_timeout = '3s';
\if :{?rehearsal}
\ir ../migrations/20261027120000_bydmate_client_trip_extend_ended_at.sql
\endif
create temporary table client_trip_end_test_scope(user_id uuid) on commit drop;
insert into client_trip_end_test_scope values (:'test_user_id'::uuid);

do $$
declare
  u uuid := (select user_id from client_trip_end_test_scope);
  trip_id uuid := gen_random_uuid();
  v text := 'zz_client_trip_end_test';
  got_end timestamptz;
  got_last timestamptz;
  got_count integer;
begin
  if has_function_privilege('anon',
      'public.bydmate_apply_client_trip(uuid,text,uuid,jsonb)', 'execute')
    or has_function_privilege('authenticated',
      'public.bydmate_apply_client_trip(uuid,text,uuid,jsonb)', 'execute')
    or not has_function_privilege('service_role',
      'public.bydmate_apply_client_trip(uuid,text,uuid,jsonb)', 'execute') then
    raise exception 'bydmate_apply_client_trip privileges are wrong';
  end if;

  insert into public.bydmate_trips (
    id, user_id, vehicle_id, started_at, ended_at, last_device_time,
    sample_count, distance_km, client_trip
  ) values (
    trip_id, u, v,
    '2001-01-01T00:00:00Z', '2001-01-01T00:10:00Z', '2001-01-01T00:10:00Z',
    10, 5, true
  );

  -- A strictly newer cumulative block is evidence that the same client trip continued.
  perform public.bydmate_apply_client_trip(u, v, trip_id, jsonb_build_object(
    'started_at', '2001-01-01T00:00:00Z',
    'ended_at', '2001-01-01T00:12:00Z',
    'last_device_time', '2001-01-01T00:20:00Z',
    'sample_count', 11,
    'distance_km', 6,
    'max_speed_kmh', 60
  ));
  select ended_at, last_device_time, sample_count
    into got_end, got_last, got_count
    from public.bydmate_trips where id = trip_id;
  if got_end <> '2001-01-01T00:20:00Z'::timestamptz
    or got_last <> '2001-01-01T00:20:00Z'::timestamptz
    or got_count <> 11 then
    raise exception 'strict cumulative advance did not extend the closed trip: %, %, %',
      got_end, got_last, got_count;
  end if;

  -- Equal-count retries can refresh aggregate values, but must never advance either time.
  perform public.bydmate_apply_client_trip(u, v, trip_id, jsonb_build_object(
    'started_at', '2001-01-01T00:00:00Z',
    'ended_at', '2001-01-01T00:25:00Z',
    'last_device_time', '2001-01-01T00:30:00Z',
    'sample_count', 11,
    'distance_km', 7,
    'max_speed_kmh', 60
  ));
  select ended_at, last_device_time into got_end, got_last
    from public.bydmate_trips where id = trip_id;
  if got_end <> '2001-01-01T00:20:00Z'::timestamptz
    or got_last <> '2001-01-01T00:20:00Z'::timestamptz then
    raise exception 'equal-count retry moved a trip time: %, %', got_end, got_last;
  end if;

  -- A stale lower-count block is a no-op even if its timestamp is later.
  perform public.bydmate_apply_client_trip(u, v, trip_id, jsonb_build_object(
    'started_at', '2001-01-01T00:00:00Z',
    'ended_at', '2001-01-01T00:35:00Z',
    'last_device_time', '2001-01-01T00:40:00Z',
    'sample_count', 10,
    'distance_km', 8,
    'max_speed_kmh', 60
  ));
  select ended_at, last_device_time, sample_count
    into got_end, got_last, got_count
    from public.bydmate_trips where id = trip_id;
  if got_end <> '2001-01-01T00:20:00Z'::timestamptz
    or got_last <> '2001-01-01T00:20:00Z'::timestamptz
    or got_count <> 11 then
    raise exception 'stale block changed the trip: %, %, %', got_end, got_last, got_count;
  end if;

  raise notice 'client_trip_extend_ended_at: all checks passed';
end;
$$;

rollback;
