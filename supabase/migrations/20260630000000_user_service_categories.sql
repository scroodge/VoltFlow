-- User-defined service categories (e.g. "oil", "transmission", "rustproofing")
-- Allows users to extend the built-in category list with custom labels + colors.

create table if not exists public.user_service_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  color      text not null default '#6B7280',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.user_service_categories enable row level security;

-- Idempotent policy setup: self-hosted has no schema_migrations tracking, so this
-- file must be safe to re-run. Postgres lacks CREATE POLICY IF NOT EXISTS, so
-- drop-then-create each policy.
drop policy if exists "user_service_categories_select_own" on public.user_service_categories;
create policy "user_service_categories_select_own"
  on public.user_service_categories for select
  using (auth.uid() = user_id);

drop policy if exists "user_service_categories_insert_own" on public.user_service_categories;
create policy "user_service_categories_insert_own"
  on public.user_service_categories for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_service_categories_delete_own" on public.user_service_categories;
create policy "user_service_categories_delete_own"
  on public.user_service_categories for delete
  using (auth.uid() = user_id);
