-- Paying users (premium) and admins keep ALL their telemetry forever; scale disk
-- instead of deleting their data. Only free users are pruned.
--
-- Note: public.is_user_premium(user_id) already returns true for admins (it checks
-- admin_users first), so "premium OR admin" == is_user_premium(). The purge therefore
-- only touches users for whom is_user_premium() is false.
--
-- Free users:        samples > 30d deleted, tracks > 30d deleted, hourly > 3y deleted.
-- Premium + admin:   nothing deleted, ever.
-- Track simplification (RDP, migration 20260626120000) still runs for everyone -- it
-- preserves the route shape and only removes redundant ~1 Hz points, so it is a size
-- optimization, not data loss.
--
-- Idempotent (self-hosted has no supabase_migrations tracking).

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
  v_simplify jsonb;
begin
  -- Shrink settled trip tracks for ALL users (keeps the route line, drops redundant
  -- ~1 Hz points). Runs before any deletion.
  v_simplify := public.simplify_aged_bydmate_trip_tracks();

  -- Free-only deletions. Premium + admin (is_user_premium = true) are fully exempt.
  with protected_users as (
    select p.id as user_id
    from public.profiles p
    where public.is_user_premium(p.id)
  )
  delete from public.bydmate_telemetry_samples s
  where s.device_time < now() - interval '30 days'
    and s.user_id not in (select user_id from protected_users);
  get diagnostics v_samples_deleted = row_count;

  with protected_users as (
    select p.id as user_id
    from public.profiles p
    where public.is_user_premium(p.id)
  )
  delete from public.bydmate_trip_track_points t
  where t.device_time < now() - interval '30 days'
    and t.user_id not in (select user_id from protected_users);
  get diagnostics v_track_deleted = row_count;

  with protected_users as (
    select p.id as user_id
    from public.profiles p
    where public.is_user_premium(p.id)
  )
  delete from public.bydmate_telemetry_hourly h
  where h.hour_start < now() - interval '3 years'
    and h.user_id not in (select user_id from protected_users);
  get diagnostics v_hourly_deleted = row_count;

  return jsonb_build_object(
    'samples_deleted', v_samples_deleted,
    'track_points_deleted', v_track_deleted,
    'track_simplify', v_simplify,
    'hourly_deleted', v_hourly_deleted
  );
end;
$$;
