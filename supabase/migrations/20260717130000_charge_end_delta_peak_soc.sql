-- Fix the end-of-charge cell-delta capture: anchor the "end phase" to the peak SOC
-- the telemetry actually recorded, not to charging_sessions.current_percent.
--
-- Found after the first backfill (20260717120000): one session carried
-- current_percent = 86 while its samples clearly charged to 100%. Anchoring on that
-- stale value made the end phase "SOC >= 85", which swept in the real 100% tail and
-- reported a 265 mV tail delta as if it were a partial charge's end delta.
--
-- The session row can be stale; the samples cannot. Peak SOC is derived from the
-- charging samples inside the session window, so the metric is self-consistent and
-- end_delta_soc becomes the honest answer to "at what SOC was this measured".
--
-- This migration recomputes EVERY closed session, not just uncaptured ones: values
-- written under the previous definition must be revised.

create or replace function public.bydmate_capture_session_end_delta(p_session_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_session record;
  v_vehicle_id text;
  v_peak_soc numeric;
  v_delta numeric;
  v_soc numeric;
begin
  select s.id, s.user_id, s.car_id, s.started_at, s.stopped_at
    into v_session
  from public.charging_sessions s
  where s.id = p_session_id;

  if not found or v_session.started_at is null then
    return;
  end if;

  select c.vehicle_alias into v_vehicle_id
  from public.cars c
  where c.id = v_session.car_id;

  if v_vehicle_id is null or btrim(v_vehicle_id) = '' then
    return;
  end if;

  with charging_samples as (
    select s.delta, s.soc
    from (
      select
        public.bydmate_sample_cell_delta_v(t.diplus_cell_delta_v, t.telemetry) as delta,
        public.bydmate_jsonb_numeric(t.telemetry, 'soc') as soc,
        coalesce((t.telemetry->>'is_charging')::boolean, false) as is_charging,
        coalesce(public.bydmate_jsonb_numeric(t.telemetry, 'charge_power_kw'), 0) as charge_power_kw
      from public.bydmate_telemetry_samples t
      where t.user_id = v_session.user_id
        and t.vehicle_id = v_vehicle_id
        and t.device_time >= v_session.started_at
        and t.device_time <= coalesce(v_session.stopped_at, now())
    ) as s
    where s.delta is not null
      and s.delta > 0
      and s.delta <= 1
      and s.soc is not null
      and (s.is_charging or s.charge_power_kw > 0)
  ),
  peak as (
    select max(soc) as peak_soc from charging_samples
  )
  select cs.delta, cs.soc
    into v_delta, v_soc
  from charging_samples cs, peak
  where peak.peak_soc is not null
    and cs.soc >= peak.peak_soc - 1
  order by cs.delta desc
  limit 1;

  if v_delta is null then
    return;
  end if;

  update public.charging_sessions
  set end_max_cell_delta_v = v_delta,
      end_delta_soc = v_soc
  where id = p_session_id;
end;
$$;

revoke all on function public.bydmate_capture_session_end_delta(uuid) from public;
grant execute on function public.bydmate_capture_session_end_delta(uuid) to authenticated, service_role;

-- Recompute every closed session under the corrected definition.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select id
    from public.charging_sessions
    where status <> 'charging'
      and started_at is not null
    order by started_at desc
  loop
    perform public.bydmate_capture_session_end_delta(v_id);
  end loop;
end;
$$;
