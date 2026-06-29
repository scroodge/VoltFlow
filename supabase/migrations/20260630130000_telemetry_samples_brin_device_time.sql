-- Interim telemetry win (plan "B" — see AGENTS.md ## Pending plan).
--
-- WHY: bydmate_telemetry_samples is a large append-only ~1 Hz table (~500k rows,
-- ~470 MB). All existing btree indexes are prefixed by user_id, so a global
-- time-range scan — notably the retention prune's `WHERE device_time < cutoff`
-- and any cross-user time queries — cannot use them and falls back to a scan.
--
-- A BRIN index on device_time stores min/max per block instead of per row, so it
-- is tiny (KBs, not MBs) and accelerates time-range filters because the data is
-- physically append-ordered by device_time (high correlation). Purely additive:
-- nothing is dropped, ingest and existing queries are unaffected.
--
-- This is the cheap interim step; full range partitioning (plan "A") remains
-- the destination and is still pending.
--
-- Idempotent — self-hosted has no schema_migrations table.

create index if not exists bydmate_telemetry_samples_device_time_brin
  on public.bydmate_telemetry_samples
  using brin (device_time)
  with (pages_per_range = 32);
