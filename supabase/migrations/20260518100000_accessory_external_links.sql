alter table public.accessories
add column if not exists external_links jsonb not null default '[]'::jsonb;

alter table public.accessories
drop constraint if exists accessories_external_links_array_check;

alter table public.accessories
add constraint accessories_external_links_array_check
check (jsonb_typeof(external_links) = 'array');
