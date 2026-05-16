alter table public.accessories
add column if not exists image_url text,
add column if not exists image_alt text;

insert into storage.buckets (id, name, public)
values ('knowledge-accessories', 'knowledge-accessories', true)
on conflict (id) do update set public = true;

drop policy if exists "Public can read knowledge accessory images" on storage.objects;
create policy "Public can read knowledge accessory images"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'knowledge-accessories');

drop policy if exists "Admins can upload knowledge accessory images" on storage.objects;
create policy "Admins can upload knowledge accessory images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'knowledge-accessories'
  and public.is_admin()
);

drop policy if exists "Admins can update knowledge accessory images" on storage.objects;
create policy "Admins can update knowledge accessory images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'knowledge-accessories'
  and public.is_admin()
)
with check (
  bucket_id = 'knowledge-accessories'
  and public.is_admin()
);

drop policy if exists "Admins can delete knowledge accessory images" on storage.objects;
create policy "Admins can delete knowledge accessory images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'knowledge-accessories'
  and public.is_admin()
);
