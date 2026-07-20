# Vehicle live-status notifications

> **History:** an earlier version of this feature sent discrete "connected /
> parked / disconnected" Telegram messages, tracked in
> `bydmate_vehicle_state_notifications`. That table and its code
> (`src/lib/push/vehicle-state-notifications.ts`) were removed in migration
> `20260706000000` in favor of a single editable live-status message. If you
> are looking for that old event log, it no longer exists.

VoltFlow has two independent, telemetry-driven live-status surfaces: an Android web-push card
and a Telegram widget. Both are best-effort views of accepted telemetry, not command receipts or
an authority for charging-session accounting.

## Live-status web push

On compatible non-Apple web-push endpoints (primarily Android), VoltFlow replaces one tagged
notification per vehicle in place to show live charging or parked status. The server evaluates
this at telemetry ingest, so the preference must be available server-side.

- **User-owned preference:** `profiles.live_status_mode` in Postgres. The modes are `off`,
  `charging` (default), and `charging_parked`; it is not stored in `localStorage`.
- **App-owned state:** `bydmate_live_status_state` in Postgres records the last phase, push
  time, SOC, and charge-start facts used for throttling and deduplication.
- **Charging:** the card is silent and tag-replaced about once per normal charging batch
  (roughly once a minute). It includes SOC, charge power, charge-progress delta, and an ETA once
  a stable rate exists.
- **Charge end:** leaving charging emits one audible final notification with the final SOC and
  charge result.
- **Optional parked card:** `charging_parked` adds a silent parked card on entry, refreshes it on
  a one-percent SOC change or after 30 minutes, and removes it when driving starts.
- **Apple endpoints are excluded.** iOS does not silently replace web-push notifications, so
  iPhones retain the normal milestone notifications rather than receiving this live card.

The service worker honors silent/renotify/clear payload fields. A delivery failure affects only
the notification surface; telemetry ingest and charging-session processing continue.

## Telegram live widget

### What it does

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
- **Integration:** triggered by `src/app/api/bydmate/telemetry/route.ts` after accepted
  telemetry persistence

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
| `src/lib/push/live-status-notifications.ts` | Live-status phase, throttle, and payloads |
| `src/lib/push/web-push.ts` | Delivery with non-Apple endpoint filtering |
| `src/lib/telegram/bot-send.ts` | `sendTelegramMessage`, `editTelegramMessageText` |
| `src/app/api/bydmate/telemetry/route.ts` | Calls `updateTelegramLiveWidgets` |
| `supabase/migrations/20260719120000_live_status_notifications.sql` | Android preference and state table |
| `supabase/migrations/20260701000000_telegram_live_messages.sql` | State tracking table |
