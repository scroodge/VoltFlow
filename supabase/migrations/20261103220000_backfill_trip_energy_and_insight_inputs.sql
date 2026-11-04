-- One-off backfill before the premium raw-sample purge (BACKLOG "Prod DB retention & cleanup",
-- item 1b). Both values are computed from raw samples and stored on their own rows; after the purge
-- they could no longer be computed.
--
-- * Trip energy: 214 finished telemetry trips had no regen/traction (177 with power samples left);
--   the trip list (`attach-trip-energy.ts`) recomputed them from raw samples on every load.
--   Same function the trip close uses, so the numbers do not change.
-- * Route-insight inputs: 1 560 finished trips with a GPS track had no projection row; the track is
--   kept, but the outside/battery temperature averages come from raw samples.
--
-- DML only (no DDL, no table locks). It touches finished trips, which ingest no longer writes.
-- Idempotent: only rows still missing are processed.
do $$
declare
  v_trip_id uuid;
begin
  for v_trip_id in
    select t.id
    from public.bydmate_trips t
    where t.source = 'telemetry'
      and t.ended_at is not null
      and (t.regen_energy_kwh is null or t.traction_energy_kwh is null)
  loop
    perform public.bydmate_finalize_trip_energy(v_trip_id);
  end loop;

  for v_trip_id in
    select t.id
    from public.bydmate_trips t
    where t.ended_at is not null
      and t.track_point_count > 1
      and not exists (
        select 1 from public.bydmate_trip_insight_inputs i where i.trip_id = t.id
      )
  loop
    perform public.bydmate_refresh_trip_insight_input(v_trip_id);
  end loop;
end;
$$;
