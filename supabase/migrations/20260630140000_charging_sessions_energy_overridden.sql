-- Add energy_overridden flag to prevent reconcile from overwriting user/provider energy data.

alter table if exists public.charging_sessions
  add column if not exists energy_overridden boolean not null default false;
