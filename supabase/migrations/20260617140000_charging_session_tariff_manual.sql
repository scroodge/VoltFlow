-- Track whether the user manually pinned tariff on a charging session.
-- Auto GPS / power resolution must not overwrite manual corrections.

alter table public.charging_sessions
  add column if not exists tariff_manual boolean not null default false;

comment on column public.charging_sessions.tariff_manual is
  'When true, skip auto GPS/power tariff sync for this session.';
