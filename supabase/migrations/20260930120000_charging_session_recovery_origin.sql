-- Provenance for sessions reconstructed from retained vehicle telemetry.
-- Recovery keys make owner-confirmed imports idempotent across retries and reloads.

alter table if exists public.charging_sessions
  add column if not exists session_origin text not null default 'legacy'
    check (session_origin in ('legacy', 'manual_receipt', 'telemetry_recovered')),
  add column if not exists recovery_key text;

update public.charging_sessions
set session_origin = 'manual_receipt'
where manual_entry = true and session_origin = 'legacy';

create unique index if not exists charging_sessions_recovery_key_unique
  on public.charging_sessions (user_id, car_id, recovery_key)
  where recovery_key is not null;

comment on column public.charging_sessions.session_origin is
  'Provenance of this history row. telemetry_recovered rows are owner-confirmed reconstructions from retained Mate telemetry.';

comment on column public.charging_sessions.recovery_key is
  'Stable, user-and-car-scoped source-window key for idempotent telemetry recovery imports.';
