-- Fold chronic repeat cadence-collapse alarms into a once-daily digest (BACKLOG.md,
-- "Cadence-collapse alarm: fold chronic repeats into a daily digest").
--
-- Evidence (14-day prod read, 2026-09-24): most accounts get 1-3 alarms in two weeks and
-- self-resolve, exactly as the 2026-09-11 backtest intended. Two accounts are chronic --
-- the same (user_id, vehicle_id, signal) genuinely opens and closes roughly once a day for
-- two weeks straight. Each occurrence is a real detection, not a rule bug, but it pages
-- admins on Telegram every time. Fix delivery volume, not the detection rule.
--
-- New behavior: the first time a given (user_id, vehicle_id, signal) is *notified* in a
-- rolling 24h window, it still pages immediately (unchanged latency for a brand-new
-- problem). A repeat of that same tuple within 24h of its last notification is left
-- undelivered by the immediate path; a new once-daily job sweeps up everything still
-- undelivered after a grace period and sends one grouped digest per admin instead.
--
-- Only the detector's delivery loop changes, plus a new function/schedule for the digest.
-- Never edit 20260908130000 or 20260911100000, both already applied.
-- Idempotent because this self-hosted deployment has no migration-history table.

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

  create temporary table if not exists pg_temp.bydmate_cadence_pair_observations (
    user_id uuid,
    vehicle_id text,
    moving_pair_count integer,
    worst_moving_at timestamptz,
    worst_previous_at timestamptz,
    worst_gap_seconds numeric,
    sample_count_24h integer,
    last_received_at timestamptz,
    primary key (user_id, vehicle_id)
  ) on commit drop;
  truncate pg_temp.bydmate_cadence_pair_observations;

  insert into pg_temp.bydmate_cadence_pair_observations
  select
    live.user_id,
    live.vehicle_id,
    moving.moving_pair_count,
    moving.worst_moving_at,
    moving.worst_previous_at,
    moving.worst_gap_seconds,
    counts.sample_count_24h,
    live.received_at
  from public.bydmate_live_snapshots live
  cross join lateral (
    select count(*)::integer as sample_count_24h
    from public.bydmate_telemetry_samples sample
    where sample.user_id = live.user_id
      and sample.vehicle_id = live.vehicle_id
      and sample.device_time >= v_now - interval '24 hours'
  ) counts
  cross join lateral (
    select
      count(*)::integer as moving_pair_count,
      (array_agg(pair.device_time order by pair.gap_seconds desc))[1] as worst_moving_at,
      (array_agg(pair.previous_device_time order by pair.gap_seconds desc))[1] as worst_previous_at,
      max(pair.gap_seconds) as worst_gap_seconds
    from (
      select
        sample.device_time,
        previous.device_time as previous_device_time,
        extract(epoch from (sample.device_time - previous.device_time)) as gap_seconds
      -- Candidates come from the partial moving index (device_time, received_at and
      -- speed are all covered by it).
      from public.bydmate_telemetry_samples sample
      cross join lateral (
        select earlier.device_time, earlier.diplus_speed_kmh
        from public.bydmate_telemetry_samples earlier
        where earlier.user_id = sample.user_id
          and earlier.vehicle_id = sample.vehicle_id
          and earlier.device_time < sample.device_time
        order by earlier.device_time desc
        limit 1
      ) previous
      where sample.user_id = live.user_id
        and sample.vehicle_id = live.vehicle_id
        and sample.diplus_speed_kmh > 0
        and sample.device_time >= v_now - interval '24 hours'
        -- Overlaps the 10-minute schedule; the open-alarm unique index de-duplicates.
        and sample.received_at >= v_now - interval '11 minutes'
        and previous.diplus_speed_kmh > 0
    ) pair
  ) moving
  -- A completely stale/disconnected vehicle is not a new low-cadence episode.
  where live.received_at >= v_now - interval '24 hours';

  update public.bydmate_telemetry_cadence_alarm_audits audit
  set resolved_at = v_now
  from pg_temp.bydmate_cadence_pair_observations observation
  where audit.user_id = observation.user_id
    and audit.vehicle_id = observation.vehicle_id
    and audit.resolved_at is null
    and (
      -- Resolve only on fresh evidence: moving pairs arrived and none of them is a gap.
      (audit.signal = 'moving_gap'
        and observation.moving_pair_count > 0
        and observation.worst_gap_seconds <= 8)
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
    observation.worst_moving_at,
    observation.worst_previous_at,
    observation.worst_gap_seconds
  from pg_temp.bydmate_cadence_pair_observations observation
  where observation.worst_gap_seconds > 8
  on conflict (user_id, vehicle_id, signal) where resolved_at is null do nothing;
  get diagnostics v_gap_opened = row_count;

  insert into public.bydmate_telemetry_cadence_alarm_audits (
    user_id, vehicle_id, signal, observed_at, sample_count_24h
  )
  select
    observation.user_id,
    observation.vehicle_id,
    'low_24h_count',
    observation.last_received_at,
    observation.sample_count_24h
  from pg_temp.bydmate_cadence_pair_observations observation
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
        -- Cooldown: a repeat of a tuple already notified inside the last 24h is left
        -- undelivered here (notified_at stays null, delivery_attempted_at stays untouched)
        -- so the daily digest picks it up instead of paging admins again immediately.
        and not exists (
          select 1
          from public.bydmate_telemetry_cadence_alarm_audits earlier
          where earlier.user_id = audit.user_id
            and earlier.vehicle_id = audit.vehicle_id
            and earlier.signal = audit.signal
            and earlier.notified_at is not null
            and earlier.notified_at >= v_now - interval '24 hours'
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

-- Once-daily sweep: everything still undelivered (notified_at is null) past a 15-minute
-- grace period -- either cooldown-suppressed repeats, or a rare stuck first-time delivery
-- (e.g. no_admin_telegram) -- goes out as one grouped message per admin instead of being
-- retried individually forever.
create or replace function public.bydmate_dispatch_telemetry_cadence_digest()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ids uuid[];
begin
  if not pg_try_advisory_xact_lock(hashtext('bydmate-telemetry-cadence-digest')) then
    return jsonb_build_object('skipped', true, 'reason', 'already_running');
  end if;

  select array_agg(audit.id)
  into v_ids
  from public.bydmate_telemetry_cadence_alarm_audits audit
  where audit.notified_at is null
    and audit.detected_at <= v_now - interval '15 minutes';

  if v_ids is null or array_length(v_ids, 1) is null then
    return jsonb_build_object('enqueued', false, 'reason', 'nothing_to_digest');
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_net') then
    perform net.http_post(
      url := 'https://voltflow.life/api/cron/telemetry-cadence-digest',
      headers := jsonb_build_object('content-type', 'application/json'),
      body := jsonb_build_object('alarm_ids', to_jsonb(v_ids)),
      timeout_milliseconds := 15000
    );
    return jsonb_build_object('enqueued', true, 'alarm_count', array_length(v_ids, 1));
  end if;

  return jsonb_build_object('enqueued', false, 'reason', 'pg_net_unavailable');
end;
$$;

revoke all on function public.bydmate_dispatch_telemetry_cadence_digest() from public;
grant execute on function public.bydmate_dispatch_telemetry_cadence_digest() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'telemetry-cadence-alarm-digest';

    -- 08:00 UTC: after the 24h cooldown window has rolled past every admin's overnight,
    -- one digest per calendar day rather than a fixed rolling window.
    perform cron.schedule(
      'telemetry-cadence-alarm-digest',
      '0 8 * * *',
      $cron$select public.bydmate_dispatch_telemetry_cadence_digest()$cron$
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end;
$$;
