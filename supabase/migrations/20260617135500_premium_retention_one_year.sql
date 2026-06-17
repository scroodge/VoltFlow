-- Adjust premium raw telemetry retention window from 90 days to 1 year.
-- Keep non-premium raw telemetry retention at 30 days.

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
    (t.device_time < now() - interval '365 days' and t.user_id in (select user_id from premium_users))
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
    (s.device_time < now() - interval '365 days' and s.user_id in (select user_id from premium_users))
    or
    (s.device_time < now() - interval '30 days' and s.user_id not in (select user_id from premium_users))
  );
  get diagnostics v_samples_deleted = row_count;

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

