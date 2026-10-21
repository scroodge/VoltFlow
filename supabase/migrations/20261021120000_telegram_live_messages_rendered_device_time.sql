-- Device time of the sample the Telegram live widget currently shows. An ingest whose newest
-- sample is older (a replayed offline queue flushed after live samples) must not walk the
-- widget backwards (car `cl`, 2026-10-21: parked 99.7 % → "charging 90.8 %"). Null = unknown
-- (the first edit after deploy is always allowed). Table stays service_role-only; no grants
-- change.
alter table public.telegram_live_messages
  add column if not exists rendered_device_time timestamptz;
