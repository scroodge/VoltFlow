-- Keep GPS trip tracks long-term but shrink them.
--
-- Problem: bydmate_trip_track_points stores ~1 Hz points (avg ~470/trip). At ~326
-- bytes/row that table is dominated by per-row overhead, not the 16-byte lat/lon.
-- The 1 Hz cadence is hugely redundant for drawing a route line.
--
-- Mechanism: once a trip has *settled* (closed >= 48h ago), run Ramer-Douglas-Peucker
-- over its points and drop the ones that lie within `tolerance_m` of the line between
-- their kept neighbours. This preserves the route *shape* on the map while removing
-- redundant points (typically an 80-90% reduction). Recent trips keep full resolution.
--
-- We do NOT touch bydmate_ingest_telemetry (hot path) -- simplification runs as a
-- batch over closed trips, scheduled alongside the retention purge.
--
-- Retention change: tracks are no longer hard-deleted at 30d/365d by tier. Simplified
-- tracks are kept for 3 years (matching the hourly rollups) so the route map stays
-- available long-term. Raw telemetry_samples retention (30d free / 365d premium) is
-- unchanged.

-- Idempotent: self-hosted instances have no supabase_migrations tracking, so this file
-- must be safe to re-run.

alter table public.bydmate_trips
  add column if not exists track_simplified_at timestamptz;

-- Douglas-Peucker simplification of a single trip's track. Returns the number of
-- points deleted. Always endpoints are kept; trips with <= 2 points are left as-is.
-- Distance is computed in metres via a local equirectangular projection (good for the
-- small spatial extent of a single trip).
create or replace function public.rdp_simplify_trip_track(
  p_trip_id uuid,
  p_tolerance_m double precision default 12
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids   uuid[];
  v_lats  double precision[];
  v_lons  double precision[];
  v_keep  boolean[];
  n int;
  v_deleted int := 0;
  r constant double precision := 6371000;  -- earth radius, metres

  lo_stack int[];
  hi_stack int[];
  u int;
  lo int;
  hi int;
  i int;
  idx int;
  coslat double precision;
  ax double precision; ay double precision;
  bx double precision; by_ double precision;
  px double precision; py double precision;
  dx double precision; dy double precision;
  seg_len2 double precision;
  cross_v double precision;
  d double precision;
  dmax double precision;
begin
  select array_agg(id order by device_time, id),
         array_agg(lat order by device_time, id),
         array_agg(lon order by device_time, id)
    into v_ids, v_lats, v_lons
  from public.bydmate_trip_track_points
  where trip_id = p_trip_id;

  n := coalesce(array_length(v_ids, 1), 0);

  if n <= 2 then
    update public.bydmate_trips set track_simplified_at = now() where id = p_trip_id;
    return 0;
  end if;

  v_keep := array_fill(false, array[n]);
  v_keep[1] := true;
  v_keep[n] := true;

  lo_stack := array[1];
  hi_stack := array[n];

  while array_length(lo_stack, 1) > 0 loop
    u  := array_upper(lo_stack, 1);
    lo := lo_stack[u];
    hi := hi_stack[u];
    lo_stack := lo_stack[1:u-1];
    hi_stack := hi_stack[1:u-1];

    if hi <= lo + 1 then
      continue;
    end if;

    -- project segment endpoints to metres using the segment's mean latitude
    coslat := cos(radians((v_lats[lo] + v_lats[hi]) / 2.0));
    ax := radians(v_lons[lo]) * r * coslat;
    ay := radians(v_lats[lo]) * r;
    bx := radians(v_lons[hi]) * r * coslat;
    by_ := radians(v_lats[hi]) * r;
    dx := bx - ax;
    dy := by_ - ay;
    seg_len2 := dx * dx + dy * dy;

    dmax := -1;
    idx := lo;
    for i in lo + 1 .. hi - 1 loop
      px := radians(v_lons[i]) * r * coslat;
      py := radians(v_lats[i]) * r;
      if seg_len2 = 0 then
        d := sqrt((px - ax) ^ 2 + (py - ay) ^ 2);
      else
        -- perpendicular distance from point to the infinite line through A-B
        cross_v := dx * (py - ay) - dy * (px - ax);
        d := abs(cross_v) / sqrt(seg_len2);
      end if;
      if d > dmax then
        dmax := d;
        idx := i;
      end if;
    end loop;

    if dmax > p_tolerance_m then
      v_keep[idx] := true;
      lo_stack := lo_stack || lo;  hi_stack := hi_stack || idx;
      lo_stack := lo_stack || idx; hi_stack := hi_stack || hi;
    end if;
  end loop;

  delete from public.bydmate_trip_track_points
  where trip_id = p_trip_id
    and id in (
      select v_ids[s]
      from generate_subscripts(v_ids, 1) as s
      where not v_keep[s]
    );
  get diagnostics v_deleted = row_count;

  update public.bydmate_trips set track_simplified_at = now() where id = p_trip_id;
  return v_deleted;
end;
$$;

revoke all on function public.rdp_simplify_trip_track(uuid, double precision) from public;

-- Simplify settled trips that have not been simplified yet. Bounded by p_max_trips so a
-- single run stays cheap; oldest-unsimplified first. Returns a small summary.
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

-- Retention purge, updated:
--   * raw telemetry_samples: unchanged (365d premium / 30d free)
--   * trip track points: simplify settled trips, then keep them for 3 years
--     (was: hard-delete at 365d/30d by tier). Route maps now survive long-term.
--   * hourly rollups: unchanged (3 years)
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
  -- Shrink settled trip tracks (keeps the route line, drops redundant ~1 Hz points).
  v_simplify := public.simplify_aged_bydmate_trip_tracks();

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

  -- Tracks are simplified, not tier-purged; only drop them past the 3-year horizon.
  delete from public.bydmate_trip_track_points t
  where t.device_time < now() - interval '3 years';
  get diagnostics v_track_deleted = row_count;

  delete from public.bydmate_telemetry_hourly
  where hour_start < now() - interval '3 years';
  get diagnostics v_hourly_deleted = row_count;

  return jsonb_build_object(
    'samples_deleted', v_samples_deleted,
    'track_points_deleted', v_track_deleted,
    'track_simplify', v_simplify,
    'hourly_deleted', v_hourly_deleted
  );
end;
$$;
