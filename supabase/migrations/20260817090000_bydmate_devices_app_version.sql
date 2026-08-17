-- Which build of a paired client is actually installed, so settings can show it.
--
-- Mate already reports its build through telemetry (`mate_version` on a live snapshot),
-- but the Dashboard sends no telemetry at all — its only regular cloud call is the
-- entitlement/session fetch. So its version has to live on the credential row instead.
--
-- These columns are kind-agnostic on purpose: Mate can start filling them in later
-- without a second migration.
--
-- The `last_seen_at` decision from 20260816120000 still holds — authentication is the
-- ~6 s command-poll hot path and must not become a write. `app_version_seen_at` is safe
-- only because writers update it on change, and only from the Dashboard's session call,
-- which the head unit caches for 6 hours. Do not stamp it from the shared auth lookup.

alter table public.bydmate_devices
  add column if not exists app_version text,
  add column if not exists version_code integer,
  add column if not exists app_version_seen_at timestamptz;

comment on column public.bydmate_devices.app_version is
  'versionName reported by the paired client, e.g. 0.2.0. Null until a build that reports it checks in.';
comment on column public.bydmate_devices.version_code is
  'versionCode reported by the paired client. Ordering key: versionName is display only.';
comment on column public.bydmate_devices.app_version_seen_at is
  'When the reported version last changed — not a heartbeat. Writers must update on change only.';
