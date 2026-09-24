-- B-03 (BYDMate backlog): a stable vehicle identity, separate from the owner-typed name.
--
-- Every bydmate_* table keys on (user_id, vehicle_id), and vehicle_id has always been the
-- name the owner typed into the APK. Renaming the car in the APK therefore minted a new
-- vehicle: new rows landed under the new name, while cars.vehicle_alias, route labels,
-- rollups, charging state and notification state stayed on the old one. Seen in prod
-- 2026-09-24: an account whose car still points at 'BYE Yuan Up' while all 1503 of its
-- trips arrive as 'BYD Yuan Up'.
--
-- Accounts can hold several cars, so identity cannot be inferred from the account. The APK
-- (from the build that ships this) generates one random `vehicle_uid` per install and sends
-- it as `X-Vehicle-Uid` next to the unchanged `X-Vehicle-Id`. On first contact the uid is
-- bound to the vehicle_id it arrived with — the key its history already lives under — and
-- from then on every request carrying that uid is stored under that key, whatever the name.
-- The name the APK sends is kept as `mate_name` only; the web keeps showing `cars.name`
-- and keeps finding the data through `cars.vehicle_alias`, both unchanged.
--
-- Older APKs send no uid and keep today's behaviour exactly (vehicle_id is the key), so no
-- payload or version gate is involved — see BYDMate ADR-0003.
--
-- History already orphaned by past renames is joined with bydmate_merge_vehicle_key(),
-- an explicit, per-pair operation: which old name belongs to which car is only knowable
-- from the owner, not from the data.

create table if not exists public.bydmate_vehicle_uids (
  vehicle_uid uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_key text not null check (btrim(vehicle_key) <> ''),
  mate_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bydmate_vehicle_uids is
  'APK install identity (X-Vehicle-Uid) -> the vehicle_id its data is stored under. mate_name is the latest name the APK sent; it never changes the key.';

create index if not exists bydmate_vehicle_uids_user_key_idx
  on public.bydmate_vehicle_uids (user_id, vehicle_key);

alter table public.bydmate_vehicle_uids enable row level security;

-- Durable evidence trail: every bind, rename and merge is one row. This is how a rename is
-- verified after the fact, without any log access on the car.
create table if not exists public.bydmate_vehicle_identity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_uid uuid,
  vehicle_key text not null,
  kind text not null check (kind in ('bound', 'renamed', 'rebound', 'merged')),
  old_name text,
  new_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bydmate_vehicle_identity_events_user_idx
  on public.bydmate_vehicle_identity_events (user_id, created_at desc);

alter table public.bydmate_vehicle_identity_events enable row level security;

-- Service role only (same as bydmate_devices): every caller is an API route using
-- createServiceClient(). No policy is defined on purpose.

-- Returns the vehicle_id a request must be stored under.
--
-- Hot path: runs on every telemetry push and command poll from a car that sends a uid.
-- A known uid with an unchanged name is one indexed read and no write.
create or replace function public.bydmate_resolve_vehicle_key(
  p_user_id uuid,
  p_vehicle_uid uuid,
  p_name text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_row public.bydmate_vehicle_uids%rowtype;
begin
  if v_name = '' then
    raise exception 'vehicle name is required';
  end if;
  if p_vehicle_uid is null then
    return v_name;
  end if;

  select * into v_row from public.bydmate_vehicle_uids where vehicle_uid = p_vehicle_uid;

  if found and v_row.user_id = p_user_id then
    if v_row.mate_name is distinct from v_name then
      update public.bydmate_vehicle_uids
        set mate_name = v_name, updated_at = now()
        where vehicle_uid = p_vehicle_uid and mate_name is distinct from v_name;
      if found then
        insert into public.bydmate_vehicle_identity_events
          (user_id, vehicle_uid, vehicle_key, kind, old_name, new_name)
        values (p_user_id, p_vehicle_uid, v_row.vehicle_key, 'renamed', v_row.mate_name, v_name);
      end if;
    end if;
    return v_row.vehicle_key;
  end if;

  if found then
    -- The install was re-paired to another account. Its history stays with the old
    -- account; on the new one it starts under the name it arrives with.
    update public.bydmate_vehicle_uids
      set user_id = p_user_id, vehicle_key = v_name, mate_name = v_name, updated_at = now()
      where vehicle_uid = p_vehicle_uid;
    insert into public.bydmate_vehicle_identity_events
      (user_id, vehicle_uid, vehicle_key, kind, old_name, new_name, details)
    values (p_user_id, p_vehicle_uid, v_name, 'rebound', v_row.mate_name, v_name,
            jsonb_build_object('previous_user_id', v_row.user_id, 'previous_key', v_row.vehicle_key));
    return v_name;
  end if;

  -- First contact. The app and the daemon can both arrive here at once; the loser of the
  -- insert race reads back whatever the winner bound.
  insert into public.bydmate_vehicle_uids (vehicle_uid, user_id, vehicle_key, mate_name)
    values (p_vehicle_uid, p_user_id, v_name, v_name)
    on conflict (vehicle_uid) do nothing;
  if found then
    insert into public.bydmate_vehicle_identity_events
      (user_id, vehicle_uid, vehicle_key, kind, new_name)
    values (p_user_id, p_vehicle_uid, v_name, 'bound', v_name);
    return v_name;
  end if;
  return (select vehicle_key from public.bydmate_vehicle_uids where vehicle_uid = p_vehicle_uid);
end;
$$;

-- Move all of one account's history from p_from_key onto p_to_key (a rename that happened
-- before uids existed). Where both keys hold a row for the same slot, p_to_key's row wins:
-- it belongs to the car as it is today. Daily rollups for every moved date are re-queued
-- so they are recomputed from the merged samples. Returns per-table row counts and records
-- a 'merged' event. Run inside a transaction you can inspect before committing.
create or replace function public.bydmate_merge_vehicle_key(
  p_user_id uuid,
  p_from_key text,
  p_to_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f text := btrim(coalesce(p_from_key, ''));
  t text := btrim(coalesce(p_to_key, ''));
  n integer;
  counts jsonb := '{}'::jsonb;
begin
  if f = '' or t = '' or f = t then
    raise exception 'merge needs two different, non-empty keys';
  end if;
  perform pg_advisory_xact_lock(hashtext('bydmate_merge_vehicle_key:' || p_user_id::text));

  if exists (select 1 from bydmate_trips where user_id = p_user_id and vehicle_id = f and ended_at is null)
     and exists (select 1 from bydmate_trips where user_id = p_user_id and vehicle_id = t and ended_at is null) then
    raise exception 'both keys have an open trip; close one before merging';
  end if;

  -- Re-queue every rollup date the old key contributed to, before those rows move.
  insert into bydmate_soh_rollup_queue (user_id, vehicle_id, date, reason)
    select p_user_id, t, date, 'vehicle_merge' from bydmate_soh_daily_rollups
    where user_id = p_user_id and vehicle_id = f
    on conflict do nothing;
  insert into bydmate_aux_voltage_rollup_queue (user_id, vehicle_id, date, reason)
    select p_user_id, t, date, 'vehicle_merge' from bydmate_aux_voltage_daily_rollups
    where user_id = p_user_id and vehicle_id = f
    on conflict do nothing;
  insert into bydmate_phantom_drain_rollup_queue (user_id, vehicle_id, date, reason)
    select p_user_id, t, date, 'vehicle_merge' from bydmate_phantom_drain_daily_rollups
    where user_id = p_user_id and vehicle_id = f
    on conflict do nothing;

  -- One row per (user, vehicle): keep the current car's state.
  delete from bydmate_auto_charging_session_state a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_auto_charging_session_state b where b.user_id = p_user_id and b.vehicle_id = t);
  update bydmate_auto_charging_session_state set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('auto_charging_session_state', n);

  delete from bydmate_aux_battery_alert_state a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_aux_battery_alert_state b where b.user_id = p_user_id and b.vehicle_id = t);
  update bydmate_aux_battery_alert_state set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('aux_battery_alert_state', n);

  delete from bydmate_charge_notification_state a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_charge_notification_state b where b.user_id = p_user_id and b.vehicle_id = t);
  update bydmate_charge_notification_state set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('charge_notification_state', n);

  delete from bydmate_live_status_state a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_live_status_state b where b.user_id = p_user_id and b.vehicle_id = t);
  update bydmate_live_status_state set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('live_status_state', n);

  delete from telegram_live_messages a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from telegram_live_messages b where b.user_id = p_user_id and b.vehicle_id = t);
  update telegram_live_messages set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('telegram_live_messages', n);

  delete from bydmate_live_snapshots a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_live_snapshots b where b.user_id = p_user_id and b.vehicle_id = t);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('live_snapshots_dropped', n);
  update bydmate_live_snapshots set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('live_snapshots', n);

  -- Keyed by (user, vehicle, date) — rollups were re-queued above, so a dropped duplicate
  -- day is rebuilt from samples rather than lost.
  delete from bydmate_soh_daily_rollups a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_soh_daily_rollups b where b.user_id = p_user_id and b.vehicle_id = t and b.date = a.date);
  update bydmate_soh_daily_rollups set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('soh_daily_rollups', n);

  delete from bydmate_aux_voltage_daily_rollups a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_aux_voltage_daily_rollups b where b.user_id = p_user_id and b.vehicle_id = t and b.date = a.date);
  update bydmate_aux_voltage_daily_rollups set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('aux_voltage_daily_rollups', n);

  delete from bydmate_phantom_drain_daily_rollups a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_phantom_drain_daily_rollups b where b.user_id = p_user_id and b.vehicle_id = t and b.date = a.date);
  update bydmate_phantom_drain_daily_rollups set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('phantom_drain_daily_rollups', n);

  delete from bydmate_soh_rollup_queue a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_soh_rollup_queue b where b.user_id = p_user_id and b.vehicle_id = t and b.date = a.date);
  update bydmate_soh_rollup_queue set vehicle_id = t where user_id = p_user_id and vehicle_id = f;

  delete from bydmate_aux_voltage_rollup_queue a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_aux_voltage_rollup_queue b where b.user_id = p_user_id and b.vehicle_id = t and b.date = a.date);
  update bydmate_aux_voltage_rollup_queue set vehicle_id = t where user_id = p_user_id and vehicle_id = f;

  delete from bydmate_phantom_drain_rollup_queue a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_phantom_drain_rollup_queue b where b.user_id = p_user_id and b.vehicle_id = t and b.date = a.date);
  update bydmate_phantom_drain_rollup_queue set vehicle_id = t where user_id = p_user_id and vehicle_id = f;

  delete from bydmate_pending_charging_samples a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_pending_charging_samples b where b.user_id = p_user_id and b.vehicle_id = t and b.device_time = a.device_time);
  update bydmate_pending_charging_samples set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('pending_charging_samples', n);

  -- A route the owner labelled under both names keeps today's label.
  delete from bydmate_route_labels a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_route_labels b where b.user_id = p_user_id and b.vehicle_id = t and b.route_id = a.route_id);
  update bydmate_route_labels set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('route_labels', n);

  -- History. A duplicate slot is the same instant reported under both names.
  delete from bydmate_telemetry_samples a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_telemetry_samples b where b.user_id = p_user_id and b.vehicle_id = t and b.device_time = a.device_time);
  update bydmate_telemetry_samples set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('telemetry_samples', n);

  delete from bydmate_telemetry_hourly a where a.user_id = p_user_id and a.vehicle_id = f
    and exists (select 1 from bydmate_telemetry_hourly b where b.user_id = p_user_id and b.vehicle_id = t and b.hour_start = a.hour_start);
  update bydmate_telemetry_hourly set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('telemetry_hourly', n);

  delete from bydmate_trips a where a.user_id = p_user_id and a.vehicle_id = f and a.source = 'byd_energydata'
    and exists (select 1 from bydmate_trips b where b.user_id = p_user_id and b.vehicle_id = t
                and b.source = 'byd_energydata' and b.started_at = a.started_at);
  update bydmate_trips set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('trips', n);

  -- An alarm still open under the old name is superseded by the merged key's own state.
  update bydmate_telemetry_cadence_alarm_audits a set resolved_at = now()
    where a.user_id = p_user_id and a.vehicle_id = f and a.resolved_at is null
    and exists (select 1 from bydmate_telemetry_cadence_alarm_audits b where b.user_id = p_user_id
                and b.vehicle_id = t and b.signal = a.signal and b.resolved_at is null);
  update bydmate_telemetry_cadence_alarm_audits set vehicle_id = t where user_id = p_user_id and vehicle_id = f;

  -- No uniqueness on the vehicle: move as-is.
  update bydmate_battery_snapshots set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  update bydmate_idle_drains set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('idle_drains', n);
  update bydmate_trip_finalization_audits set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  update bydmate_trip_insight_inputs set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  update vehicle_commands set vehicle_id = t where user_id = p_user_id and vehicle_id = f;
  update vehicle_command_schedules set vehicle_id = t where user_id = p_user_id and vehicle_id = f;

  update profiles set live_fast_vehicle_id = t where id = p_user_id and live_fast_vehicle_id = f;
  -- The web finds a car's data through this column; point it at the surviving key.
  update cars set vehicle_alias = t where user_id = p_user_id and vehicle_alias = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('cars', n);
  update bydmate_vehicle_uids set vehicle_key = t, updated_at = now() where user_id = p_user_id and vehicle_key = f;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('vehicle_uids', n);

  insert into bydmate_vehicle_identity_events (user_id, vehicle_key, kind, old_name, new_name, details)
    values (p_user_id, t, 'merged', f, t, counts);
  return counts;
end;
$$;

revoke execute on function public.bydmate_resolve_vehicle_key(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.bydmate_resolve_vehicle_key(uuid, uuid, text) to service_role;
-- Merge is an operator action (psql as postgres); no API role may call it.
revoke execute on function public.bydmate_merge_vehicle_key(uuid, text, text) from public, anon, authenticated, service_role;
