create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  summary text,
  category_id uuid references public.knowledge_categories(id),
  content jsonb not null default '[]'::jsonb,
  tips jsonb default '[]'::jsonb,
  warnings jsonb default '[]'::jsonb,
  tags text[] default '{}'::text[],
  status text not null default 'draft',
  source_label text,
  sort_order integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_articles_status_check check (status in ('draft', 'published', 'archived')),
  constraint knowledge_articles_content_array_check check (jsonb_typeof(content) = 'array'),
  constraint knowledge_articles_tips_array_check check (tips is null or jsonb_typeof(tips) = 'array'),
  constraint knowledge_articles_warnings_array_check check (warnings is null or jsonb_typeof(warnings) = 'array')
);

create table if not exists public.faq_items (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category_id uuid references public.knowledge_categories(id),
  tags text[] default '{}'::text[],
  status text not null default 'draft',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faq_items_status_check check (status in ('draft', 'published', 'archived'))
);

create table if not exists public.accessories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category_id uuid references public.knowledge_categories(id),
  use_case text,
  why_useful text,
  what_to_check jsonb default '[]'::jsonb,
  priority text not null default 'useful',
  risk_notes jsonb default '[]'::jsonb,
  search_keywords text[] default '{}'::text[],
  external_url text,
  status text not null default 'draft',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accessories_priority_check check (priority in ('must-have', 'useful', 'optional')),
  constraint accessories_status_check check (status in ('draft', 'published', 'archived')),
  constraint accessories_what_to_check_array_check check (what_to_check is null or jsonb_typeof(what_to_check) = 'array'),
  constraint accessories_risk_notes_array_check check (risk_notes is null or jsonb_typeof(risk_notes) = 'array')
);

create table if not exists public.article_relations (
  article_id uuid references public.knowledge_articles(id) on delete cascade,
  related_article_id uuid references public.knowledge_articles(id) on delete cascade,
  primary key (article_id, related_article_id),
  constraint article_relations_not_self check (article_id <> related_article_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_knowledge_categories_updated_at on public.knowledge_categories;
create trigger set_knowledge_categories_updated_at
before update on public.knowledge_categories
for each row execute function public.set_updated_at();

drop trigger if exists set_knowledge_articles_updated_at on public.knowledge_articles;
create trigger set_knowledge_articles_updated_at
before update on public.knowledge_articles
for each row execute function public.set_updated_at();

drop trigger if exists set_faq_items_updated_at on public.faq_items;
create trigger set_faq_items_updated_at
before update on public.faq_items
for each row execute function public.set_updated_at();

drop trigger if exists set_accessories_updated_at on public.accessories;
create trigger set_accessories_updated_at
before update on public.accessories
for each row execute function public.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.knowledge_categories enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.faq_items enable row level security;
alter table public.accessories enable row level security;
alter table public.article_relations enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

drop policy if exists "Admins can read admin users" on public.admin_users;
create policy "Admins can read admin users"
on public.admin_users for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can manage admin users" on public.admin_users;
create policy "Admins can manage admin users"
on public.admin_users for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Everyone can read categories" on public.knowledge_categories;
create policy "Everyone can read categories"
on public.knowledge_categories for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage categories" on public.knowledge_categories;
create policy "Admins can manage categories"
on public.knowledge_categories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Everyone can read published articles" on public.knowledge_articles;
create policy "Everyone can read published articles"
on public.knowledge_articles for select
to anon, authenticated
using (status = 'published');

drop policy if exists "Admins can manage articles" on public.knowledge_articles;
create policy "Admins can manage articles"
on public.knowledge_articles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Everyone can read published faq" on public.faq_items;
create policy "Everyone can read published faq"
on public.faq_items for select
to anon, authenticated
using (status = 'published');

drop policy if exists "Admins can manage faq" on public.faq_items;
create policy "Admins can manage faq"
on public.faq_items for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Everyone can read published accessories" on public.accessories;
create policy "Everyone can read published accessories"
on public.accessories for select
to anon, authenticated
using (status = 'published');

drop policy if exists "Admins can manage accessories" on public.accessories;
create policy "Admins can manage accessories"
on public.accessories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Everyone can read published relations" on public.article_relations;
create policy "Everyone can read published relations"
on public.article_relations for select
to anon, authenticated
using (
  exists (
    select 1 from public.knowledge_articles a
    where a.id = article_id and a.status = 'published'
  )
  and exists (
    select 1 from public.knowledge_articles a
    where a.id = related_article_id and a.status = 'published'
  )
);

drop policy if exists "Admins can manage relations" on public.article_relations;
create policy "Admins can manage relations"
on public.article_relations for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create index if not exists knowledge_categories_sort_idx on public.knowledge_categories(sort_order, title);
create index if not exists knowledge_articles_status_sort_idx on public.knowledge_articles(status, sort_order, title);
create index if not exists knowledge_articles_category_idx on public.knowledge_articles(category_id);
create index if not exists faq_items_status_sort_idx on public.faq_items(status, sort_order, question);
create index if not exists accessories_status_sort_idx on public.accessories(status, sort_order, title);
