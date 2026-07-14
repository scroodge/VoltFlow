-- Qwen verification result for the restricted Telegram event inbox.

alter table public.telegram_group_events
  add column if not exists intent text,
  add column if not exists confidence numeric,
  add column if not exists title text,
  add column if not exists item_type text,
  add column if not exists city text,
  add column if not exists generation text,
  add column if not exists price numeric,
  add column if not exists currency text,
  add column if not exists contact text,
  add column if not exists actionable boolean not null default false,
  add column if not exists needs_review boolean not null default true,
  add column if not exists verification_reason text,
  add column if not exists verified_at timestamptz;

alter table public.telegram_group_events
  drop constraint if exists telegram_group_events_intent_check;

alter table public.telegram_group_events
  add constraint telegram_group_events_intent_check
    check (intent is null or intent in ('sell', 'wanted', 'service', 'question', 'irrelevant', 'ambiguous'));

alter table public.telegram_group_events
  drop constraint if exists telegram_group_events_confidence_check;

alter table public.telegram_group_events
  add constraint telegram_group_events_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table public.telegram_group_events
  drop constraint if exists telegram_group_events_item_type_check;

alter table public.telegram_group_events
  add constraint telegram_group_events_item_type_check
    check (item_type is null or item_type in ('accessory', 'spare_part', 'service', 'car', 'other'));
