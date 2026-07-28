-- Preserve intermittent odometer telemetry in the latest live snapshot.
--
-- BYDMate heartbeats do not always carry mileage. Every live-snapshot write path
-- (including the live_only fast path) updates the same row, so the rule belongs
-- at this table boundary rather than in one ingest RPC body.

create or replace function public.bydmate_preserve_live_odometer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(new.telemetry->>'odometer_km', '') is null
     and nullif(old.telemetry->>'odometer_km', '') is not null then
    new.telemetry := coalesce(new.telemetry, '{}'::jsonb)
      || jsonb_build_object('odometer_km', old.telemetry->'odometer_km');
  end if;

  if new.diplus_mileage_km is null and old.diplus_mileage_km is not null then
    new.diplus_mileage_km := old.diplus_mileage_km;
  end if;

  if nullif(new.diplus->>'mileage_km', '') is null
     and nullif(old.diplus->>'mileage_km', '') is not null then
    new.diplus := coalesce(new.diplus, '{}'::jsonb)
      || jsonb_build_object('mileage_km', old.diplus->'mileage_km');
  end if;

  return new;
end;
$$;

drop trigger if exists bydmate_preserve_live_odometer
  on public.bydmate_live_snapshots;

create trigger bydmate_preserve_live_odometer
before update on public.bydmate_live_snapshots
for each row
execute function public.bydmate_preserve_live_odometer();
