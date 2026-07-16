# Telegram live widget

> **History:** an earlier version of this feature sent discrete "connected /
> parked / disconnected" Telegram messages, tracked in
> `bydmate_vehicle_state_notifications`. That table and its code
> (`src/lib/push/vehicle-state-notifications.ts`) were removed in migration
> `20260706000000` in favor of a single editable live-status message. If you
> are looking for that old event log, it no longer exists.

## What it does

After each accepted telemetry ingest, the user's Telegram chat gets one
message per vehicle showing current state, SOC, charge power/time-to-full,
odometer, speed, and an optional map link. Instead of posting a new message
per update, the widget is created once and then edited in place via
Telegram's `editMessageText`, so the chat doesn't fill up with spam.

- **Detection/render/send:** `src/lib/telegram/live-widget.ts` —
  `updateTelegramLiveWidgets()`
- **Transport:** `sendTelegramMessage` / `editTelegramMessageText` in
  `src/lib/telegram/bot-send.ts`
- **State tracking:** `telegram_live_messages` table, one row per
  `(user_id, vehicle_id)`
- **Integration:** called from `src/app/api/bydmate/telemetry/route.ts`,
  after charge notifications and before auto charging-session processing

## Behavior

- Only runs when the profile has a `telegram_id` (linked Telegram account).
  No chat ID → no-op.
- Vehicle state is inferred from the latest sample per vehicle in the batch:
  `driving` (drive telemetry) → `charging` (charging signal) → `parked` →
  `offline` if the sample is more than 10 minutes old at receipt time.
- **Edits throttle to at most once per 30 seconds** per `(user_id, vehicle_id)`
  (`THROTTLE_MS`), tracked via `telegram_live_messages.updated_at`. Updates
  inside the window are skipped, not queued.
- If the existing message is `active` and fresh, the widget is edited in
  place. If the vehicle just came back from `offline` (car was silent
  >10 min), a **new** message is sent instead of editing the old one, so
  the "car went offline" gap stays visible in the chat.
- The inline keyboard button always deep-links to `/vehicle`.

## State table

```sql
telegram_live_messages (
  user_id, vehicle_id (PK),
  chat_id, message_id,
  status,       -- 'active' (only status currently written)
  updated_at
)
```

## Limits

- The Edge Function ingest path (`supabase/functions/bydmate-telemetry/`)
  does **not** update the live widget — only the Next.js route handler does.
- Widget copy (labels, emoji, map link format) is Russian-only; there is no
  i18n pass on this surface yet.

## File map

| File | Role |
|---|---|
| `src/lib/telegram/live-widget.ts` | State detection, HTML rendering, send/edit + throttle |
| `src/lib/telegram/bot-send.ts` | `sendTelegramMessage`, `editTelegramMessageText` |
| `src/app/api/bydmate/telemetry/route.ts` | Calls `updateTelegramLiveWidgets` |
| `supabase/migrations/20260701000000_telegram_live_messages.sql` | State tracking table |
