-- Battery Consistency phase 1: add a robust (median) top-of-charge cell-voltage-delta
-- reading alongside the existing raw-max one.
--
-- bydmate_capture_session_end_delta() already picks a single sample via
-- `order by cs.delta desc limit 1` over the top-of-charge window (peak_soc - 1..peak_soc).
-- That is exactly the "one noisy measurement" problem: a single transient reading can
-- report a spike that isn't representative of the pack's actual balance at full charge.
-- end_max_cell_delta_v is left untouched so the existing chart keeps working unchanged;
-- this adds a second, more trustworthy column for trend analysis.
--
-- Reuses the project's own established "representative value over noisy samples" idiom
-- (percentile_cont(0.5) within group, per 20260826210000_aux_voltage_resting_chemistry_ceiling.sql)
-- rather than inventing a new robust-stat approach.
--
-- No new table, no new trigger, no new call site: all three existing callers of
-- bydmate_capture_session_end_delta() (manual stop, atomic auto-close, reconciliation)
-- get the new column populated for free. No backfill: pre-existing closed sessions keep
-- end_median_cell_delta_v null until re-captured (explicit product choice, see BACKLOG.md).

alter table public.charging_sessions
  add column if not exists end_median_cell_delta_v numeric;

comment on column public.charging_sessions.end_median_cell_delta_v is
  'Median cell-voltage delta (V) over the top-of-charge window (peak_soc - 1..peak_soc), '
  'a noise-robust companion to end_max_cell_delta_v. Null until the session has been '
  'captured under this definition.';

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
  v_delta numeric;
  v_soc numeric;
  v_median_delta numeric;
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
  ),
  top_of_charge as (
    select cs.delta, cs.soc
    from charging_samples cs, peak
    where peak.peak_soc is not null
      and cs.soc >= peak.peak_soc - 1
  )
  select
    (select toc.delta from top_of_charge toc order by toc.delta desc limit 1),
    (select toc.soc from top_of_charge toc order by toc.delta desc limit 1),
    (select percentile_cont(0.5) within group (order by toc.delta) from top_of_charge toc)
    into v_delta, v_soc, v_median_delta;

  if v_delta is null then
    return;
  end if;

  update public.charging_sessions
  set end_max_cell_delta_v = v_delta,
      end_delta_soc = v_soc,
      end_median_cell_delta_v = v_median_delta
  where id = p_session_id;
end;
$$;

revoke all on function public.bydmate_capture_session_end_delta(uuid) from public;
grant execute on function public.bydmate_capture_session_end_delta(uuid) to authenticated, service_role;
