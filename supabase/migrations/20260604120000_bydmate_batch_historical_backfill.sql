-- Always ingest batch samples into bydmate_telemetry_samples even when device_time
-- is older than the current live snapshot. Live rows stay monotonic via
-- bydmate_prevent_stale_live_snapshot_update; duplicates are idempotent on
-- (user_id, vehicle_id, device_time).

create or replace function public.bydmate_ingest_telemetry_batch(
  p_user_id uuid,
  p_received_at timestamptz,
  p_samples jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sample jsonb;
  v_result jsonb;
  v_count integer := 0;
  v_inserted_count integer := 0;
  v_duplicate_count integer := 0;
  v_last_vehicle_id text;
  v_last_device_time timestamptz;
  v_last_trip_id uuid;
  v_sample_device_time timestamptz;
  v_batch_vehicle_id text;
  v_batch_max_device_time timestamptz;
begin
  if jsonb_typeof(p_samples) <> 'array' then
    raise exception 'p_samples must be a JSON array';
  end if;

  select
    max(value->>'vehicle_id'),
    max(nullif(value->>'device_time', '')::timestamptz)
  into v_batch_vehicle_id, v_batch_max_device_time
  from jsonb_array_elements(p_samples);

  for v_sample in
    select value
    from jsonb_array_elements(p_samples)
    order by nullif(value->>'device_time', '')::timestamptz asc
  loop
    v_last_vehicle_id := v_sample->>'vehicle_id';
    v_sample_device_time := nullif(v_sample->>'device_time', '')::timestamptz;
    v_last_device_time := v_sample_device_time;

    v_result := public.bydmate_ingest_telemetry(
      p_user_id,
      v_last_vehicle_id,
      coalesce(nullif(v_sample->>'source', ''), 'BYDMate'),
      coalesce(nullif(v_sample->>'schema_version', '')::integer, 1),
      v_sample_device_time,
      p_received_at,
      coalesce(v_sample->'telemetry', '{}'::jsonb),
      v_sample->'diplus',
      coalesce(v_sample->'location', '{}'::jsonb),
      v_sample
    );

    v_count := v_count + 1;
    if coalesce((v_result->>'duplicate')::boolean, false) then
      v_duplicate_count := v_duplicate_count + 1;
    else
      v_inserted_count := v_inserted_count + 1;
    end if;
    v_last_trip_id := nullif(v_result->>'trip_id', '')::uuid;
  end loop;

  return jsonb_build_object(
    'sample_count', v_count,
    'inserted_count', v_inserted_count,
    'duplicate_count', v_duplicate_count,
    'skipped_stale_count', 0,
    'vehicle_id', coalesce(v_last_vehicle_id, v_batch_vehicle_id),
    'last_device_time', coalesce(v_last_device_time, v_batch_max_device_time),
    'last_trip_id', v_last_trip_id
  );
end;
$$;

revoke all on function public.bydmate_ingest_telemetry_batch(uuid, timestamptz, jsonb)
  from public;
grant execute on function public.bydmate_ingest_telemetry_batch(uuid, timestamptz, jsonb)
  to service_role;
