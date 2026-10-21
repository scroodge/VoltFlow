-- Audit of Mate «Отправить диагностику» uploads relayed to the developer's Telegram chat by
-- POST /api/bydmate/diagnostics. The bundle itself is NOT stored here (it lives only in that
-- chat); this row drives the rate limit (per vehicle per hour, per user per day) and answers
-- "did it arrive". App-owned operational data: RLS on with no policies, so only service_role
-- (the route) reads or writes it. Idempotent: the repo file is the history.
create table if not exists public.bydmate_diagnostic_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  created_at timestamptz not null default now(),
  size_bytes integer not null,
  mate_version text,
  status text not null check (status in ('sent', 'failed')),
  telegram_message_id bigint,
  error text
);

create index if not exists bydmate_diagnostic_uploads_vehicle_created_idx
  on public.bydmate_diagnostic_uploads (user_id, vehicle_id, created_at desc);

alter table public.bydmate_diagnostic_uploads enable row level security;

revoke all on table public.bydmate_diagnostic_uploads from public, anon, authenticated;
grant select, insert on table public.bydmate_diagnostic_uploads to service_role;
