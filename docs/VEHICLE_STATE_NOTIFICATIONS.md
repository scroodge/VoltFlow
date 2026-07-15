# Vehicle State Notifications (Telegram Bot)

Sends real-time Telegram notifications when the vehicle changes state, detected during telemetry ingest.

## States

| Event | Trigger | Message |
|---|---|---|
| **Connected** | First-ever data, or data after ≥5 min gap | Vehicle connected + odometer + SOC + map pin |
| **Parked** | Gear P + speed ≤5 km/h, wasn't parked before | Vehicle parked + odometer + SOC + map pin |
| **Disconnected** | Gap >10 min since last data, not yet notified | Vehicle disconnected + last known odometer + SOC + map pin |

Disconnected is detected **retroactively** — when data resumes after >10 min, the handler sends "disconnected" with the last stored state, then "connected" with fresh data.

## Architecture

- **Detection:** `src/lib/push/vehicle-state-notifications.ts` — `processBydmateVehicleStateNotifications()`
- **Transport:** `sendTelegramMessage` + `sendTelegramLocation` in `src/lib/telegram/bot-send.ts`
- **State tracking:** `bydmate_vehicle_state_notifications` table (one row per `(user_id, vehicle_id)`)
- **Integration:** called from `src/app/api/bydmate/telemetry/route.ts` after charge notifications

## State Table

```sql
bydmate_vehicle_state_notifications (
  user_id, vehicle_id (PK),
  last_device_time, last_received_at,
  last_soc, last_odometer_km,
  last_lat, last_lon,
  last_is_parked,
  last_connected_at, last_disconnected_at, last_park_notified_at
)
```

## Limits

- Park notifications have a 1-min cooldown between repeats
- Only sends when user's `notify_channel` is `telegram` or `both`
- Edge Function (`supabase/functions/bydmate-telemetry/`) does NOT process state notifications — only the Next.js route handler does

## File Map

| File | Role |
|---|---|
| `src/lib/push/vehicle-state-notifications.ts` | Detection + notification logic |
| `src/lib/telegram/bot-send.ts` | `sendTelegramMessage`, `sendTelegramLocation` |
| `src/app/api/bydmate/telemetry/route.ts` | Calls `processBydmateVehicleStateNotifications` |
| `supabase/migrations/20260629130000_bydmate_vehicle_state_notifications.sql` | State tracking table |
