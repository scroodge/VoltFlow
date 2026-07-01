# Telegram live vehicle widget

Replace the stream of separate Telegram messages with a single editable
"live card" that updates in-place as the vehicle state changes.

## Problem

The bot sends up to 8 separate messages per telemetry cycle — connected,
parked, disconnected, plus 5 charge thresholds (25/50/75/95/100 %). Users
can't glance the current state without scrolling through history.

## Solution

A single editable message (Telegram `editMessageText`) that shows the
current vehicle status at a glance. Created on first telemetry after a gap,
updated in-place during activity, finalised on disconnect.

## Changes

### 1. DB migration — `telegram_live_messages` table

```sql
create table if not exists telegram_live_messages (
  user_id       uuid not null references auth.users(id) on delete cascade,
  vehicle_id    text not null,
  chat_id       bigint not null,
  message_id    int not null,
  status        text not null default 'active',
  updated_at    timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);
```

Stores one row per (user, vehicle) — the bot edits the same message ID.

### 2. `bot-send.ts` — add `editTelegramMessageText` export

Calls `editMessageText` on the Bot API. Same shape as `sendTelegramMessage`
but takes `chatId` + `messageId` instead of just `chatId`.

### 3. New module `src/lib/telegram/live-widget.ts`

- `updateTelegramLiveWidget(supabase, userId, samples, receivedAt, carData)`:
  - Loads current row from `telegram_live_messages`
  - Computes widget HTML string + hash from current data
  - **Throttle**: skip if hash unchanged AND last edit < 60 s ago
  - No row → `sendMessage`, insert row with returned `message_id`
  - Row exists → `editMessageText`
  - Car offline > 10 min → final edit, set `status = 'archived'`
- Widget format (HTML parse_mode):
  - **Charging**: car name + "🔌 Зарядка", SOC bar, power/time/cost, map
  - **Parked**: car name + "🚗 Припаркован", SOC, odometer, map
  - **Driving**: car name + "🚗 В движении", SOC, speed, map
  - **Offline**: car name + "💤 Офлайн", SOC, last time, map
- Inline button: `[Открыть VoltFlow]` web_app link

### 4. Wire into telemetry route

In `src/app/api/bydmate/telemetry/route.ts`, after the existing notification
calls, call `updateTelegramLiveWidget` in its own try/catch (non-blocking).

## What stays

- Existing event notifications (connected/parked/disconnected) — kept as-is
- Charge threshold alerts (25/50/75/95/100 %) — kept as-is

Only additive — no existing code is modified except the telemetry route
integration point.
