# Supabase migrations audit

## 20260826172117 — auxiliary voltage daily analytics

- Adds immutable, security-invoker `bydmate_is_parked_unplugged(jsonb, text)` and grants execution only to authenticated/service roles.
- Rewrites `bydmate_phantom_drain_daily` to call the extracted predicate without changing its four-hour aggregation behavior.
- Adds stable, security-invoker `bydmate_aux_voltage_daily` with user/vehicle/range scoping, 6–18 V revalidation, daily bands, and two-hour resting medians.
- Adds the partial raw-sample auxiliary-voltage analytics index.
- Adds no table, RLS policy, hourly-rollup column, or privileged `SECURITY DEFINER` path.
