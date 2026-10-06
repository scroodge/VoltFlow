-- Range prediction ledger, phase 1: freeze the car's end-of-charge range promise.
--
-- The user asked: remember the km prediction made at the end of each charge, then grade
-- it against the next discharge cycle ("how true was the forecast, what went wrong").
-- Grading needs the promise captured NOW: raw telemetry samples are pruned (30 d free /
-- 365 d premium), so range_est_km would be gone before any later comparison could run.
-- Same rationale (and same capture hook) as end_max_cell_delta_v in 20260717120000.
--
-- Captured per session, from in-window charging samples:
--   end_range_est_km — the car's own range_est_km (APK/Di+ estimate) on the LAST fresh
--     charging sample (SOC must also be present, so km-per-% stays self-consistent).
--   end_range_soc    — the SOC that prediction belonged to.
--   end_voltflow_est_km — Voltflow's own model at the same anchor SOC; written by the
--     TS capture wrapper (src/lib/voltflowmate/range-prediction-capture.ts) after this
--     RPC, because the estimator lives in TypeScript and must not be re-implemented here.
--
-- These columns are historical prediction artifacts only. The ban on feeding
-- range_est_km into the live user-visible estimate (range-estimate.test.mjs) is
-- unchanged: nothing in the estimator dependency graph reads them.
--
-- The function keeps its (uuid) signature, so the hardened privileges from
-- 20260917110000 survive; revoke/grant are repeated defensively.
-- The delta-capture logic is byte-identical to 20260914120000; range capture is an
-- independent block so a session with no cell deltas still records its promise.

alter table public.charging_sessions
  add column if not exists end_range_est_km numeric,
  add column if not exists end_range_soc numeric,
  add column if not exists end_voltflow_est_km numeric;

comment on column public.charging_sessions.end_range_est_km is
  'Car-reported range estimate (km) on the last charging sample of the session. '
  'Historical prediction artifact for accuracy grading — never feeds the live estimate.';

comment on column public.charging_sessions.end_range_soc is
  'SOC (%) that end_range_est_km was reported at; the anchor for km-per-% math.';

comment on column public.charging_sessions.end_voltflow_est_km is
  'Voltflow model estimate (km) at the same anchor SOC, captured at close by '
  'src/lib/voltflowmate/range-prediction-capture.ts. Null for sessions closed before '
  'this feature.';

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
  v_range_est_km numeric;
  v_range_soc numeric;
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

  -- End-of-charge range promise: the LAST charging sample in the session window that
  -- carries both range_est_km and SOC. Independent of the cell-delta path above —
  -- a session with no Di+ deltas must still record its promise.
  select
    public.bydmate_jsonb_numeric(t.telemetry, 'range_est_km'),
    public.bydmate_jsonb_numeric(t.telemetry, 'soc')
    into v_range_est_km, v_range_soc
  from public.bydmate_telemetry_samples t
  where t.user_id = v_session.user_id
    and t.vehicle_id = v_vehicle_id
    and t.device_time >= v_session.started_at
    and t.device_time <= coalesce(v_session.stopped_at, now())
    and (
      coalesce((t.telemetry->>'is_charging')::boolean, false)
      or coalesce(public.bydmate_jsonb_numeric(t.telemetry, 'charge_power_kw'), 0) > 0
    )
    and public.bydmate_jsonb_numeric(t.telemetry, 'range_est_km') between 0 and 1000
    and public.bydmate_jsonb_numeric(t.telemetry, 'soc') is not null
  order by t.device_time desc
  limit 1;

  if v_delta is null and v_range_est_km is null then
    return;
  end if;

  update public.charging_sessions
  set end_max_cell_delta_v = coalesce(v_delta, end_max_cell_delta_v),
      end_delta_soc = coalesce(v_soc, end_delta_soc),
      end_median_cell_delta_v = coalesce(v_median_delta, end_median_cell_delta_v),
      end_range_est_km = coalesce(v_range_est_km, end_range_est_km),
      end_range_soc = coalesce(v_range_soc, end_range_soc)
  where id = p_session_id;
end;
$$;

revoke all on function public.bydmate_capture_session_end_delta(uuid) from public, anon, authenticated;
grant execute on function public.bydmate_capture_session_end_delta(uuid) to authenticated, service_role;

-- Backfill sessions still inside sample retention whose promise was never captured.
-- Sessions whose samples are already pruned simply find no rows and stay null.
--
-- Bounded and sliced on purpose (2026-10-06): the first unbounded run over all ~1,100
-- closed sessions was cancelled after ~10 min without finishing — one transaction, so
-- all its work rolled back. Each slice below is its own statement = its own implicit
-- transaction: cancel or crash keeps the completed slices, and the `end_range_est_km
-- is null` filter makes every slice idempotent to re-run. Older promises are not worth
-- scanning for: free-tier samples are pruned at 30 days anyway.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select id
    from public.charging_sessions
    where status <> 'charging'
      and started_at is not null
      and end_range_est_km is null
      and coalesce(stopped_at, started_at) >= now() - interval '30 days'
    order by coalesce(stopped_at, started_at) desc
  loop
    perform public.bydmate_capture_session_end_delta(v_id);
  end loop;
end;
$$;

do $$
declare
  v_id uuid;
begin
  for v_id in
    select id
    from public.charging_sessions
    where status <> 'charging'
      and started_at is not null
      and end_range_est_km is null
      and coalesce(stopped_at, started_at) >= now() - interval '60 days'
      and coalesce(stopped_at, started_at) < now() - interval '30 days'
    order by coalesce(stopped_at, started_at) desc
  loop
    perform public.bydmate_capture_session_end_delta(v_id);
  end loop;
end;
$$;

do $$
declare
  v_id uuid;
begin
  for v_id in
    select id
    from public.charging_sessions
    where status <> 'charging'
      and started_at is not null
      and end_range_est_km is null
      and coalesce(stopped_at, started_at) >= now() - interval '90 days'
      and coalesce(stopped_at, started_at) < now() - interval '60 days'
    order by coalesce(stopped_at, started_at) desc
  loop
    perform public.bydmate_capture_session_end_delta(v_id);
  end loop;
end;
$$;
