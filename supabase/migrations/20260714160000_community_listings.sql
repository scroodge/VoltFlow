-- Moderated marketplace drafts derived from Telegram group events.
-- Drafts are never public until an admin explicitly publishes them.

create table if not exists public.community_listings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  telegram_user_id bigint,
  listing_type text not null,
  title text not null,
  description text not null default '',
  item_type text not null default 'other',
  city text,
  generation text,
  price numeric,
  currency text,
  contact_link text,
  source_chat_id bigint not null,
  source_message_id bigint not null,
  status text not null default 'draft',
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint community_listings_listing_type_check
    check (listing_type in ('sell', 'wanted', 'service')),
  constraint community_listings_item_type_check
    check (item_type in ('accessory', 'spare_part', 'service', 'car', 'other')),
  constraint community_listings_status_check
    check (status in ('draft', 'published', 'sold', 'expired', 'removed')),
  constraint community_listings_price_check
    check (price is null or price >= 0),
  constraint community_listings_source_key_unique
    unique (source_chat_id, source_message_id)
);

create index if not exists community_listings_public_search_idx
  on public.community_listings(status, expires_at, item_type, city);

create index if not exists community_listings_owner_idx
  on public.community_listings(owner_user_id);

alter table public.community_listings enable row level security;

drop policy if exists "Public can read active published listings" on public.community_listings;
create policy "Public can read active published listings"
on public.community_listings
for select
using (status = 'published' and expires_at > now());

drop policy if exists "Admins can manage community listings" on public.community_listings;
create policy "Admins can manage community listings"
on public.community_listings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on table public.community_listings from anon, authenticated;
grant select on table public.community_listings to anon, authenticated;
grant all on table public.community_listings to service_role;

drop trigger if exists set_community_listings_updated_at on public.community_listings;
create trigger set_community_listings_updated_at
before update on public.community_listings
for each row execute function public.set_updated_at();
