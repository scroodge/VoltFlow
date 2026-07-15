-- RLS limits these privileges to admin rows; authenticated needs table-level
-- write grants for the admin moderation server actions to reach the policies.

grant select, insert, update, delete on table public.community_listings to authenticated;
grant all on table public.community_listings to service_role;
