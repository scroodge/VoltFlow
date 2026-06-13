-- Catalog of published VoltFlow Mate APK releases.
-- The web app compares bydmate_live_snapshots.mate_version (the build running on
-- the car) against the latest row here to tell the user an update is available.
-- Rows are written by the release script in BYDMate-own (tools/publish-mate-release.sh)
-- using the Supabase service-role key; clients only read.

create table if not exists public.mate_app_releases (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique,           -- versionName, e.g. "0.3.9.4"
  version_code  integer,                         -- versionCode, e.g. 323
  apk_url       text,                            -- optional direct download / instructions link
  release_notes text,                            -- optional changelog
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- Latest release is the highest version_code (fall back to published_at).
create index if not exists mate_app_releases_latest_idx
  on public.mate_app_releases (version_code desc, published_at desc);

alter table public.mate_app_releases enable row level security;

-- Release info is not user-scoped: any authenticated user may read it.
drop policy if exists mate_app_releases_select_authenticated on public.mate_app_releases;
create policy mate_app_releases_select_authenticated
  on public.mate_app_releases
  for select
  to authenticated
  using (true);

-- Writes happen via service-role only (release script); no insert/update policy.

-- Seed the build that is current at migration time so the feature works
-- immediately. Later releases are upserted by the publish script.
insert into public.mate_app_releases (version, version_code, release_notes)
values ('0.3.9.4', 323, 'Background-restriction reminder + ADB improvements.')
on conflict (version) do nothing;
