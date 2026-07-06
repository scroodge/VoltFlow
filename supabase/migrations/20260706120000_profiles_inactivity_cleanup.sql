-- Track last user activity (telemetry or login) for inactivity-based cleanup.
-- inactivity_warning_sent_at is set when we send the 30-day warning email.
-- Users with last_active_at > 60 days past AND warning sent get deleted.

alter table public.profiles
  add column if not exists last_active_at timestamptz;

alter table public.profiles
  add column if not exists inactivity_warning_sent_at timestamptz;

create index if not exists idx_profiles_inactivity
  on public.profiles (last_active_at)
  where last_active_at is not null;
