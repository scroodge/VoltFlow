-- Preserve intermittent temperature telemetry in the latest live snapshot.
-- The odometer carry-forward trigger is the table boundary for every ingest path;
-- extend the same rule to the two temperature fields used by the Vehicle page.

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

  if nullif(new.telemetry->>'battery_temp_c', '') is null
     and nullif(old.telemetry->>'battery_temp_c', '') is not null then
    new.telemetry := coalesce(new.telemetry, '{}'::jsonb)
      || jsonb_build_object('battery_temp_c', old.telemetry->'battery_temp_c');
  end if;

  if nullif(new.telemetry->>'outside_temp_c', '') is null
     and nullif(old.telemetry->>'outside_temp_c', '') is not null then
    new.telemetry := coalesce(new.telemetry, '{}'::jsonb)
      || jsonb_build_object('outside_temp_c', old.telemetry->'outside_temp_c');
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
