-- Daily rollup of telemetry sample counts for /admin/users.
--
-- admin_users_user_metrics counted bydmate_telemetry_samples (3.5 M rows, ~1.8 M in the last
-- 30 d) per request: a Seq Scan reading ~384 k buffers, 58-80 s for one page of 20 users.
-- Completed UTC days are now counted once into a rollup; only "today" is counted live.
-- App-owned operational counters, service-role only. Idempotent: the repo file is the history.

create table if not exists public.admin_user_activity_daily (
  user_id uuid not null,
  day date not null,
  telemetry_count integer not null default 0 check (telemetry_count >= 0),
  primary key (user_id, day)
);

-- A day with zero activity has no rollup rows, so completion needs its own marker.
create table if not exists public.admin_user_activity_days_done (
  day date primary key
);

alter table public.admin_user_activity_daily enable row level security;
alter table public.admin_user_activity_days_done enable row level security;
revoke all on table public.admin_user_activity_daily from public, anon, authenticated;
revoke all on table public.admin_user_activity_days_done from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_user_activity_daily to service_role;
grant select, insert, update, delete on table public.admin_user_activity_days_done to service_role;

-- Fills missing completed UTC days of the last 30. Cheap once caught up (one marker lookup).
-- Advisory lock: concurrent admin requests must not double-count a day.
create or replace function public.admin_users_refresh_activity_daily()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_day date;
  v_filled integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('admin_users_refresh_activity_daily')) then
    return 0;
  end if;

  for v_day in
    select d::date
    from generate_series(v_today - 30, v_today - 1, interval '1 day') d
    where not exists (
      select 1 from public.admin_user_activity_days_done done where done.day = d::date
    )
    order by d
  loop
    insert into public.admin_user_activity_daily (user_id, day, telemetry_count)
    select s.user_id, v_day, count(*)::integer
    from public.bydmate_telemetry_samples s
    where s.device_time >= (v_day::timestamp at time zone 'UTC')
      and s.device_time < ((v_day + 1)::timestamp at time zone 'UTC')
    group by s.user_id
    on conflict (user_id, day) do update set telemetry_count = excluded.telemetry_count;

    insert into public.admin_user_activity_days_done (day) values (v_day)
    on conflict (day) do nothing;
    v_filled := v_filled + 1;
  end loop;

  delete from public.admin_user_activity_daily where day < v_today - 30;
  delete from public.admin_user_activity_days_done where day < v_today - 30;
  return v_filled;
end;
$$;

revoke execute on function public.admin_users_refresh_activity_daily() from public, anon, authenticated;
grant execute on function public.admin_users_refresh_activity_daily() to service_role;

-- Same signature and columns. 7 d / 30 d telemetry are now calendar windows: today (live) plus
-- the previous 6 / 29 completed UTC days (rollup).
create or replace function public.admin_users_user_metrics(p_user_ids uuid[])
returns table(
  user_id uuid,
  latest_mate_version text,
  last_seen_at timestamptz,
  telemetry_7d bigint,
  telemetry_30d bigint,
  trips_7d bigint,
  trips_30d bigint,
  sessions_7d bigint,
  sessions_30d bigint
)
language sql
stable
set search_path = public
as $$
  with params as (
    select (now() at time zone 'UTC')::date as today
  ),
  requested as (
    select unnest(coalesce(p_user_ids, '{}'::uuid[])) as user_id
  ),
  latest as (
    select distinct on (s.user_id)
      s.user_id,
      s.mate_version::text as latest_mate_version,
      s.device_time as last_seen_at
    from public.bydmate_live_snapshots s
    where s.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
    order by s.user_id, s.device_time desc
  ),
  rolled as (
    select
      d.user_id,
      coalesce(sum(d.telemetry_count) filter (where d.day >= params.today - 6), 0) as c7,
      coalesce(sum(d.telemetry_count), 0) as c30
    from public.admin_user_activity_daily d
    cross join params
    where d.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
      and d.day >= params.today - 29
      and d.day < params.today
    group by d.user_id
  ),
  live_today as (
    select s.user_id, count(*) as c
    from public.bydmate_telemetry_samples s
    cross join params
    where s.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
      and s.device_time >= (params.today::timestamp at time zone 'UTC')
    group by s.user_id
  ),
  trips as (
    select
      t.user_id,
      count(*) filter (where t.started_at >= now() - interval '7 days') as trips_7d,
      count(*) filter (where t.started_at >= now() - interval '30 days') as trips_30d
    from public.bydmate_trips t
    where t.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
      and t.started_at >= now() - interval '30 days'
    group by t.user_id
  ),
  sessions as (
    select
      c.user_id,
      count(*) filter (where c.created_at >= now() - interval '7 days') as sessions_7d,
      count(*) filter (where c.created_at >= now() - interval '30 days') as sessions_30d
    from public.charging_sessions c
    where c.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
      and c.created_at >= now() - interval '30 days'
    group by c.user_id
  )
  select
    r.user_id,
    l.latest_mate_version,
    l.last_seen_at,
    coalesce(ro.c7, 0) + coalesce(lt.c, 0),
    coalesce(ro.c30, 0) + coalesce(lt.c, 0),
    coalesce(tr.trips_7d, 0),
    coalesce(tr.trips_30d, 0),
    coalesce(c.sessions_7d, 0),
    coalesce(c.sessions_30d, 0)
  from requested r
  left join latest l using (user_id)
  left join rolled ro using (user_id)
  left join live_today lt using (user_id)
  left join trips tr using (user_id)
  left join sessions c using (user_id);
$$;

revoke execute on function public.admin_users_user_metrics(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_users_user_metrics(uuid[]) to service_role;
