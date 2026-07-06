-- Timestamp of the user's last manual tariff/provider pick on a session.
-- Used to delay auto-saving a GPS tariff location until the pick has "stuck"
-- for a few minutes (see persistManualTariffLocationFromSession).

alter table public.charging_sessions
  add column if not exists tariff_selected_at timestamptz;
