-- Populate the autoservice_* columns added by 20260708130000: the ingest RPCs never
-- extracted autoservice.* from the payload, so the columns stayed NULL even when the
-- BYDMate app sent them (Phase 2 gap). The Zod schema and both ingest paths (single
-- and batch) already deliver the full sample as p_raw_payload, so extending the
-- 10-arg wrapper (last defined in 20260526114500) covers every caller — the batch
-- function calls this wrapper per sample.
--
-- Live snapshots carry the last-seen autoservice values forward when a sample has no
-- autoservice block (mirrors the SoH carry-forward): the fields need ADB and arrive
-- intermittently, and lifetime counters (mileage/kWh) stay meaningful as "last known".
-- Idempotent: safe to re-run.

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
  v_diplus jsonb := coalesce(p_diplus, '{}'::jsonb);
  v_autoservice jsonb := p_raw_payload->'autoservice';
begin
  v_result := public.bydmate_ingest_telemetry(
    p_user_id,
    p_vehicle_id,
    p_source,
    p_schema_version,
    p_device_time,
    p_received_at,
    p_telemetry,
    p_location,
    coalesce(p_raw_payload, '{}'::jsonb) || jsonb_build_object('diplus', v_diplus)
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
    v_diplus,
    p_user_id,
    p_vehicle_id,
    p_device_time,
    p_received_at,
    p_telemetry
  );

  if jsonb_typeof(v_autoservice) = 'object' then
    update public.bydmate_telemetry_samples
    set
      autoservice_soc_percent = nullif(v_autoservice->>'soc_percent', '')::numeric,
      autoservice_power_kw = nullif(v_autoservice->>'power_kw', '')::numeric,
      autoservice_gun_state = (nullif(v_autoservice->>'gun_state', '')::numeric)::integer,
      autoservice_bms_state = (nullif(v_autoservice->>'bms_state', '')::numeric)::integer,
      autoservice_charge_capacity_kwh = nullif(v_autoservice->>'charge_capacity_kwh', '')::numeric,
      autoservice_charge_battery_volt = nullif(v_autoservice->>'charge_battery_volt', '')::numeric,
      autoservice_battery_type = (nullif(v_autoservice->>'battery_type', '')::numeric)::integer,
      autoservice_lifetime_mileage_km = nullif(v_autoservice->>'lifetime_mileage_km', '')::numeric,
      autoservice_lifetime_kwh = nullif(v_autoservice->>'lifetime_kwh', '')::numeric
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and device_time = p_device_time
      and received_at = p_received_at;

    -- Same guard as the diplus apply: never stamp an older batch sample's values onto
    -- a live snapshot that has already advanced past it.
    update public.bydmate_live_snapshots
    set
      autoservice_soc_percent = nullif(v_autoservice->>'soc_percent', '')::numeric,
      autoservice_power_kw = nullif(v_autoservice->>'power_kw', '')::numeric,
      autoservice_gun_state = (nullif(v_autoservice->>'gun_state', '')::numeric)::integer,
      autoservice_bms_state = (nullif(v_autoservice->>'bms_state', '')::numeric)::integer,
      autoservice_charge_capacity_kwh = nullif(v_autoservice->>'charge_capacity_kwh', '')::numeric,
      autoservice_charge_battery_volt = nullif(v_autoservice->>'charge_battery_volt', '')::numeric,
      autoservice_battery_type = (nullif(v_autoservice->>'battery_type', '')::numeric)::integer,
      autoservice_lifetime_mileage_km = nullif(v_autoservice->>'lifetime_mileage_km', '')::numeric,
      autoservice_lifetime_kwh = nullif(v_autoservice->>'lifetime_kwh', '')::numeric
    where user_id = p_user_id
      and vehicle_id = p_vehicle_id
      and device_time <= p_device_time;
  end if;

  return v_result;
end;
$$;

revoke all on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)
  from public;

grant execute on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)
  to service_role;
