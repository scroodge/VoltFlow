-- Charging decisions remain in TypeScript; this transaction commits their effects.
begin;

alter table public.bydmate_auto_charging_session_state
  add column if not exists state_version bigint not null default 0;

create table if not exists public.bydmate_pending_charging_samples (
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id text not null,
  device_time timestamptz not null,
  sample jsonb not null,
  primary key (user_id, vehicle_id, device_time)
);
alter table public.bydmate_pending_charging_samples enable row level security;
revoke all on public.bydmate_pending_charging_samples from public, anon, authenticated;
grant all on public.bydmate_pending_charging_samples to service_role;

-- Operational cursors cannot be rewritten by browser clients.
revoke insert, update, delete on public.bydmate_auto_charging_session_state from public, anon, authenticated;

create or replace function public.bydmate_enqueue_charging_samples(
  p_user_id uuid, p_vehicle_id text, p_samples jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.bydmate_pending_charging_samples(user_id, vehicle_id, device_time, sample)
  select p_user_id, p_vehicle_id, (s->>'device_time')::timestamptz,
    jsonb_build_object('vehicle_id', p_vehicle_id, 'device_time', s->>'device_time',
      'telemetry', jsonb_build_object(
        'soc', s->'telemetry'->'soc', 'charge_power_kw', s->'telemetry'->'charge_power_kw',
        'speed_kmh', s->'telemetry'->'speed_kmh', 'is_charging', s->'telemetry'->'is_charging',
        'charge_type', s->'telemetry'->'charge_type'),
      'diplus', jsonb_build_object('charge_gun_state', s->'diplus'->'charge_gun_state'),
      'location', s->'location')
  from jsonb_array_elements(p_samples) s
  where s->>'vehicle_id' = p_vehicle_id and coalesce((s->>'live_only')::boolean, false) = false
  on conflict do nothing;
end;
$$;

create or replace function public.bydmate_read_charging_batch(p_user_id uuid, p_vehicle_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'car', (select to_jsonb(c) from public.cars c where c.user_id = p_user_id
      and c.vehicle_alias = p_vehicle_id order by c.id limit 1),
    'state', (select to_jsonb(s) from public.bydmate_auto_charging_session_state s
      where s.user_id = p_user_id and s.vehicle_id = p_vehicle_id),
    'sessions', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
      from public.charging_sessions c where c.user_id = p_user_id and c.status = 'charging'),
    'samples', (select coalesce(jsonb_agg(q.sample order by q.device_time), '[]'::jsonb)
      from (select device_time, sample from public.bydmate_pending_charging_samples
        where user_id = p_user_id and vehicle_id = p_vehicle_id order by device_time limit 300) q)
  );
$$;

create or replace function public.bydmate_commit_charging_batch(
  p_user_id uuid, p_vehicle_id text, p_expected_version bigint,
  p_expected_sessions jsonb, p_expected_car jsonb, p_state jsonb,
  p_operations jsonb, p_consumed_times jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_version bigint;
  v_sessions jsonb;
  v_car jsonb;
  v_op jsonb;
  v_row public.charging_sessions;
  v_state public.bydmate_auto_charging_session_state;
begin
  -- Account-wide because automatic starts retain the existing replacement policy.
  perform pg_advisory_xact_lock(hashtextextended('charging:' || p_user_id::text, 0));
  insert into public.bydmate_auto_charging_session_state(user_id, vehicle_id)
    values (p_user_id, p_vehicle_id) on conflict do nothing;
  select state_version into v_version from public.bydmate_auto_charging_session_state
    where user_id = p_user_id and vehicle_id = p_vehicle_id for update;
  if v_version <> p_expected_version then
    return jsonb_build_object('committed', false, 'conflict', true);
  end if;
  -- Lock parents before sessions, also fencing FK-backed manual inserts during commit.
  perform 1 from public.cars where user_id = p_user_id order by id for update;
  select to_jsonb(c) into v_car from public.cars c where c.user_id = p_user_id
    and c.vehicle_alias = p_vehicle_id order by c.id limit 1;
  perform 1 from public.charging_sessions where user_id = p_user_id and status = 'charging'
    order by id for update;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb) into v_sessions
    from public.charging_sessions c where c.user_id = p_user_id and c.status = 'charging';
  if v_car is distinct from p_expected_car or v_sessions is distinct from p_expected_sessions then
    return jsonb_build_object('committed', false, 'conflict', true);
  end if;
  for v_op in select value from jsonb_array_elements(p_operations) loop
    if v_op->>'kind' = 'start' then
      v_row := jsonb_populate_record(null::public.charging_sessions, v_op->'row');
      if v_row.user_id is distinct from p_user_id or v_row.car_id is distinct from (v_car->>'id')::uuid
        or v_row.status is distinct from 'charging' then
        raise exception 'Invalid charging start scope';
      end if;
      insert into public.charging_sessions(id, user_id, car_id, start_percent, current_percent,
        target_percent, battery_capacity_kwh, charger_power_kw, efficiency_percent, tariff_type,
        provider_type, user_provider_id, tariff_manual, price_per_kwh, charged_energy_kwh,
        estimated_cost, status, started_at)
      values (v_row.id, p_user_id, v_row.car_id, v_row.start_percent, v_row.current_percent,
        v_row.target_percent, v_row.battery_capacity_kwh, v_row.charger_power_kw, v_row.efficiency_percent,
        v_row.tariff_type, v_row.provider_type, v_row.user_provider_id, v_row.tariff_manual,
        v_row.price_per_kwh, v_row.charged_energy_kwh, v_row.estimated_cost, v_row.status, v_row.started_at);
    elsif v_op->>'kind' = 'stop' then
      select * into v_row from public.charging_sessions where id = (v_op->>'id')::uuid
        and user_id = p_user_id and status = 'charging';
      if not found then raise exception 'Charging stop target changed'; end if;
      v_row := jsonb_populate_record(v_row, v_op->'patch');
      update public.charging_sessions set status = 'stopped', stopped_at = v_row.stopped_at,
        current_percent = v_row.current_percent, charged_energy_kwh = v_row.charged_energy_kwh,
        estimated_cost = v_row.estimated_cost
        where id = (v_op->>'id')::uuid and user_id = p_user_id;
    else
      raise exception 'Unknown charging operation';
    end if;
  end loop;
  v_state := jsonb_populate_record(null::public.bydmate_auto_charging_session_state, p_state);
  update public.bydmate_auto_charging_session_state set
    state_version = v_version + 1, last_device_time = v_state.last_device_time,
    consecutive_charging_samples = v_state.consecutive_charging_samples,
    consecutive_unplug_samples = v_state.consecutive_unplug_samples,
    last_is_charging = v_state.last_is_charging,
    streak_start_percent = v_state.streak_start_percent, streak_start_device_time = v_state.streak_start_device_time,
    last_idle_percent = v_state.last_idle_percent, last_idle_device_time = v_state.last_idle_device_time,
    frozen_soc = v_state.frozen_soc, frozen_charge_power_kw = v_state.frozen_charge_power_kw,
    frozen_since_device_time = v_state.frozen_since_device_time,
    zero_power_since_device_time = v_state.zero_power_since_device_time
    where user_id = p_user_id and vehicle_id = p_vehicle_id;
  delete from public.bydmate_pending_charging_samples where user_id = p_user_id and vehicle_id = p_vehicle_id
    and device_time in (select value::timestamptz from jsonb_array_elements_text(p_consumed_times));
  return jsonb_build_object('committed', true, 'conflict', false);
end;
$$;

revoke execute on function public.bydmate_enqueue_charging_samples(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.bydmate_read_charging_batch(uuid, text) from public, anon, authenticated;
revoke execute on function public.bydmate_commit_charging_batch(uuid, text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.bydmate_enqueue_charging_samples(uuid, text, jsonb) to service_role;
grant execute on function public.bydmate_read_charging_batch(uuid, text) to service_role;
grant execute on function public.bydmate_commit_charging_batch(uuid, text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
commit;
