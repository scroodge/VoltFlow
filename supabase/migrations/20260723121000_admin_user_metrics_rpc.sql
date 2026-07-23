-- Keep admin filtering and per-user enrichment in grouped database queries rather
-- than issuing one count/latest-snapshot request per profile from the API route.
create or replace function public.admin_users_activity_filter_ids(p_filter text)
returns table(user_id uuid)
language sql
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where case p_filter
    when '7d' then exists (
      select 1 from public.bydmate_telemetry_samples s
      where s.user_id = p.id and s.device_time >= now() - interval '7 days'
    )
    when '30d' then exists (
      select 1 from public.bydmate_telemetry_samples s
      where s.user_id = p.id and s.device_time >= now() - interval '30 days'
    )
    when '24h' then exists (
      select 1 from public.bydmate_live_snapshots s
      where s.user_id = p.id and s.device_time >= now() - interval '24 hours'
    )
    when '7d_seen' then exists (
      select 1 from public.bydmate_live_snapshots s
      where s.user_id = p.id and s.device_time >= now() - interval '7 days'
    )
    when '30d_seen' then exists (
      select 1 from public.bydmate_live_snapshots s
      where s.user_id = p.id and s.device_time >= now() - interval '30 days'
    )
    when 'never' then not exists (
      select 1 from public.bydmate_live_snapshots s where s.user_id = p.id
    )
    else false
  end;
$$;

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
security definer
set search_path = public
as $$
  with requested as (
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
  telemetry as (
    select
      s.user_id,
      count(*) filter (where s.device_time >= now() - interval '7 days') as telemetry_7d,
      count(*) filter (where s.device_time >= now() - interval '30 days') as telemetry_30d
    from public.bydmate_telemetry_samples s
    where s.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
      and s.device_time >= now() - interval '30 days'
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
    coalesce(t.telemetry_7d, 0),
    coalesce(t.telemetry_30d, 0),
    coalesce(tr.trips_7d, 0),
    coalesce(tr.trips_30d, 0),
    coalesce(c.sessions_7d, 0),
    coalesce(c.sessions_30d, 0)
  from requested r
  left join latest l using (user_id)
  left join telemetry t using (user_id)
  left join trips tr using (user_id)
  left join sessions c using (user_id);
$$;

revoke all on function public.admin_users_activity_filter_ids(text) from public, anon, authenticated;
revoke all on function public.admin_users_user_metrics(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_users_activity_filter_ids(text) to service_role;
grant execute on function public.admin_users_user_metrics(uuid[]) to service_role;
