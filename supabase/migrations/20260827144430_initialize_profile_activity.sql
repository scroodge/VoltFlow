-- New accounts must enter the inactivity lifecycle with a concrete activity
-- timestamp. Existing NULLs are intentionally not backfilled here: ingestion
-- and Telegram entry paths must ship first so a backfill cannot go stale again.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, last_active_at)
  values (new.id, new.email, coalesce(new.created_at, now()))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
