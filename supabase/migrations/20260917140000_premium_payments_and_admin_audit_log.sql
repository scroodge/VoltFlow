-- BACKLOG.md, Premium monetization plan, Phase 4: an admin premium grant today is just
-- "set premium_until" with no record of amount, method, or who did it, and there is no
-- history of admin/premium changes at all. Two new append-only, admin/service-role-only
-- tables. Both are written exclusively through the admin API routes using the
-- service_role client (getSupabaseAdmin()), the same way profiles.is_premium already is
-- -- never through the browser's authenticated client -- so anon/authenticated get no
-- grant at all on either table, matching the "close every new surface explicitly"
-- lesson from the 2026-09-11 SECURITY DEFINER incident in AGENTS.md: PostgREST exposes
-- every table as a REST endpoint too, not just functions, and Supabase's default
-- bootstrap grant (confirmed live on profiles: full arwdDxtm to anon+authenticated)
-- would otherwise apply here as well.

create table if not exists public.premium_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount >= 0),
  currency text not null,
  method text not null,
  note text,
  recorded_by_admin_id uuid not null references auth.users(id),
  applied_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists premium_payments_user_id_idx on public.premium_payments (user_id);
create index if not exists premium_payments_created_at_idx on public.premium_payments (created_at desc);

alter table public.premium_payments enable row level security;
revoke all on public.premium_payments from public, anon, authenticated;

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_admin_id uuid not null references auth.users(id),
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_target_user_id_idx on public.admin_audit_log (target_user_id);
create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
