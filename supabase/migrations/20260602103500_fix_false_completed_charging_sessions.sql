-- Fix historical charging sessions incorrectly marked as completed.
-- Scenario: app-side math reached target, but telemetry shows drive-away before target SOC.

with candidate_sessions as (
  select
    cs.id,
    cs.user_id,
    cs.car_id,
    cs.start_percent,
    cs.target_percent,
    cs.battery_capacity_kwh,
    cs.efficiency_percent,
    cs.price_per_kwh,
    cs.started_at,
    coalesce(cs.stopped_at, cs.updated_at, now()) as ended_at,
    c.vehicle_alias
  from public.charging_sessions cs
  join public.cars c on c.id = cs.car_id
  where cs.status = 'completed'
    and cs.current_percent >= cs.target_percent
    and cs.started_at is not null
),
session_samples as (
  select
    s.id as session_id,
    ts.device_time,
    nullif(ts.telemetry->>'soc', '')::numeric as soc,
    nullif(ts.telemetry->>'speed_kmh', '')::numeric as speed_kmh
  from candidate_sessions s
  join public.bydmate_telemetry_samples ts
    on ts.user_id = s.user_id
   and ts.vehicle_id = s.vehicle_alias
   and ts.device_time >= s.started_at
   and ts.device_time <= s.ended_at
),
session_rollup as (
  select
    s.id as session_id,
    max(ss.soc) filter (where ss.soc is not null) as max_soc,
    bool_or(coalesce(ss.speed_kmh, 0) > 5) as had_movement
  from candidate_sessions s
  left join session_samples ss on ss.session_id = s.id
  group by s.id
),
last_soc as (
  select distinct on (session_id)
    session_id,
    soc as last_soc
  from session_samples
  where soc is not null
  order by session_id, device_time desc
),
patch as (
  select
    s.id,
    least(
      s.target_percent,
      greatest(s.start_percent, coalesce(ls.last_soc, s.start_percent))
    ) as corrected_percent,
    greatest(
      0::numeric,
      (s.battery_capacity_kwh * (
        least(
          s.target_percent,
          greatest(s.start_percent, coalesce(ls.last_soc, s.start_percent))
        ) - s.start_percent
      ) / 100.0) / nullif(s.efficiency_percent / 100.0, 0)
    ) as corrected_energy_kwh
  from candidate_sessions s
  join session_rollup sr on sr.session_id = s.id
  left join last_soc ls on ls.session_id = s.id
  where sr.max_soc is not null
    and sr.max_soc < s.target_percent
    and sr.had_movement = true
)
update public.charging_sessions cs
set
  status = 'stopped',
  current_percent = p.corrected_percent,
  charged_energy_kwh = p.corrected_energy_kwh,
  estimated_cost = p.corrected_energy_kwh * cs.price_per_kwh
from patch p
where cs.id = p.id;
