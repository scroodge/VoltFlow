-- VoltFlow Dashboard: premium flag, cluster command secrets, background storage metadata

alter table public.profiles
add column if not exists is_premium boolean not null default false;

create table if not exists public.mate_dashboard_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.mate_dashboard_secrets enable row level security;

-- No client policies: service role / API routes only.

insert into public.mate_dashboard_secrets (key, value)
values ('cluster_projection_cmd', '迪加强开仪表投屏')
on conflict (key) do nothing;

create table if not exists public.cluster_backgrounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists cluster_backgrounds_user_id_idx
on public.cluster_backgrounds (user_id, created_at desc);

alter table public.cluster_backgrounds enable row level security;

create policy "Users read own cluster backgrounds"
on public.cluster_backgrounds for select
to authenticated
using (user_id = auth.uid());

create policy "Users insert own cluster backgrounds"
on public.cluster_backgrounds for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users delete own cluster backgrounds"
on public.cluster_backgrounds for delete
to authenticated
using (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('cluster-backgrounds', 'cluster-backgrounds', false)
on conflict (id) do update set public = false;

drop policy if exists "Users read own cluster background files" on storage.objects;
create policy "Users read own cluster background files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'cluster-backgrounds'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users upload own cluster background files" on storage.objects;
create policy "Users upload own cluster background files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'cluster-backgrounds'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own cluster background files" on storage.objects;
create policy "Users delete own cluster background files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'cluster-backgrounds'
  and (storage.foldername(name))[1] = auth.uid()::text
);
