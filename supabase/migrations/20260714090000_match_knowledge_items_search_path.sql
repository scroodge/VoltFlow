-- Fix: semantic search returned 500 for every query on self-hosted.
--
--   42883: operator does not exist: extensions.vector <=> extensions.vector
--
-- pgvector is installed into the `extensions` schema, so the `<=>` distance operator lives
-- there. `match_knowledge_items` was created without a `SET search_path` of its own, so it
-- resolved operators using *the caller's* search_path. The API roles (anon, authenticated,
-- service_role) have no search_path role setting, so the PostgREST connection never had
-- `extensions` on the path and `<=>` could not be resolved.
--
-- It worked from an interactive psql session (whose default path is
-- `"$user", public, extensions`) and failed from the app — which is why the database looked
-- healthy while search was dead. On Supabase Cloud `extensions` is on the default path, so
-- the original migration was written against an environment that hid the bug.
--
-- Pinning search_path on the function makes it correct regardless of caller. Any future
-- function using pgvector operators must do the same.

do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'match_knowledge_items'
  ) then
    execute 'alter function public.match_knowledge_items('
         || 'query_embedding extensions.vector, '
         || 'match_threshold double precision, '
         || 'match_count integer, '
         || 'filter_category text, '
         || 'filter_generation text, '
         || 'filter_source_types text[]'
         || ') set search_path = public, extensions';
  end if;
end
$$;
