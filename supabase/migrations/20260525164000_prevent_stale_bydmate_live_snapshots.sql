-- Prevent buffered/retried BYDMate samples from moving the live snapshot
-- backwards while keeping historical sample inserts idempotent.

create or replace function public.bydmate_prevent_stale_live_snapshot_update()
returns trigger
language plpgsql
as $$
begin
  if new.device_time < old.device_time then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists bydmate_prevent_stale_live_snapshot_update
  on public.bydmate_live_snapshots;

create trigger bydmate_prevent_stale_live_snapshot_update
before update on public.bydmate_live_snapshots
for each row
execute function public.bydmate_prevent_stale_live_snapshot_update();

create or replace function public.bydmate_ingest_telemetry(
  p_user_id uuid,
  p_vehicle_id text,
  p_source text,
  p_schema_version integer,
  p_device_time timestamptz,
  p_received_at timestamptz,
  p_telemetry jsonb,
  p_diplus jsonb,
  p_location jsonb,
  p_raw_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_raw_payload jsonb := coalesce(p_raw_payload, '{}'::jsonb);
begin
  if p_diplus is not null then
    v_raw_payload := v_raw_payload || jsonb_build_object('diplus', p_diplus);
  end if;

  v_result := public.bydmate_ingest_telemetry(
    p_user_id,
    p_vehicle_id,
    p_source,
    p_schema_version,
    p_device_time,
    p_received_at,
    p_telemetry,
    p_location,
    v_raw_payload
  );

  perform public.bydmate_apply_diplus_columns(
    'public.bydmate_live_snapshots'::regclass,
    'user_id = $3 and vehicle_id = $4 and device_time <= $5',
    p_diplus,
    p_user_id,
    p_vehicle_id,
    p_device_time,
    null,
    p_telemetry
  );

  perform public.bydmate_apply_diplus_columns(
    'public.bydmate_telemetry_samples'::regclass,
    'user_id = $3 and vehicle_id = $4 and device_time = $5 and received_at = $6',
    coalesce(p_diplus, '{}'::jsonb),
    p_user_id,
    p_vehicle_id,
    p_device_time,
    p_received_at,
    p_telemetry
  );

  return v_result;
end;
$$;

revoke all on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)
  from public;
grant execute on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)
  to service_role;

with latest_samples as (
  select distinct on (user_id, vehicle_id)
    *
  from public.bydmate_telemetry_samples
  order by user_id, vehicle_id, device_time desc, received_at desc
)
update public.bydmate_live_snapshots live
set
  device_time = latest.device_time,
  received_at = latest.received_at,
  telemetry = latest.telemetry,
  diplus = latest.diplus,
  diplus_min_cell_voltage_v = latest.diplus_min_cell_voltage_v,
  diplus_max_cell_voltage_v = latest.diplus_max_cell_voltage_v,
  diplus_cell_delta_v = latest.diplus_cell_delta_v
from latest_samples latest
where live.user_id = latest.user_id
  and live.vehicle_id = latest.vehicle_id
  and live.device_time < latest.device_time;
