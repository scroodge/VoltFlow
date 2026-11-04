-- Trip energy: store the sums when the trip has more than one power sample, like the TS twin
-- `calculateTripEnergy` (src/lib/voltflowmate/trip-energy.ts, `powerSampleCount > 1`). The old body
-- stored them only when the *last* sample had power, so a trip ending on a power-less sample got NULL
-- (67 finished trips on prod, found by the 20261103220000 backfill). The trip list hid it by
-- recomputing from raw samples on every load; after the 90-day raw purge it no longer could
-- (BACKLOG "Prod DB retention & cleanup", item 1e).
-- Interval rule, 180 s gap and formula are unchanged. Side effect, also matching TS: a trip with
-- exactly one power sample, at its end, now gets NULL instead of 0.
create or replace function public.bydmate_finalize_trip_energy(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.bydmate_trips%rowtype;
  v_prev_time timestamptz;
  v_prev_power numeric;
  v_dt_seconds numeric;
  v_energy record;
  v_regen numeric := 0;
  v_traction numeric := 0;
  v_power_samples integer := 0;
  v_sample record;
begin
  select * into v_trip from public.bydmate_trips where id = p_trip_id;
  if not found or v_trip.ended_at is null then
    return;
  end if;

  for v_sample in
    select
      s.device_time,
      nullif(s.telemetry->>'power_kw', '')::numeric as power_kw
    from public.bydmate_telemetry_samples s
    where s.user_id = v_trip.user_id
      and s.vehicle_id = v_trip.vehicle_id
      and s.device_time >= v_trip.started_at
      and s.device_time <= v_trip.ended_at
    order by s.device_time asc
  loop
    if v_sample.power_kw is not null then
      v_power_samples := v_power_samples + 1;
    end if;
    if v_prev_time is not null and v_prev_power is not null and v_sample.power_kw is not null then
      v_dt_seconds := extract(epoch from (v_sample.device_time - v_prev_time));
      if v_dt_seconds > 0 and v_dt_seconds <= 180 then
        select * into v_energy
        from public.bydmate_interval_energy_kwh(v_prev_power, v_sample.power_kw, v_dt_seconds);
        v_regen := v_regen + coalesce(v_energy.regen_kwh, 0);
        v_traction := v_traction + coalesce(v_energy.traction_kwh, 0);
      end if;
    end if;
    v_prev_time := v_sample.device_time;
    v_prev_power := v_sample.power_kw;
  end loop;

  update public.bydmate_trips
  set
    regen_energy_kwh = case when v_power_samples > 1 then v_regen else null end,
    traction_energy_kwh = case when v_power_samples > 1 then v_traction else null end
  where id = p_trip_id;
end;
$$;

revoke execute on function public.bydmate_finalize_trip_energy(uuid) from public, anon, authenticated;
grant execute on function public.bydmate_finalize_trip_energy(uuid) to service_role;

-- Re-run for the finished trips still missing energy (DML on finished trips only, no table locks).
do $$
declare
  v_trip_id uuid;
begin
  for v_trip_id in
    select t.id
    from public.bydmate_trips t
    where t.source = 'telemetry'
      and t.ended_at is not null
      and (t.regen_energy_kwh is null or t.traction_energy_kwh is null)
  loop
    perform public.bydmate_finalize_trip_energy(v_trip_id);
  end loop;
end;
$$;
