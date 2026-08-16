-- Cloud backup of the VoltFlow Dashboard cluster layout.
--
-- The layout is a single DashboardLayoutConfig JSON blob living in the head unit's
-- SharedPreferences, with no export path. `adb shell pm clear` (a documented step in the
-- Dashboard's own device runbook), a reinstall, or a replacement head unit all lose an
-- arrangement the driver may have spent an hour building. This table is that backup.
--
-- Deliberately its own table rather than a column on public.bydmate_devices. Re-pairing
-- replaces a device row (see bydmate_devices_user_kind_unique), so a layout parked there
-- would be destroyed by precisely the event it exists to survive: linking the app on a
-- replacement head unit.
--
-- One row per account, upserted on write. Not a revision history — the cluster pushes
-- only on an explicit Save and never on Reset, so the stored copy is always a layout the
-- driver deliberately kept.

create table if not exists public.dashboard_layouts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  layout jsonb not null,
  layout_version integer not null default 1,
  updated_at timestamptz not null default now()
);

comment on table public.dashboard_layouts is
  'Cloud backup of each account''s cluster layout. One row per profile, upserted by /api/bydmate/dashboard/layout.';

comment on column public.dashboard_layouts.layout_version is
  'DashboardLayoutConfig.VERSION of the writing APK. The cluster refuses to restore a row newer than the installed app understands, because unrecognised widget types fall back to a consumption gauge rather than failing loudly.';

-- No size CHECK constraint here on purpose: the expressions that could express one
-- (pg_column_size, or a jsonb-to-text cast) are not immutable, so the cap is enforced in
-- the route instead. A real layout is a few KB; anything near the limit is a bug or a
-- stolen key, not a busy dashboard.

alter table public.dashboard_layouts enable row level security;

-- Reads are allowed directly to the owning account so a future web layout editor on
-- voltflow.life can render the saved cluster without needing a new endpoint.
create policy "Users read own dashboard layout"
on public.dashboard_layouts for select
to authenticated
using (user_id = auth.uid());

-- No insert/update/delete policy, deliberately. Writes go through
-- /api/bydmate/dashboard/layout using supabaseAdmin, which is where the entitlement
-- check, the payload size cap, and the version stamp live. A direct client write would
-- bypass all three.
