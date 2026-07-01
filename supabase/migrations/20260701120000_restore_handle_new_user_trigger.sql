-- Restore the profile-seeding trigger on auth.users.
--
-- The init migration (20250511000000_init.sql) defines both
-- public.handle_new_user() and the on_auth_user_created trigger. On self-hosted
-- Supabase a GoTrue version upgrade recreates the auth.users table and silently
-- drops custom triggers on it — leaving new signups without a public.profiles
-- row. That breaks any FK into profiles (e.g. bydmate_link_codes.user_id →
-- profiles.id: "insert or update violates foreign key constraint" → 500 on
-- POST /api/bydmate/link-code). The function survives; only the trigger is lost.
--
-- Idempotent: safe to re-run whenever the trigger goes missing again.

-- Ensure the function exists (no-op if the init migration already created it).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Re-attach the trigger.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill any auth.users that are currently missing a profile row.
insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
