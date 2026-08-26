# Supabase migrations audit

## 20260826172117 — auxiliary voltage daily analytics

- Adds immutable, security-invoker `bydmate_is_parked_unplugged(jsonb, text)` and grants execution only to authenticated/service roles.
- Rewrites `bydmate_phantom_drain_daily` to call the extracted predicate without changing its four-hour aggregation behavior.
- Adds stable, security-invoker `bydmate_aux_voltage_daily` with user/vehicle/range scoping, 6–18 V revalidation, daily bands, and two-hour resting medians.
- Adds the partial raw-sample auxiliary-voltage analytics index.
- Adds no table, RLS policy, hourly-rollup column, or privileged `SECURITY DEFINER` path.

## 20260826194941 — full-window day telemetry buckets

- Adds stable, security-invoker `bydmate_telemetry_day_buckets` with user/vehicle/time scoping.
- Caps output structurally at three envelope points across each of at most 800 fixed time buckets.
- Revalidates complete response coverage in the application using repeated source count/first/last metadata.
- Grants execution only to authenticated/service roles; adds no privileged or table-writing path.
