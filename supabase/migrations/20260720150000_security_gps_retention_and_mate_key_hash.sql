-- Privacy hardening: exact GPS lifecycle, Premium retention policy, and hashed Mate pairing keys.
--
-- Premium data remains retained forever. Free-account retention stays unchanged.

alter table public.profiles
  add column if not exists bydmate_cloud_api_key_hash text,
  add column if not exists bydmate_cloud_api_key_fingerprint text;

create unique index if not exists profiles_bydmate_cloud_api_key_hash_unique
  on public.profiles (bydmate_cloud_api_key_hash)
  where bydmate_cloud_api_key_hash is not null;

alter table public.bydmate_link_codes
  add column if not exists api_key_hash text,
  add column if not exists api_key_fingerprint text;

-- The pairing code has a unique, server-derived pending key. It is promoted to the
-- profile only by the redeem route, so opening a new pairing screen does not disconnect
-- the currently paired Mate.
create index if not exists bydmate_link_codes_api_key_hash_idx
  on public.bydmate_link_codes (api_key_hash)
  where api_key_hash is not null and redeemed_at is null;

-- Premium means the original route history is retained as well: do not apply the
-- lossy RDP point reduction to premium/admin trips. Free-account route history keeps
-- the existing storage optimization before its 30-day retention limit.
create or replace function public.simplify_aged_bydmate_trip_tracks(
  p_max_trips int default 1000,
  p_tolerance_m double precision default 12,
  p_min_age_hours int default 48
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip record;
  v_trips int := 0;
  v_deleted bigint := 0;
  v_d int;
begin
  for v_trip in
    select id
    from public.bydmate_trips
    where ended_at is not null
      and ended_at < now() - make_interval(hours => p_min_age_hours)
      and track_simplified_at is null
      and not public.is_user_premium(user_id)
    order by ended_at asc
    limit p_max_trips
  loop
    v_d := public.rdp_simplify_trip_track(v_trip.id, p_tolerance_m);
    v_trips := v_trips + 1;
    v_deleted := v_deleted + v_d;
  end loop;

  return jsonb_build_object(
    'trips_simplified', v_trips,
    'points_deleted', v_deleted
  );
end;
$$;

revoke all on function public.simplify_aged_bydmate_trip_tracks(int, double precision, int) from public;

-- The existing pg_cron job calls this function by name. Redefining it is therefore an
-- idempotent rollout of the revised policy, rather than a second competing job.
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
  v_stale_locations_cleared bigint;
  v_simplify jsonb;
begin
  -- A live status can outlive a car connection. Keep its SOC/state, but not an old
  -- exact location or its duplicate in the diagnostic payload.
  update public.bydmate_live_snapshots
  set
    location = '{}'::jsonb,
    raw_payload = raw_payload - 'location'
  where received_at < now() - interval '24 hours'
    and (
      location ? 'lat'
      or location ? 'lon'
      or coalesce(raw_payload->'location', '{}'::jsonb) ? 'lat'
      or coalesce(raw_payload->'location', '{}'::jsonb) ? 'lon'
    );
  get diagnostics v_stale_locations_cleared = row_count;

  -- Free-account routes keep the existing simplification; Premium/Admin exact tracks
  -- are not altered so the user-owned historical record remains intact forever.
  v_simplify := public.simplify_aged_bydmate_trip_tracks();

  -- Free accounts keep raw telemetry and exact tracks for 30 days.
  delete from public.bydmate_telemetry_samples s
  where s.device_time < now() - interval '30 days'
    and not public.is_user_premium(s.user_id);
  get diagnostics v_samples_deleted = row_count;

  delete from public.bydmate_trip_track_points t
  where t.device_time < now() - interval '30 days'
    and not public.is_user_premium(t.user_id);
  get diagnostics v_track_deleted = row_count;

  -- Hourly aggregates have a three-year horizon for free accounts. Premium/Admin data,
  -- including aggregates, remains retained forever.
  delete from public.bydmate_telemetry_hourly h
  where h.hour_start < now() - interval '3 years'
    and not public.is_user_premium(h.user_id);
  get diagnostics v_hourly_deleted = row_count;

  return jsonb_build_object(
    'samples_deleted', v_samples_deleted,
    'track_points_deleted', v_track_deleted,
    'hourly_deleted', v_hourly_deleted,
    'stale_locations_cleared', v_stale_locations_cleared,
    'track_simplify', v_simplify
  );
end;
$$;

revoke all on function public.purge_old_bydmate_telemetry_by_tier() from public;
grant execute on function public.purge_old_bydmate_telemetry_by_tier() to service_role;
