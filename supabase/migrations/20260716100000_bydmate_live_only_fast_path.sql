-- Phase 2 of the cloud-offload plan: parked `live_only` fast path.
--
-- A parked car sends a heartbeat every 30s purely to keep VoltFlow's live status
-- fresh. Today each of those runs the full per-sample ingest: live snapshot upsert
-- + history insert + hourly rollup upsert (4 weighted averages) + trip gap check.
-- Only the first of those matters while parked and nothing is changing, and
-- parked time dominates a car's wall clock — so this is the single largest
-- per-sample cost with the least value.
--
-- When a sample carries `"live_only": true` at the payload top level, take a fast
-- path that updates only bydmate_live_snapshots (plus its diplus/autoservice
-- columns) and skips the history/hourly/trip writes entirely. The APK decides
-- when to set the flag (parked + SOC/gun/gear/12V unchanged within thresholds);
-- any material change or a gear transition still sends a full sample.
--
-- Additive and backwards compatible: payloads without the key are `false` and
-- take the existing full path, so older APK versions are unaffected.
--
-- Ack accounting: the fast path deliberately returns no `sample_count` key, so
-- parseIngestStats() falls back to the payload count and reports the sample as
-- inserted (the same path a parked no-trip sample already takes today). The APK's
-- CloudTelemetryAck.isFullyAcknowledged() therefore passes and the row leaves the
-- queue instead of retrying forever. The batch RPC counts it in v_count the same
-- way. Persistence verification in route.ts reads bydmate_live_snapshots (not
-- _samples), so it still finds the row this path writes.
--
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
  v_raw_payload jsonb := coalesce(p_raw_payload, '{}'::jsonb);
  v_autoservice jsonb := p_raw_payload->'autoservice';
  v_live_only boolean := coalesce(nullif(v_raw_payload->>'live_only', '')::boolean, false);
begin
  if v_live_only then
    -- Fast path: refresh live state only. No history row, no hourly rollup, no
    -- trip create/extend. The bydmate_prevent_stale_live_snapshot_update trigger
    -- still keeps a retried older heartbeat from moving the snapshot backwards.
    insert into public.bydmate_live_snapshots (
      vehicle_id,
      user_id,
      source,
      schema_version,
      device_time,
      received_at,
      telemetry,
      location,
      raw_payload
    )
    values (
      p_vehicle_id,
      p_user_id,
      p_source,
      p_schema_version,
      p_device_time,
      p_received_at,
      p_telemetry,
      coalesce(p_location, '{}'::jsonb),
      v_raw_payload || jsonb_build_object('diplus', v_diplus)
    )
    on conflict (user_id, vehicle_id) do update
    set
      source = excluded.source,
      schema_version = excluded.schema_version,
      device_time = excluded.device_time,
      received_at = excluded.received_at,
      telemetry = excluded.telemetry,
      location = excluded.location,
      raw_payload = excluded.raw_payload;
  else
    v_result := public.bydmate_ingest_telemetry(
      p_user_id,
      p_vehicle_id,
      p_source,
      p_schema_version,
      p_device_time,
      p_received_at,
      p_telemetry,
      p_location,
      v_raw_payload || jsonb_build_object('diplus', v_diplus)
    );
  end if;

  -- Live snapshot diplus columns are applied on both paths: VoltFlow's live view
  -- reads gear / gun state / 12V / cell voltages from these columns, and the
  -- route's persistence check asserts they are populated. The device_time guard
  -- makes this a no-op when a newer sample already advanced the snapshot.
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

  if not v_live_only then
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
  end if;

  if jsonb_typeof(v_autoservice) = 'object' then
    if not v_live_only then
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
    end if;

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

  if v_live_only then
    -- No sample_count key: parseIngestStats falls back to the payload count and
    -- reports the sample as accepted. See the ack-accounting note in the header.
    return jsonb_build_object('live_only', true);
  end if;

  return v_result;
end;
$$;

revoke all on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)
  from public;

grant execute on function public.bydmate_ingest_telemetry(uuid, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)
  to service_role;
