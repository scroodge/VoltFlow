create or replace function public.bydmate_merge_charging_continuation(
  p_user_id uuid,
  p_car_id uuid,
  p_first_id uuid,
  p_next_id uuid,
  p_first_updated_at timestamptz,
  p_next_updated_at timestamptz,
  p_patch jsonb
) returns timestamptz
language plpgsql
set search_path = public
as $$
declare
  first_row public.charging_sessions;
  next_row public.charging_sessions;
  patch_row public.charging_sessions;
  merged_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('charging:' || p_user_id::text, 0));
  perform 1 from public.charging_sessions
    where user_id = p_user_id and car_id = p_car_id and id in (p_first_id, p_next_id)
    order by id for update;

  select * into first_row from public.charging_sessions where id = p_first_id
    and user_id = p_user_id and car_id = p_car_id and updated_at = p_first_updated_at
    and session_origin = 'telemetry_recovered' and recovery_key is not null
    and status in ('completed', 'stopped') and not manual_entry and not energy_overridden
    and not tariff_manual and energy_corrected_at is null and tariff_selected_at is null;
  if not found then return null; end if;

  select * into next_row from public.charging_sessions where id = p_next_id
    and user_id = p_user_id and car_id = p_car_id and updated_at = p_next_updated_at
    and session_origin in ('legacy', 'telemetry_recovered')
    and status in ('completed', 'stopped') and not manual_entry and not energy_overridden
    and not tariff_manual and energy_corrected_at is null and tariff_selected_at is null;
  if not found then return null; end if;

  patch_row := jsonb_populate_record(null::public.charging_sessions, p_patch);
  if first_row.started_at is null or next_row.started_at is null or next_row.stopped_at is null
    or next_row.started_at <= first_row.started_at
    or patch_row.stopped_at is null or patch_row.stopped_at <= next_row.started_at
    or patch_row.stopped_at > next_row.stopped_at
    or patch_row.status is null or patch_row.status not in ('completed', 'stopped')
    or patch_row.recovery_key is null
    or exists (
      select 1 from public.charging_sessions as other
      where other.user_id = p_user_id and other.car_id = p_car_id
        and other.id not in (p_first_id, p_next_id)
        and other.started_at < patch_row.stopped_at
        and (other.stopped_at > first_row.started_at
          or (other.stopped_at is null and other.status = 'charging'))
    ) then
    return null;
  end if;

  update public.charging_sessions set
    current_percent = patch_row.current_percent,
    stopped_at = patch_row.stopped_at,
    charged_energy_kwh = patch_row.charged_energy_kwh,
    estimated_cost = patch_row.estimated_cost,
    status = patch_row.status,
    recovery_key = patch_row.recovery_key,
    end_max_cell_delta_v = next_row.end_max_cell_delta_v,
    end_delta_soc = next_row.end_delta_soc,
    end_median_cell_delta_v = next_row.end_median_cell_delta_v,
    end_range_est_km = next_row.end_range_est_km,
    end_range_soc = next_row.end_range_soc,
    end_voltflow_est_km = next_row.end_voltflow_est_km
  where id = first_row.id
  returning updated_at into merged_at;

  delete from public.charging_sessions where id = next_row.id;
  return merged_at;
end;
$$;

revoke execute on function public.bydmate_merge_charging_continuation(uuid, uuid, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.bydmate_merge_charging_continuation(uuid, uuid, uuid, uuid, timestamptz, timestamptz, jsonb)
  to service_role;
