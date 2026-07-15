# VoltFlow — Architecture & Documentation Map

[Russian version](ARCHITECTURE.ru.md) · English is the canonical implementation reference.

**Start here.** This is the single onboarding document: what VoltFlow is, how data
flows from the car to the screen, the rules that keep that data correct, and a map
to every other doc. Read this first, then dive into the domain doc for the area you
are touching.

Companion repo: **VoltFlow Mate** (`scroodge/BYDMate-own`) — the Android gateway app
that runs on the car's DiLink head unit and pushes telemetry to this backend.

---

## 1. What VoltFlow is

A **mobile-first PWA** for BYD EV owners (built around the BYD YUAN UP / Dolphin
platform). It does four things:

1. **Charging cockpit** — live charging sessions with SOC, delivered kWh, tariff-aware
   cost, ETA, and history. Works even without live car data, by recomputing state from
   wall-clock math anchored to timestamps in Postgres.
2. **Vehicle telemetry** — ingests state-aware live data from VoltFlow Mate, stores it, and
   renders live status, trips, GPS tracks, and rich analytics.
3. **Knowledge base** — a Telegram-style CMS (guides, FAQ, accessories, spare parts)
   with semantic search.
4. **Service logbook** — maintenance records and reminders per car.

Auth, multi-tenancy, and realtime are all Supabase. Every user-scoped table is
protected by Row Level Security keyed on `auth.uid()`.
---

## 2. The big picture (data flow)

```
     Di+ / autoservice / GPS on the DiLink head unit
                              │  local 1 s poll
                              ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ VoltFlow Mate APK                                                                  │
│ Room delivery queue • payload tiering • GPS opt-out • application-ACK retry       │
│ driving 1 s | charge <98% 10 s | charge tail 1 s | parked 30 s                    │
│ flush: driving/tail 15 s, charge bulk 60 s, parked default 60 s                   │
└──────────────────────────────────────┬────────────────────────────────────────────┘
                                       │ HTTPS batches, X-API-Key + X-Vehicle-Id
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ POST /api/bydmate/telemetry          │
                    │ authenticate → normalize/sanitize →  │
                    │ idempotent ingest → fan-out          │
                    └──────────────────┬──────────────────┘
                                       │
       ┌───────────────────────────────┼────────────────────────────────┐
       ▼                               ▼                                ▼
bydmate_live_snapshots       telemetry samples + hourly rollups    trips + GPS tracks
(one latest row/vehicle,      (bounded raw detail, long-range       (server inference)
Realtime source)              compact read model)                          │
       │                               │                                │
       └──────────────┬────────────────┴───────────────┬────────────────┘
                      ▼                                ▼
          VoltFlow PWA / authenticated APIs     Telegram live widget
          live cockpit • charging • history     (server-generated, 30 s throttle)
          analytics • trips • export

Separate car-off path: shell-uid CommandDaemon polls/acks commands and sends a reduced
Di+ heartbeat every 60 s only when the app-alive beacon is stale. It never sends GPS and
does not run in parallel with the app's telemetry sender.

Separate no-ADB path: cars exposing `energydata` can upload completed trip summaries to
`/api/bydmate/trip-summaries`. They provide trip/consumption history only, not live state,
charging, commands, or tracks.
```

Two independent live channels reach the PWA:

- **Vehicle telemetry** is pushed by the car and arrives in the browser via **Supabase
  Realtime** on `bydmate_live_snapshots` (not polling).
- **Charging session progress** (`current_percent`, energy, cost) is written **by the
  PWA itself** (`ChargingSessionBackgroundSync`) ~1 Hz while charging, and shared across
  open tabs via Supabase Realtime on `charging_sessions`.

> The car/Mate ingest **never** streams per-second SOC into `charging_sessions`. It only
> creates/closes session rows and sets stop-time fields. Per-second progress requires the
> PWA to be open. This split is the single most common source of confusion — see §4.

The Telegram Mini App (`/telegram`) is currently the public knowledge base. It does not
read the DiLink head unit or render private live telemetry. The separate Telegram live
widget is generated server-side after an accepted telemetry sample, so it remains useful
when the PWA is closed.

---

## 3. The stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 App Router + React 19 |
| UI | Tailwind CSS 4, shadcn-style components, lucide-react |
| State & data | TanStack Query, Zustand |
| Forms & validation | React Hook Form, Zod |
| Backend | Supabase: Auth, Postgres, Realtime, RLS, Storage, scheduled jobs |
| PWA | `manifest.ts`, production-only service worker, web push (VAPID) |
| Content discovery | Structured navigation and optional content search |
| Deploy | Vercel (app) + self-hosted Supabase (infra specifics in local `docs/OPS_LOCAL.md`) |

**Routes** live under `src/app/`, grouped by auth layout: `(app)/` authenticated,
`(auth)/` login/reset, `(marketing)/` public. APIs under `src/app/api/`.

---

## 4. Source-of-truth rules (the invariants)

These rules are why the system stays correct across refreshes, reconnects, and PWA
restores. Breaking one of them causes the classic bugs (frozen percent, false
`completed`, phantom sessions). Full detail in
[CHARGING_SESSIONS.md](CHARGING_SESSIONS.md).

1. **Priority for charging SOC/energy/cost:**
   `fresh live SOC (≤90 s) > in-session telemetry > wall-clock math`.
   Math is a **display/persist fallback only** — never overwrite fresh live data with math.
2. **Never math-complete a session while fresh live SOC exists.** Completion must wait for
   live SOC so the 100% cell-voltage tail is captured.
3. **The PWA is the only per-second writer of `charging_sessions`.** If the row looks frozen
   but `bydmate_telemetry_samples` is current, the user closed the PWA — not an ingest bug.
4. **Charging energy/cost = `SOC_delta% × battery_capacity_kwh ÷ 100 ÷ efficiency`.**
   Capacity is **per-car/per-user**, never hardcoded; efficiency is **per tariff** (typically
   ~98% AC and ~90% fast DC), not per car. The BMS counter `kwh_charged` measures
   **battery-cell energy only** (~47 % low vs the grid because of thermal management draw) and
   must **not** drive cost — keep it for diagnostics only. See
   [CHARGING_SESSIONS.md §Charging energy & cost](CHARGING_SESSIONS.md).
5. **Auto-detect charging from `charge_power_kw`, never traction `power_kw`** (the 2026-06-03
   phantom-session root cause).
6. **`vehicle_id` is a soft text key**, matched `cars.vehicle_alias` → telemetry/trip
   `vehicle_id` by string equality. There is no database foreign key yet.
   History/session APIs must resolve the alias from the car/session — never use a fixed
   vehicle value in production paths.
7. **RLS scopes every user table by `auth.uid()`.** The service role key is server-only.
8. **Ownership is explicit.** Telemetry, tracks, trip/charge facts, command state and
   server rollups are user-owned data in Postgres. Mate's Room queue, imported local
   history and daemon files are device-local delivery/operational caches, never the only
   source of a user's cloud history. User preferences keep their existing client-side
   ownership unless a feature explicitly chooses otherwise.

---

## 5. Subsystems at a glance

| Subsystem | What it does | Canonical doc | Key code |
| --- | --- | --- | --- |
| **Telemetry ingest** | Validate + persist car data; trigger sessions, widgets and notifications; accept retries/offline batches | [supabase/TELEMETRY.md](../supabase/TELEMETRY.md), [supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | `src/app/api/bydmate/telemetry/route.ts`, `src/lib/bydmate/*` |
| **Charging sessions** | Start/stop, ~1 Hz progress, auto sessions, reconcile, tariffs | [CHARGING_SESSIONS.md](CHARGING_SESSIONS.md) | `src/lib/charging-*`, `src/lib/bydmate/charging-auto-session*` |
| **Trips** | Server-side trip inference, junk filtering, distance deltas, GPS tracks | [TRIPS.md](TRIPS.md) | `bydmate_ingest_telemetry` (SQL), `src/lib/bydmate/trip-*` |
| **Analytics & charts** | History→Analytics, trip charts, route maps, route insights | [TRIPS.md](TRIPS.md) | `src/components/vehicle/*`, `src/lib/bydmate/telemetry-*` |
| **Notifications** | Web push (charge thresholds) + Telegram vehicle-state events | [VEHICLE_STATE_NOTIFICATIONS.md](VEHICLE_STATE_NOTIFICATIONS.md) | `src/lib/push/*`, `src/lib/telegram/*` |
| **Remote commands** | Abstract commands PWA → Mate poller or car-off shell daemon (lock, set SOC limit, …) | [supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | `src/app/api/bydmate/commands/*`, `vehicle_commands` |
| **Premium & retention** | Entitlements, tiered telemetry retention, admin tools | [PREMIUM_ADMIN.md](PREMIUM_ADMIN.md) | `is_user_premium()`, `purge_old_bydmate_telemetry_by_tier()` |
| **Knowledge base** | Content CMS, search, and service catalog | README §Features | `src/app/telegram/*` |
| **Database** | Tables, RLS, RPCs, enums, storage buckets | [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | `supabase/migrations/` |
| **PWA / shell** | Install, service worker, mobile nav, i18n (en/be/ru) | [INSTALL.md](../INSTALL.md), README §PWA | `src/app/manifest.ts`, `src/components/layout/*` |

---

## 6. Documentation map

### Living reference (current truth — keep updated)

| Doc | Scope |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **This file** — overview, data flow, invariants, doc map |
| [ARCHITECTURE.ru.md](ARCHITECTURE.ru.md) | Full Russian architecture reference; English remains canonical for implementation |
| [../README.md](../README.md) | Product surface, setup, scripts, project structure |
| [../INSTALL.md](../INSTALL.md) | User-facing PWA install guide (RU) |
| [CHARGING_SESSIONS.md](CHARGING_SESSIONS.md) | Charging sync, auto sessions, reconcile, tariffs, energy/cost |
| [TRIPS.md](TRIPS.md) | Trip lifecycle, junk filtering, distance deltas |
| [VEHICLE_STATE_NOTIFICATIONS.md](VEHICLE_STATE_NOTIFICATIONS.md) | Telegram connect/park/disconnect events |
| [PREMIUM_ADMIN.md](PREMIUM_ADMIN.md) | Entitlements, retention tiers, admin runbook |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Full schema, RLS, RPCs, enums, storage |
| [../supabase/TELEMETRY.md](../supabase/TELEMETRY.md) | Telemetry storage model, retention, Di+ fields, analytics APIs |
| [../supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | APK ingest + command contract (handoff to the Mate repo) |

### Process / status

| Doc | Scope |
| --- | --- |
| [PRODUCT_STATUS.md](PRODUCT_STATUS.md) | Plain-language capabilities + improvement roadmap |

---

## 7. Conventions every contributor must know

- **This is Next.js 16** — treat it as version-specific. Read the relevant guide in
  `node_modules/next/dist/docs/` before changing routing, server actions, metadata,
  middleware, caching, or file conventions.
- **Migrations are append-only and idempotent.** Never edit an applied migration; add a
  new, guarded migration instead.
- **Tests** use Node's built-in runner with `--experimental-strip-types` (no Jest/Vitest).
  Tested `src/lib` modules must use **relative** `.ts` imports, not `@/` aliases.
  `npm run test` runs `src/**/*.test.mjs`; `charging-auto-session.test.mjs` is excluded
  from the glob and must be run explicitly.
- **When behavior changes, update the matching doc** (see §6) and add/adjust tests for
  parser logic, charging completion, trip filtering, telemetry history, or push thresholds.
