-- Onboarding gate: mark when a user's car first streamed telemetry.
-- Set once by the telemetry ingest path on the first sample for a user; never
-- reset. Drives the post-login "install APK on car + link" onboarding wizard.
alter table public.profiles
  add column if not exists vehicle_connected_at timestamptz;

comment on column public.profiles.vehicle_connected_at is
  'Set once when the first BYDMate telemetry sample is received for this user. Drives the post-login onboarding gate (install APK on car + link). Never reset.';
