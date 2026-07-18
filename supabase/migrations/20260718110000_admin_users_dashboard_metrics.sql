-- Admin users dashboard metrics: lifecycle counters and exact aggregate stats.
-- App-owned operational data. No deleted-user identifiers are retained.

create table if not exists public.admin_user_lifecycle_daily (
  metric_date date primary key,
  registered_count integer not null default 0 check (registered_count >= 0),
  removed_count integer not null default 0 check (removed_count >= 0)
);

alter table public.admin_user_lifecycle_daily enable row level security;
revoke all on table public.admin_user_lifecycle_daily from public, anon, authenticated;
grant select, insert, update on table public.admin_user_lifecycle_daily to service_role;

-- Backfill registrations once. ON CONFLICT DO NOTHING keeps a re-run from replacing
-- historical registration counts after accounts have subsequently been deleted.
insert into public.admin_user_lifecycle_daily (metric_date, registered_count)
select
  (created_at at time zone 'Europe/Minsk')::date,
  count(*)::integer
from public.profiles
group by (created_at at time zone 'Europe/Minsk')::date
on conflict (metric_date) do nothing;

create or replace function public.bump_admin_user_lifecycle_daily()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metric_date date;
begin
  v_metric_date := (
    case when tg_op = 'DELETE' then old.created_at else new.created_at end
    at time zone 'Europe/Minsk'
  )::date;

  insert into public.admin_user_lifecycle_daily (
    metric_date,
    registered_count,
    removed_count
  )
  values (
    v_metric_date,
    case when tg_op = 'INSERT' then 1 else 0 end,
    case when tg_op = 'DELETE' then 1 else 0 end
  )
  on conflict (metric_date) do update
  set registered_count = public.admin_user_lifecycle_daily.registered_count
    + excluded.registered_count,
      removed_count = public.admin_user_lifecycle_daily.removed_count
    + excluded.removed_count;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.bump_admin_user_lifecycle_daily() from public, anon, authenticated;

drop trigger if exists admin_user_lifecycle_daily_insert on public.profiles;
create trigger admin_user_lifecycle_daily_insert
after insert on public.profiles
for each row execute function public.bump_admin_user_lifecycle_daily();

drop trigger if exists admin_user_lifecycle_daily_delete on public.profiles;
create trigger admin_user_lifecycle_daily_delete
after delete on public.profiles
for each row execute function public.bump_admin_user_lifecycle_daily();

create or replace function public.admin_users_dashboard_stats()
returns table (
  connected_today bigint,
  registered_users_total bigint,
  registered_today bigint,
  removed_today bigint,
  trips_recorded_total bigint,
  removals_tracked_since date
)
language sql
stable
set search_path = public
as $$
  with today as (
    select (now() at time zone 'Europe/Minsk')::date as metric_date
  )
  select
    (
      select count(distinct live.user_id)
      from public.bydmate_live_snapshots live
      cross join today
      where live.received_at >= (today.metric_date at time zone 'Europe/Minsk')
    )::bigint as connected_today,
    (select count(*) from public.profiles)::bigint as registered_users_total,
    coalesce((
      select lifecycle.registered_count
      from public.admin_user_lifecycle_daily lifecycle
      cross join today
      where lifecycle.metric_date = today.metric_date
    ), 0)::bigint as registered_today,
    coalesce((
      select lifecycle.removed_count
      from public.admin_user_lifecycle_daily lifecycle
      cross join today
      where lifecycle.metric_date = today.metric_date
    ), 0)::bigint as removed_today,
    (select count(*) from public.bydmate_trips)::bigint as trips_recorded_total,
    date '2026-07-18' as removals_tracked_since;
$$;

-- The Next.js route calls this only after requireAdmin(). Keep it out of the browser
-- roles and avoid SECURITY DEFINER so the service role remains the only privileged caller.
revoke all on function public.admin_users_dashboard_stats() from public, anon, authenticated;
grant execute on function public.admin_users_dashboard_stats() to service_role;
