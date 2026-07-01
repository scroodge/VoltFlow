-- Track editable Telegram live-widget messages per user per vehicle.
-- Created on first telemetry after gap, edited in-place via editMessageText.

create table if not exists public.telegram_live_messages (
  user_id    uuid not null references auth.users(id) on delete cascade,
  vehicle_id text not null,
  chat_id    bigint not null,
  message_id int not null,
  status     text not null default 'active',
  updated_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);
