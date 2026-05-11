-- Persist user currency/locale preferences at account level.
alter table public.profiles
add column if not exists preferred_currency text not null default 'EUR'
  check (preferred_currency in ('EUR', 'USD', 'BYN', 'RUB'));

alter table public.profiles
add column if not exists preferred_locale text not null default 'en'
  check (preferred_locale in ('en', 'be', 'ru'));

