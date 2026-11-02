-- Private, short-lived camera snapshots uploaded only by a paired Mate client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehicle-camera-snapshots',
  'vehicle-camera-snapshots',
  false,
  2097152,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
