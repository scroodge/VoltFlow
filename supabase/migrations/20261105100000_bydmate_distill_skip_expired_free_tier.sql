-- Distill batch: skip free-tier trips / sessions older than the free raw window (BACKLOG "Prod DB
-- retention & cleanup", item 1f). Their raw samples are already pruned, so the run wrote an empty series,
-- the free-tier cleanup at the end of the same run deleted it, and the next run picked the same newest
-- 200 again — premium history was never reached (1 965 premium trips with raw samples left undistilled).
-- Only the candidate filter changes; distill, cleanup and grants are as in 20261103210000.
create or replace function public.bydmate_distill_telemetry_series(p_batch integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_trips integer := 0;
  v_sessions integer := 0;
  v_free_deleted integer;
  v_free uuid[];
begin
  -- is_user_premium per distinct user, never per row (a per-row call timed out on the samples table).
  select coalesce(array_agg(u.user_id), '{}')
  into v_free
  from (
    select distinct user_id from public.bydmate_trips
    union
    select distinct user_id from public.charging_sessions
  ) u
  where u.user_id is not null
    and not public.is_user_premium(u.user_id);

  for v_id in
    select t.id
    from public.bydmate_trips t
    left join public.bydmate_trip_series s on s.trip_id = t.id
    where t.source = 'telemetry'
      and t.ended_at is not null
      and t.ended_at < now() - interval '6 hours'
      and s.trip_id is null
      and not (t.user_id = any (v_free) and t.started_at < now() - interval '30 days')
    order by t.ended_at desc
    limit greatest(p_batch, 0)
  loop
    perform public.bydmate_distill_trip_series(v_id);
    v_trips := v_trips + 1;
  end loop;

  for v_id in
    select c.id
    from public.charging_sessions c
    left join public.bydmate_charging_session_series s on s.session_id = c.id
    where c.status <> 'charging'
      and c.started_at is not null
      and coalesce(c.stopped_at, c.updated_at) < now() - interval '6 hours'
      and (
        s.session_id is null
        or (c.updated_at > s.distilled_at and c.updated_at > now() - interval '90 days')
      )
      and not (c.user_id = any (v_free) and c.started_at < now() - interval '30 days')
    order by coalesce(c.stopped_at, c.updated_at) desc
    limit greatest(p_batch, 0)
  loop
    perform public.bydmate_distill_charging_session_series(v_id);
    v_sessions := v_sessions + 1;
  end loop;

  with free_users as (
    select u.user_id
    from (
      select distinct user_id from public.bydmate_trip_series
      union
      select distinct user_id from public.bydmate_charging_session_series
    ) u
    where not public.is_user_premium(u.user_id)
  ),
  del_trips as (
    delete from public.bydmate_trip_series s
    using public.bydmate_trips t
    where t.id = s.trip_id
      and s.user_id in (select user_id from free_users)
      and t.started_at < now() - interval '30 days'
    returning 1
  ),
  del_sessions as (
    delete from public.bydmate_charging_session_series s
    where s.user_id in (select user_id from free_users)
      and s.window_from < now() - interval '30 days'
    returning 1
  )
  select (select count(*) from del_trips) + (select count(*) from del_sessions)
  into v_free_deleted;

  return jsonb_build_object(
    'trips', v_trips,
    'sessions', v_sessions,
    'free_deleted', coalesce(v_free_deleted, 0)
  );
end;
$$;

revoke execute on function public.bydmate_distill_telemetry_series(integer) from public, anon, authenticated;
grant execute on function public.bydmate_distill_telemetry_series(integer) to service_role;
