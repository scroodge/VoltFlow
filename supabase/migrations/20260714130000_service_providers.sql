create table if not exists public.service_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider_type text not null default 'service_center',
  city text,
  service_area text,
  description text,
  services jsonb not null default '[]'::jsonb,
  price_from numeric,
  currency text not null default 'BYN',
  external_links jsonb not null default '[]'::jsonb,
  model_generations text[] not null default array['gen1_2024', 'gen2_2025']::text[],
  image_url text,
  image_alt text,
  status text not null default 'draft',
  sort_order integer not null default 0,
  verified_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_providers_status_check check (status in ('draft', 'published', 'archived')),
  constraint service_providers_provider_type_check check (provider_type in ('service_center', 'mobile_service', 'detailer', 'parts_and_service', 'other')),
  constraint service_providers_services_array_check check (jsonb_typeof(services) = 'array'),
  constraint service_providers_external_links_array_check check (jsonb_typeof(external_links) = 'array'),
  constraint service_providers_model_generations_check check (
    cardinality(model_generations) > 0
    and model_generations <@ array['gen1_2024', 'gen2_2025']::text[]
  )
);

drop trigger if exists set_service_providers_updated_at on public.service_providers;
create trigger set_service_providers_updated_at
before update on public.service_providers
for each row execute function public.set_updated_at();

alter table public.service_providers enable row level security;

drop policy if exists "Everyone can read published service providers" on public.service_providers;
create policy "Everyone can read published service providers"
on public.service_providers for select
to anon, authenticated
using (status = 'published');

drop policy if exists "Admins can manage service providers" on public.service_providers;
create policy "Admins can manage service providers"
on public.service_providers for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create index if not exists service_providers_status_sort_idx
on public.service_providers(status, sort_order, name);

create index if not exists service_providers_model_generations_idx
on public.service_providers using gin(model_generations);
