-- Historical end-of-charge cell-delta trend across charging sessions.
--
-- Why this is persisted rather than computed on read: raw bydmate_telemetry_samples
-- are pruned (30 d free / 365 d premium) and bydmate_telemetry_hourly has no
-- cell-delta columns. Computing the trend from raw samples would silently truncate
-- history to the retention window. Capturing the value once, when the session closes,
-- keeps the trend for the life of the session row.
--
-- The metric: the maximum cell delta observed while still charging in the session's
-- end phase (SOC within 1 point of the session's final SOC). Delta relaxes as soon as
-- current stops, so samples after unplug are excluded on purpose.

alter table public.charging_sessions
  add column if not exists end_max_cell_delta_v numeric;

alter table public.charging_sessions
  add column if not exists end_delta_soc numeric;

comment on column public.charging_sessions.end_max_cell_delta_v is
  'Max cell voltage delta (V) seen while charging within 1 SOC point of the session end. Captured at session close; NULL when telemetry had no cell data.';
comment on column public.charging_sessions.end_delta_soc is
  'SOC (%) at which end_max_cell_delta_v was observed.';

-- Cell delta lives both in the flat column and (for older rows) inside the telemetry
-- blob; read both. Values outside 0..1 V are BMS garbage, not a real pack delta.
create or replace function public.bydmate_sample_cell_delta_v(
  p_flat numeric,
  p_telemetry jsonb
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select coalesce(
    p_flat,
    public.bydmate_jsonb_numeric(p_telemetry, 'diplus_cell_delta_v'),
    public.bydmate_jsonb_numeric(p_telemetry, 'cell_delta_v')
  );
$$;

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
  v_end_soc numeric;
  v_delta numeric;
  v_soc numeric;
begin
  select s.id, s.user_id, s.car_id, s.started_at, s.stopped_at, s.current_percent
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

  v_end_soc := v_session.current_percent;
  if v_end_soc is null then
    return;
  end if;

  select s.delta, s.soc into v_delta, v_soc
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
    and s.soc >= v_end_soc - 1
    and (s.is_charging or s.charge_power_kw > 0)
  order by s.delta desc
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

revoke all on function public.bydmate_sample_cell_delta_v(numeric, jsonb) from public;
revoke all on function public.bydmate_capture_session_end_delta(uuid) from public;

grant execute on function public.bydmate_sample_cell_delta_v(numeric, jsonb) to authenticated, service_role;
grant execute on function public.bydmate_capture_session_end_delta(uuid) to authenticated, service_role;

-- Backfill closed sessions whose raw samples are still within the retention window.
-- Idempotent: only fills rows that have no captured value yet.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select id
    from public.charging_sessions
    where status <> 'charging'
      and started_at is not null
      and end_max_cell_delta_v is null
    order by started_at desc
  loop
    perform public.bydmate_capture_session_end_delta(v_id);
  end loop;
end;
$$;
