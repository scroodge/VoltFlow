-- Switch the stable public API to the parity-verified daily rollups. The
-- signature and result columns remain unchanged for the chart and alert callers.
create or replace function public.bydmate_aux_voltage_daily(
  p_user_id uuid,
  p_vehicle_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  date date,
  v_min numeric,
  v_max numeric,
  v_resting numeric,
  resting_sample_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with car_config as (
    select
      coalesce(
        c.battery_chemistry,
        case c.model_generation
          when 'gen1_2024' then 'flooded'
          when 'gen2_2025' then 'lifepo4'
          else 'other'
        end
      ) as battery_chemistry,
      case coalesce(
          c.battery_chemistry,
          case c.model_generation
            when 'gen1_2024' then 'flooded'
            when 'gen2_2025' then 'lifepo4'
            else 'other'
          end
        )
        when 'flooded' then 12.9
        when 'efb' then 13.0
        when 'agm' then 13.1
        when 'lifepo4' then 13.5
        else null
      end::numeric as resting_ceiling_v
    from public.cars c
    where c.user_id = p_user_id
      and c.vehicle_alias = p_vehicle_id
    order by c.created_at
    limit 1
  )
  select
    r.date,
    r.v_min,
    r.v_max,
    r.v_resting,
    r.resting_sample_count
  from public.bydmate_aux_voltage_daily_rollups r
  left join car_config c on true
  where r.user_id = p_user_id
    and r.vehicle_id = p_vehicle_id
    and r.date >= (p_from at time zone 'UTC')::date
    and r.date <= (p_to at time zone 'UTC')::date
    and r.battery_chemistry is not distinct from c.battery_chemistry
    and r.resting_ceiling_v is not distinct from c.resting_ceiling_v
  order by r.date;
$$;

revoke all on function public.bydmate_aux_voltage_daily(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.bydmate_aux_voltage_daily(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
