-- Telegram Mini App dual-operation foundations.
-- Adds Telegram identity to profiles so a Telegram user maps to one VoltFlow
-- account (auto-linked on first valid initData) and existing PWA users can
-- connect their Telegram from Settings. Also records the preferred channel for
-- charge/service notifications (web push vs Telegram bot message vs both).
-- Idempotent (self-hosted has no schema_migrations tracking; repo file is the
-- only history) — apply with psql -f on supabase.mykid.life.

alter table public.profiles
  add column if not exists telegram_id bigint;

alter table public.profiles
  add column if not exists telegram_username text;

alter table public.profiles
  add column if not exists notify_channel text not null default 'web_push'
    check (notify_channel in ('web_push', 'telegram', 'both'));

-- One Telegram account links to at most one profile. NULLs are distinct in
-- Postgres, so unlinked users (telegram_id is null) are unaffected.
create unique index if not exists profiles_telegram_id_key
  on public.profiles (telegram_id)
  where telegram_id is not null;

comment on column public.profiles.telegram_id is
  'Telegram user id (from validated initData). Auto-linked on first Mini App login; existing PWA users can connect it from Settings. Unique per profile.';
comment on column public.profiles.telegram_username is
  'Telegram @username captured at link time (display only; may go stale).';
comment on column public.profiles.notify_channel is
  'Where charge/service notifications go: web_push (PWA, default), telegram (bot message), or both.';
