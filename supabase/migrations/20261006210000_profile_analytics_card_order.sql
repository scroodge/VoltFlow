-- User-owned display preference: card order on the Analytics tab.
-- NULL means "default order". The PWA keeps an instant localStorage copy; this column
-- only carries the order across devices for signed-in users.
alter table public.profiles
  add column if not exists analytics_card_order jsonb;
