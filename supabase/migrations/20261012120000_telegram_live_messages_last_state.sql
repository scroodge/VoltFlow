-- Last state rendered in the Telegram live widget (charging | parked | driving | offline).
-- A change of state bypasses the 30 s edit throttle, so a driving → parked transition in
-- the last batch before a car stops delivering is not dropped. Null = unknown (throttle
-- applies as before). Table stays service_role-only; no grants change.
alter table public.telegram_live_messages
  add column if not exists last_state text;
