-- Drop the partial index added in 20260826172117_aux_voltage_daily.sql.
-- Its predicate `telemetry ? 'aux_voltage_v'` is never implied by the aux-voltage
-- rollup query, which reads coalesce(aux_voltage_v, diplus_voltage_12v) with no
-- such filter, so the planner cannot use it (verified with EXPLAIN on prod; 0 scans
-- since 2026-06-24). It held ~396 MB and cost a write on every telemetry insert.
--
-- CONCURRENTLY: no lock on the hot ingest table; runs outside a transaction.
-- Idempotent because the self-hosted deployment has no migration-history table.

drop index concurrently if exists public.bydmate_telemetry_samples_aux_voltage_analytics_idx;
