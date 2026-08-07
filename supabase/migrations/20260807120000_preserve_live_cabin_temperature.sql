-- Preserve intermittent cabin temperature in the latest live snapshot.
--
-- Parked/status heartbeats intentionally omit cabin temperature. Keep the last valid
-- reading at the live-snapshot boundary so a sparse update cannot erase it.

create or replace function public.bydmate_preserve_live_cabin_temperature()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(new.telemetry->>'cabin_temp_c', '') is null
     and nullif(old.telemetry->>'cabin_temp_c', '') is not null then
    new.telemetry := coalesce(new.telemetry, '{}'::jsonb)
      || jsonb_build_object('cabin_temp_c', old.telemetry->'cabin_temp_c');
  end if;

  if new.diplus_inside_temp_c is null and old.diplus_inside_temp_c is not null then
    new.diplus_inside_temp_c := old.diplus_inside_temp_c;
  end if;

  if nullif(new.diplus->>'inside_temp_c', '') is null
     and nullif(old.diplus->>'inside_temp_c', '') is not null then
    new.diplus := coalesce(new.diplus, '{}'::jsonb)
      || jsonb_build_object('inside_temp_c', old.diplus->'inside_temp_c');
  end if;

  return new;
end;
$$;

drop trigger if exists bydmate_preserve_live_cabin_temperature
  on public.bydmate_live_snapshots;

create trigger bydmate_preserve_live_cabin_temperature
before update on public.bydmate_live_snapshots
for each row
execute function public.bydmate_preserve_live_cabin_temperature();
