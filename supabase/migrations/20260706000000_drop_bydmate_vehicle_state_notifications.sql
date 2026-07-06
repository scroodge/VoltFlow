-- Telegram vehicle-state messages (connected / parked / disconnected) were removed
-- from the ingest path in favor of the editable live widget (telegram_live_messages).
-- This table only tracked per-vehicle notification state for that feature; nothing
-- else reads or writes it.
drop table if exists public.bydmate_vehicle_state_notifications;
