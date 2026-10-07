-- Phase 5 option A (BACKLOG.md): which conditions explain the spread of the range-trust cycles?
-- Read-only. Replace __USER_ID__ with the user's uuid, then:
--   scripts/prod-sql.sh "$(sed "s/__USER_ID__/<uuid>/" scripts/analyze-range-trust-cycles.sql)"
-- Mirrors gradeRangePredictionCycles (telemetry-source trips stand in for the app's dedupe),
-- 90-day window. Temperature = outside_temp_avg from bydmate_telemetry_hourly over DRIVING hours
-- (speed_max > 5) inside the cycle; trip-level bydmate_trip_insight_inputs covers only ~18% of trips.
-- Join once on user_id (indexed); do NOT filter with user_id::text like — it forces seq scans.
with s as (
  select id, started_at, stopped_at, end_range_est_km, end_range_soc,
    lead(started_at) over w nstart, lead(stopped_at) over w nstop, lead(start_percent) over w nsp
  from charging_sessions
  where user_id = '__USER_ID__' and status <> 'charging' and stopped_at is not null and started_at is not null
  window w as (order by stopped_at)),
c0 as (
  select s.*, end_range_soc - nsp as drop, extract(epoch from nstart - stopped_at)/86400 as days
  from s
  where nstart is not null and end_range_est_km > 0 and end_range_soc > 0 and nstart > stopped_at
    and end_range_soc - nsp >= 2 and extract(epoch from nstart - stopped_at)/86400 <= 45
    and nstop >= now() - interval '90 days'),
tr as (
  select t.started_at, t.distance_km, t.avg_speed_kmh
  from bydmate_trips t
  where t.user_id = '__USER_ID__' and t.source = 'telemetry' and t.distance_km > 0
    and t.started_at > now() - interval '140 days'),
hr as (
  select hour_start, outside_temp_avg, outside_temp_sample_count
  from bydmate_telemetry_hourly
  where user_id = '__USER_ID__' and speed_max > 5 and outside_temp_avg is not null
    and hour_start > now() - interval '140 days'),
ct as (
  select c0.id,
    sum(tr.distance_km) dist,
    sum(tr.distance_km * tr.avg_speed_kmh) / nullif(sum(tr.distance_km) filter (where tr.avg_speed_kmh is not null), 0) speed
  from c0 join tr on tr.started_at > c0.stopped_at and tr.started_at <= c0.nstart group by c0.id),
cw as (
  select c0.id, sum(hr.outside_temp_avg * coalesce(nullif(hr.outside_temp_sample_count,0),1))
         / sum(coalesce(nullif(hr.outside_temp_sample_count,0),1)) temp
  from c0 join hr on hr.hour_start >= date_trunc('hour', c0.stopped_at) and hr.hour_start < c0.nstart group by c0.id),
r as (
  select c0.id, c0.end_range_est_km, c0.end_range_soc, c0.drop, c0.days, ct.dist, ct.speed, cw.temp,
    ((ct.dist / c0.drop) / (c0.end_range_est_km / c0.end_range_soc)) as ratio
  from c0 join ct on ct.id = c0.id left join cw on cw.id = c0.id where ct.dist >= 0.5),
rk as (select *, rank() over (order by ratio) rr, rank() over (order by temp) rt, rank() over (order by speed) rs,
   rank() over (order by drop) rd, rank() over (order by days) rdays, rank() over (order by dist) rdist
   from r where temp is not null and speed is not null)
select 'cycles_total / with_temp_speed' k, (select count(*) from r)||' / '||count(*) v from rk
union all select 'median_ratio_all', round(percentile_cont(0.5) within group (order by ratio)::numeric,3)::text from r
union all select 'temp_range', round(min(temp)::numeric,1)||'..'||round(max(temp)::numeric,1) from rk
union all select 'spearman_temp', round(corr(rr,rt)::numeric,2)::text from rk
union all select 'spearman_speed', round(corr(rr,rs)::numeric,2)::text from rk
union all select 'spearman_socdrop', round(corr(rr,rd)::numeric,2)::text from rk
union all select 'spearman_parkdays', round(corr(rr,rdays)::numeric,2)::text from rk
union all select 'spearman_distance', round(corr(rr,rdist)::numeric,2)::text from rk
union all select 'temp<18  n / median', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from rk where temp<18
union all select 'temp18-22', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from rk where temp>=18 and temp<22
union all select 'temp>=22', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from rk where temp>=22
union all select 'speed<35', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from rk where speed<35
union all select 'speed35-45', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from rk where speed>=35 and speed<45
union all select 'speed>=45', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from rk where speed>=45
union all select 'dist<10km (all cycles)', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from r where dist<10
union all select 'dist10-100km', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from r where dist>=10 and dist<100
union all select 'dist>=100km', count(*)||' / '||round(percentile_cont(0.5) within group (order by ratio)::numeric,2) from r where dist>=100
union all select 'ratio>3 outliers', count(*)||' of '||(select count(*) from r) from r where ratio>3;
