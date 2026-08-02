-- Observe the already-shipped client-trip finalizer without introducing another
-- finalization protocol. One audit row means the final client block actually updated
-- its tenant-scoped trip row; a rejected/replayed block never becomes a false success.
--
-- User-owned operational data: no GPS or raw payload. Retention is a fixed 30 days
-- for every tier and is handled by the existing daily telemetry-purge job.
--
-- Idempotent because the self-hosted deployment has no migration-history table.

create table if not exists public.bydmate_trip_finalization_audits (
  trip_id uuid primary key references public.bydmate_trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vehicle_id text not null,
  ended_at timestamptz not null,
  accepted_at timestamptz not null,
  delivery_delay_seconds integer not null
);

create index if not exists bydmate_trip_finalization_audits_accepted_at_idx
  on public.bydmate_trip_finalization_audits (accepted_at);

alter table public.bydmate_trip_finalization_audits enable row level security;

revoke all on table public.bydmate_trip_finalization_audits from anon, authenticated;
grant select on table public.bydmate_trip_finalization_audits to authenticated;
grant all on table public.bydmate_trip_finalization_audits to service_role;

drop policy if exists "Users can view their own trip finalization audits"
  on public.bydmate_trip_finalization_audits;

create policy "Users can view their own trip finalization audits"
  on public.bydmate_trip_finalization_audits
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- UPDATE-only is deliberate: a final block can only be accepted after ingest has
-- created the tenant-scoped trip stub. Keep the audit in this same transaction so
-- recording it is evidence of an accepted finalization, not merely an HTTP attempt.
create or replace function public.bydmate_apply_client_trip(
  p_user_id uuid,
  p_vehicle_id text,
  p_trip_id uuid,
  p_block jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sample_count integer := coalesce(nullif(p_block->>'sample_count', '')::integer, 0);
  v_block_ended_at timestamptz := nullif(p_block->>'ended_at', '')::timestamptz;
  v_accepted_at timestamptz := clock_timestamp();
  v_updated_trip record;
begin
  update public.bydmate_trips
  set
    started_at = coalesce(nullif(p_block->>'started_at', '')::timestamptz, started_at),
    ended_at = coalesce(ended_at, v_block_ended_at),
    last_device_time = coalesce(
      nullif(p_block->>'last_device_time', '')::timestamptz,
      last_device_time
    ),
    sample_count = v_sample_count,
    distance_km = coalesce(nullif(p_block->>'distance_km', '')::numeric, distance_km),
    soc_start = coalesce(nullif(p_block->>'soc_start', '')::numeric, soc_start),
    soc_end = coalesce(nullif(p_block->>'soc_end', '')::numeric, soc_end),
    max_speed_kmh = coalesce(nullif(p_block->>'max_speed_kmh', '')::numeric, max_speed_kmh),
    avg_speed_kmh = coalesce(nullif(p_block->>'avg_speed_kmh', '')::numeric, avg_speed_kmh),
    avg_consumption_kwh_100km = coalesce(
      nullif(p_block->>'avg_consumption_kwh_100km', '')::numeric,
      avg_consumption_kwh_100km
    ),
    regen_energy_kwh = coalesce(
      nullif(p_block->>'regen_energy_kwh', '')::numeric,
      regen_energy_kwh
    ),
    traction_energy_kwh = coalesce(
      nullif(p_block->>'traction_energy_kwh', '')::numeric,
      traction_energy_kwh
    ),
    client_trip = true
  where id = p_trip_id
    -- A client-minted UUID must never reach another user's row.
    and user_id = p_user_id
    and vehicle_id = p_vehicle_id
    -- `<=` makes a same-count retry idempotent while stale/out-of-order blocks are no-ops.
    and sample_count <= v_sample_count
  returning user_id, vehicle_id into v_updated_trip;

  if found and v_block_ended_at is not null then
    insert into public.bydmate_trip_finalization_audits (
      trip_id,
      user_id,
      vehicle_id,
      ended_at,
      accepted_at,
      delivery_delay_seconds
    )
    values (
      p_trip_id,
      v_updated_trip.user_id,
      v_updated_trip.vehicle_id,
      v_block_ended_at,
      v_accepted_at,
      floor(extract(epoch from (v_accepted_at - v_block_ended_at)))::integer
    )
    on conflict (trip_id) do nothing;
  end if;
end;
$$;

revoke all on function public.bydmate_apply_client_trip(uuid, text, uuid, jsonb) from public;
grant execute on function public.bydmate_apply_client_trip(uuid, text, uuid, jsonb) to service_role;

-- The existing pg_cron job invokes this function daily. Replacing the body keeps one
-- scheduler and makes the fixed audit retention independent of account tier.
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
  v_finalization_audits_deleted bigint;
  v_stale_locations_cleared bigint;
  v_simplify jsonb;
begin
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

  v_simplify := public.simplify_aged_bydmate_trip_tracks();

  delete from public.bydmate_telemetry_samples s
  where s.device_time < now() - interval '30 days'
    and not public.is_user_premium(s.user_id);
  get diagnostics v_samples_deleted = row_count;

  delete from public.bydmate_trip_track_points t
  where t.device_time < now() - interval '30 days'
    and not public.is_user_premium(t.user_id);
  get diagnostics v_track_deleted = row_count;

  delete from public.bydmate_telemetry_hourly h
  where h.hour_start < now() - interval '3 years'
    and not public.is_user_premium(h.user_id);
  get diagnostics v_hourly_deleted = row_count;

  delete from public.bydmate_trip_finalization_audits a
  where a.accepted_at < now() - interval '30 days';
  get diagnostics v_finalization_audits_deleted = row_count;

  return jsonb_build_object(
    'samples_deleted', v_samples_deleted,
    'track_points_deleted', v_track_deleted,
    'hourly_deleted', v_hourly_deleted,
    'trip_finalization_audits_deleted', v_finalization_audits_deleted,
    'stale_locations_cleared', v_stale_locations_cleared,
    'track_simplify', v_simplify
  );
end;
$$;

revoke all on function public.purge_old_bydmate_telemetry_by_tier() from public;
grant execute on function public.purge_old_bydmate_telemetry_by_tier() to service_role;
