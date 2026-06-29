-- Storage RLS: admin-only write on CMS + attachment buckets.
--
-- WHY: `storage.objects` has RLS enabled but had ZERO policies on self-hosted
-- prod (policies are configured outside SQL migrations and were lost on the
-- hosting migration). RLS-on + no-policy = every write by the `authenticated`
-- role is denied, so `uploadAccessoryImage()` (anon-key SSR client → role
-- `authenticated`) threw on upload and the admin "new accessory" action 500'd.
-- Buckets are already `public = true`, so public READ works; only WRITE needs
-- a policy. Writes are restricted to admins (public.admin_users).
--
-- Idempotent (drop-then-create) — self-hosted has no schema_migrations table.

do $$
declare
  b text;
  buckets text[] := array[
    'knowledge-accessories',
    'knowledge-articles',
    'knowledge-spare-parts',
    'service-attachments',
    'cluster-backgrounds'
  ];
begin
  foreach b in array buckets loop
    -- INSERT
    execute format('drop policy if exists %I on storage.objects', 'admin_insert_' || b);
    execute format(
      'create policy %I on storage.objects for insert to authenticated '
      || 'with check (bucket_id = %L and exists (select 1 from public.admin_users a where a.user_id = auth.uid()))',
      'admin_insert_' || b, b);

    -- UPDATE
    execute format('drop policy if exists %I on storage.objects', 'admin_update_' || b);
    execute format(
      'create policy %I on storage.objects for update to authenticated '
      || 'using (bucket_id = %L and exists (select 1 from public.admin_users a where a.user_id = auth.uid())) '
      || 'with check (bucket_id = %L and exists (select 1 from public.admin_users a where a.user_id = auth.uid()))',
      'admin_update_' || b, b, b);

    -- DELETE
    execute format('drop policy if exists %I on storage.objects', 'admin_delete_' || b);
    execute format(
      'create policy %I on storage.objects for delete to authenticated '
      || 'using (bucket_id = %L and exists (select 1 from public.admin_users a where a.user_id = auth.uid()))',
      'admin_delete_' || b, b);
  end loop;
end $$;
