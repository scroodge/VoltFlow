-- Premium duration support + tiered telemetry retention.
-- Premium entitlement rules:
-- 1) admin_users are always premium (no term),
-- 2) profiles.is_premium true,
-- 3) profiles.premium_until in the future.

alter table public.profiles
add column if not exists premium_until timestamptz;

create or replace function public.is_user_premium(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = p_user_id
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        p.is_premium = true
        or (p.premium_until is not null and p.premium_until > p_now)
      )
  );
$$;

create or replace function public.purge_old_bydmate_telemetry_by_tier()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_samples_deleted bigint;
  v_track_deleted bigint;
  v_hourly_deleted bigint;
begin
  with premium_users as (
    select p.id as user_id
    from public.profiles p
    where public.is_user_premium(p.id)
  )
  delete from public.bydmate_trip_track_points t
  where (
    (t.device_time < now() - interval '90 days' and t.user_id in (select user_id from premium_users))
    or
    (t.device_time < now() - interval '30 days' and t.user_id not in (select user_id from premium_users))
  );
  get diagnostics v_track_deleted = row_count;

  with premium_users as (
    select p.id as user_id
    from public.profiles p
    where public.is_user_premium(p.id)
  )
  delete from public.bydmate_telemetry_samples s
  where (
    (s.device_time < now() - interval '90 days' and s.user_id in (select user_id from premium_users))
    or
    (s.device_time < now() - interval '30 days' and s.user_id not in (select user_id from premium_users))
  );
  get diagnostics v_samples_deleted = row_count;

  -- Keep existing hourly rollup retention policy for everyone.
  delete from public.bydmate_telemetry_hourly
  where hour_start < now() - interval '3 years';
  get diagnostics v_hourly_deleted = row_count;

  return jsonb_build_object(
    'samples_deleted', v_samples_deleted,
    'track_points_deleted', v_track_deleted,
    'hourly_deleted', v_hourly_deleted
  );
end;
$$;

-- Backward compatibility: keep previous function name as wrapper.
create or replace function public.purge_old_bydmate_telemetry()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.purge_old_bydmate_telemetry_by_tier();
$$;

revoke all on function public.purge_old_bydmate_telemetry_by_tier() from public;
grant execute on function public.purge_old_bydmate_telemetry_by_tier() to service_role;

revoke all on function public.purge_old_bydmate_telemetry() from public;
grant execute on function public.purge_old_bydmate_telemetry() to service_role;

-- Keep same cron job name, but point it to tiered function.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'purge-bydmate-telemetry';

    perform cron.schedule(
      'purge-bydmate-telemetry',
      '0 3 * * *',
      $cron$select public.purge_old_bydmate_telemetry_by_tier()$cron$
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end;
$$;
