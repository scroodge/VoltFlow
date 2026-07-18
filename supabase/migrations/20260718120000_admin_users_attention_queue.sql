-- Derived, service-role-only attention queue for /admin/users.
-- No new user data is persisted.

create or replace function public.admin_users_attention_queue()
returns table (
  kind text,
  priority integer,
  user_id uuid,
  email text,
  created_at timestamptz,
  last_seen_at timestamptz,
  mate_version text,
  latest_mate_version text,
  premium_until timestamptz
)
language sql
stable
set search_path = public
as $$
  with latest_release as (
    select
      release.version,
      case
        when release.version ~ '^[0-9]+(\.[0-9]+)*$'
          then string_to_array(release.version, '.')::integer[]
      end as version_parts
    from public.mate_app_releases release
    order by release.version_code desc nulls last, release.published_at desc
    limit 1
  ),
  latest_snapshots as (
    select distinct on (snapshot.user_id)
      snapshot.user_id,
      snapshot.mate_version,
      snapshot.received_at
    from public.bydmate_live_snapshots snapshot
    order by snapshot.user_id, snapshot.received_at desc
  ),
  users_with_snapshot_versions as (
    select
      profile.id,
      profile.email,
      profile.created_at,
      profile.is_premium,
      profile.premium_until,
      snapshot.mate_version,
      snapshot.received_at,
      case
        when snapshot.mate_version ~ '^[0-9]+(\.[0-9]+)*$'
          then string_to_array(snapshot.mate_version, '.')::integer[]
      end as mate_version_parts
    from public.profiles profile
    left join latest_snapshots snapshot on snapshot.user_id = profile.id
  ),
  attention as (
    select
      'stale_30d'::text as kind,
      10 as priority,
      account.id as user_id,
      account.email,
      account.created_at,
      account.received_at as last_seen_at,
      account.mate_version,
      null::text as latest_mate_version,
      null::timestamptz as premium_until
    from users_with_snapshot_versions account
    where account.received_at < now() - interval '30 days'

    union all

    select
      'stale_7d'::text,
      20,
      account.id,
      account.email,
      account.created_at,
      account.received_at,
      account.mate_version,
      null::text,
      null::timestamptz
    from users_with_snapshot_versions account
    where account.received_at >= now() - interval '30 days'
      and account.received_at < now() - interval '7 days'

    union all

    select
      'mate_update'::text,
      30,
      account.id,
      account.email,
      account.created_at,
      account.received_at,
      account.mate_version,
      release.version,
      null::timestamptz
    from users_with_snapshot_versions account
    cross join latest_release release
    where account.mate_version_parts is not null
      and release.version_parts is not null
      and account.mate_version_parts < release.version_parts

    union all

    select
      'mate_not_activated'::text,
      40,
      account.id,
      account.email,
      account.created_at,
      null::timestamptz,
      null::text,
      null::text,
      null::timestamptz
    from users_with_snapshot_versions account
    where account.received_at is null
      and account.created_at <= now() - interval '7 days'

    union all

    select
      'premium_expiring'::text,
      50,
      account.id,
      account.email,
      account.created_at,
      account.received_at,
      account.mate_version,
      null::text,
      account.premium_until
    from users_with_snapshot_versions account
    left join public.admin_users admin on admin.user_id = account.id
    where admin.user_id is null
      and coalesce(account.is_premium, false) = false
      and account.premium_until > now()
      and account.premium_until <= now() + interval '14 days'
  )
  select *
  from attention
  order by priority, last_seen_at nulls last, created_at
  limit 50;
$$;

revoke all on function public.admin_users_attention_queue() from public, anon, authenticated;
grant execute on function public.admin_users_attention_queue() to service_role;
