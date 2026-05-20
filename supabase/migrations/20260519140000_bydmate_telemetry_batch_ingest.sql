-- BYDMate batch ingest: one HTTP/RPC call can persist a buffered telemetry pool.

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
  v_last_vehicle_id text;
  v_last_device_time timestamptz;
  v_last_trip_id uuid;
begin
  if jsonb_typeof(p_samples) <> 'array' then
    raise exception 'p_samples must be a JSON array';
  end if;

  for v_sample in
    select value
    from jsonb_array_elements(p_samples)
    order by nullif(value->>'device_time', '')::timestamptz asc
  loop
    v_result := public.bydmate_ingest_telemetry(
      p_user_id,
      v_sample->>'vehicle_id',
      coalesce(nullif(v_sample->>'source', ''), 'BYDMate'),
      coalesce(nullif(v_sample->>'schema_version', '')::integer, 1),
      nullif(v_sample->>'device_time', '')::timestamptz,
      p_received_at,
      coalesce(v_sample->'telemetry', '{}'::jsonb),
      coalesce(v_sample->'location', '{}'::jsonb),
      v_sample
    );

    v_count := v_count + 1;
    v_last_vehicle_id := v_sample->>'vehicle_id';
    v_last_device_time := nullif(v_sample->>'device_time', '')::timestamptz;
    v_last_trip_id := nullif(v_result->>'trip_id', '')::uuid;
  end loop;

  return jsonb_build_object(
    'sample_count', v_count,
    'vehicle_id', v_last_vehicle_id,
    'last_device_time', v_last_device_time,
    'last_trip_id', v_last_trip_id
  );
end;
$$;

revoke all on function public.bydmate_ingest_telemetry_batch(uuid, timestamptz, jsonb)
  from public;
grant execute on function public.bydmate_ingest_telemetry_batch(uuid, timestamptz, jsonb)
  to service_role;
