-- Telegram live-message rows contain private user/vehicle/chat identifiers and are
-- accessed only by the server-side service role widget worker.
alter table public.telegram_live_messages enable row level security;

revoke all on table public.telegram_live_messages from public, anon, authenticated;
grant all on table public.telegram_live_messages to service_role;
