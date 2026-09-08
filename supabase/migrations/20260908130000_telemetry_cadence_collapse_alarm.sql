-- B-12: detect a collapsed telemetry cadence by its backtested symptoms.
--
-- Deliberately do not use sample counts in fixed 10-minute buckets: that rule
-- produced eight false positives on healthy days against two true positives.
-- The independent 24-hour floor only covers the no-moving-sample blind spot.
--
-- Idempotent because this self-hosted deployment has no migration-history table.

create table if not exists public.bydmate_telemetry_cadence_alarm_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  signal text not null check (signal in ('moving_gap', 'low_24h_count')),
  detected_at timestamptz not null default now(),
  observed_at timestamptz not null,
  previous_moving_at timestamptz,
  gap_seconds numeric,
  sample_count_24h integer,
  delivery_attempted_at timestamptz,
  notified_at timestamptz,
  delivery_error text,
  resolved_at timestamptz,
  constraint bydmate_telemetry_cadence_alarm_gap_shape check (
    (signal = 'moving_gap' and previous_moving_at is not null and gap_seconds is not null)
    or
    (signal = 'low_24h_count' and sample_count_24h is not null)
  )
);

create unique index if not exists bydmate_telemetry_cadence_alarm_open_idx
  on public.bydmate_telemetry_cadence_alarm_audits (user_id, vehicle_id, signal)
  where resolved_at is null;

create index if not exists bydmate_telemetry_cadence_alarm_detected_idx
  on public.bydmate_telemetry_cadence_alarm_audits (detected_at desc);

-- Makes the two-latest-moving-samples lookup bounded per vehicle. CONCURRENTLY
-- avoids blocking the live 1 Hz ingest while this is first applied in production.
create index concurrently if not exists bydmate_telemetry_samples_moving_time_idx
  on public.bydmate_telemetry_samples (user_id, vehicle_id, device_time desc)
  include (received_at, diplus_speed_kmh)
  where diplus_speed_kmh > 0;

alter table public.bydmate_telemetry_cadence_alarm_audits enable row level security;
revoke all on table public.bydmate_telemetry_cadence_alarm_audits from public, anon, authenticated;
grant all on table public.bydmate_telemetry_cadence_alarm_audits to service_role;

create or replace function public.bydmate_detect_telemetry_cadence_collapses()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_gap_opened integer := 0;
  v_count_opened integer := 0;
  v_resolved integer := 0;
  v_enqueued integer := 0;
  v_alarm record;
begin
  if not pg_try_advisory_xact_lock(hashtext('bydmate-telemetry-cadence-collapse')) then
    return jsonb_build_object('skipped', true, 'reason', 'already_running');
  end if;

  create temporary table if not exists pg_temp.bydmate_cadence_observations (
    user_id uuid,
    vehicle_id text,
    latest_moving_at timestamptz,
    previous_moving_at timestamptz,
    moving_gap_seconds numeric,
    sample_count_24h integer,
    latest_received_at timestamptz,
    primary key (user_id, vehicle_id)
  ) on commit drop;
  truncate pg_temp.bydmate_cadence_observations;

  insert into pg_temp.bydmate_cadence_observations
  select
    live.user_id,
    live.vehicle_id,
    moving.latest_moving_at,
    moving.previous_moving_at,
    extract(epoch from (moving.latest_moving_at - moving.previous_moving_at)),
    counts.sample_count_24h,
    moving.latest_moving_received_at
  from public.bydmate_live_snapshots live
  cross join lateral (
    select count(*)::integer as sample_count_24h
    from public.bydmate_telemetry_samples sample
    where sample.user_id = live.user_id
      and sample.vehicle_id = live.vehicle_id
      and sample.device_time >= v_now - interval '24 hours'
  ) counts
  left join lateral (
    select
      (array_agg(pair.device_time order by pair.device_time desc))[1] as latest_moving_at,
      (array_agg(pair.device_time order by pair.device_time desc))[2] as previous_moving_at,
      (array_agg(pair.received_at order by pair.device_time desc))[1] as latest_moving_received_at
    from (
      select sample.device_time, sample.received_at
      from public.bydmate_telemetry_samples sample
      where sample.user_id = live.user_id
        and sample.vehicle_id = live.vehicle_id
        and sample.diplus_speed_kmh > 0
      order by sample.device_time desc
      limit 2
    ) pair
  ) moving on true
  -- A completely stale/disconnected vehicle is not a new low-cadence episode.
  where live.received_at >= v_now - interval '24 hours';

  update public.bydmate_telemetry_cadence_alarm_audits audit
  set resolved_at = v_now
  from pg_temp.bydmate_cadence_observations observation
  where audit.user_id = observation.user_id
    and audit.vehicle_id = observation.vehicle_id
    and audit.resolved_at is null
    and (
      (audit.signal = 'moving_gap' and observation.moving_gap_seconds <= 5)
      or
      (audit.signal = 'low_24h_count' and observation.sample_count_24h >= 500)
    );
  get diagnostics v_resolved = row_count;

  insert into public.bydmate_telemetry_cadence_alarm_audits (
    user_id, vehicle_id, signal, observed_at, previous_moving_at, gap_seconds
  )
  select
    observation.user_id,
    observation.vehicle_id,
    'moving_gap',
    observation.latest_moving_at,
    observation.previous_moving_at,
    observation.moving_gap_seconds
  from pg_temp.bydmate_cadence_observations observation
  where observation.moving_gap_seconds > 5
    -- Only react when the second moving sample has just arrived. This prevents
    -- historical gaps from opening alarms when the migration is installed.
    and observation.latest_received_at >= v_now - interval '20 minutes'
  on conflict (user_id, vehicle_id, signal) where resolved_at is null do nothing;
  get diagnostics v_gap_opened = row_count;

  insert into public.bydmate_telemetry_cadence_alarm_audits (
    user_id, vehicle_id, signal, observed_at, sample_count_24h
  )
  select
    observation.user_id,
    observation.vehicle_id,
    'low_24h_count',
    observation.latest_received_at,
    observation.sample_count_24h
  from pg_temp.bydmate_cadence_observations observation
  where observation.sample_count_24h < 500
  on conflict (user_id, vehicle_id, signal) where resolved_at is null do nothing;
  get diagnostics v_count_opened = row_count;

  if exists (select 1 from pg_extension where extname = 'pg_net') then
    for v_alarm in
      update public.bydmate_telemetry_cadence_alarm_audits audit
      set delivery_attempted_at = v_now,
          delivery_error = null
      where audit.resolved_at is null
        and audit.notified_at is null
        and (
          audit.delivery_attempted_at is null
          or audit.delivery_attempted_at <= v_now - interval '10 minutes'
        )
      returning audit.id
    loop
      perform net.http_post(
        url := 'https://voltflow.life/api/cron/telemetry-cadence-alarm',
        headers := jsonb_build_object('content-type', 'application/json'),
        body := jsonb_build_object('alarm_id', v_alarm.id),
        timeout_milliseconds := 10000
      );
      v_enqueued := v_enqueued + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'gap_opened', v_gap_opened,
    'low_count_opened', v_count_opened,
    'resolved', v_resolved,
    'deliveries_enqueued', v_enqueued
  );
end;
$$;

revoke all on function public.bydmate_detect_telemetry_cadence_collapses() from public;
grant execute on function public.bydmate_detect_telemetry_cadence_collapses() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'telemetry-cadence-collapse-alarm';

    perform cron.schedule(
      'telemetry-cadence-collapse-alarm',
      '3,13,23,33,43,53 * * * *',
      $cron$select public.bydmate_detect_telemetry_cadence_collapses()$cron$
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end;
$$;
