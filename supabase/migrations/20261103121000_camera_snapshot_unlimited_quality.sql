-- Camera snapshots are a rolling `latest.jpg` per vehicle, not an archive.
-- Allow the 6 MiB API limit while retaining the private JPEG-only bucket.
update storage.buckets
set public = false,
    file_size_limit = null,
    allowed_mime_types = array['image/jpeg']::text[]
where id = 'vehicle-camera-snapshots';
