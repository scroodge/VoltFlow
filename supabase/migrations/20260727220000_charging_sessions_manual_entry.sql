-- Manual entry for charges the ingest pipeline missed.
--
-- Auto-start needs 4 consecutive charging samples within 3 minutes plus a parked vehicle;
-- when the Mate app is closed or the head unit powers down mid-charge, a real charge
-- produces no session row at all. `manual_entry` marks a row the user hand-entered from a
-- provider receipt so the UI can badge it, deletion can be scoped to it, and the
-- efficiency-learning corpus can exclude it.

alter table if exists public.charging_sessions
  add column if not exists manual_entry boolean not null default false;

comment on column public.charging_sessions.manual_entry is
  'True when the row was hand-entered by the user for a charge the ingest pipeline missed. '
  'Energy and cost come from a provider receipt; SOC and charger power are derived from them, '
  'so the row is never used as an efficiency-learning observation. Manual rows also set '
  'energy_overridden so reconcile leaves them alone.';
