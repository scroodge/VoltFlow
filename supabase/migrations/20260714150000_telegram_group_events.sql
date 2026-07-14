-- Short-lived, service-role-only inbox for Telegram group updates.
-- Raw Telegram updates must not become public knowledge-base content.

create table if not exists public.telegram_group_events (
  id uuid primary key default gen_random_uuid(),
  update_id bigint unique,
  event_type text not null,
  chat_id bigint not null,
  chat_type text not null,
  chat_title text,
  chat_username text,
  message_id bigint not null,
  telegram_user_id bigint,
  username text,
  display_name text,
  sent_at timestamptz,
  edited_at timestamptz,
  text text not null default '',
  reply_to_message_id bigint,
  media_type text,
  media_file_id text,
  protected_content boolean not null default false,
  source_url text,
  raw_update jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),

  constraint telegram_group_events_event_type_check
    check (event_type in ('new', 'edited')),
  constraint telegram_group_events_chat_type_check
    check (chat_type in ('group', 'supergroup')),
  constraint telegram_group_events_status_check
    check (status in ('pending', 'processing', 'processed', 'failed', 'ignored')),
  constraint telegram_group_events_media_type_check
    check (media_type is null or media_type in ('photo', 'video', 'document', 'audio', 'voice', 'sticker')),
  constraint telegram_group_events_attempts_check
    check (attempts >= 0)
);

create unique index if not exists telegram_group_events_chat_message_idx
  on public.telegram_group_events(chat_id, message_id);

create index if not exists telegram_group_events_processing_idx
  on public.telegram_group_events(status, received_at);

create index if not exists telegram_group_events_expiry_idx
  on public.telegram_group_events(expires_at);

alter table public.telegram_group_events enable row level security;

revoke all on table public.telegram_group_events from anon, authenticated;
grant all on table public.telegram_group_events to service_role;
