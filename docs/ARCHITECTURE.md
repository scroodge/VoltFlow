# VoltFlow — Architecture & Documentation Map

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
2. **Vehicle telemetry** — ingests ~1 Hz live data from VoltFlow Mate, stores it, and
   renders live status, trips, GPS tracks, and rich analytics.
3. **Knowledge base** — a Telegram-style CMS (guides, FAQ, accessories, spare parts)
   with semantic search.
4. **Service logbook** — maintenance records and reminders per car.

Auth, multi-tenancy, and realtime are all Supabase. Every user-scoped table is
protected by Row Level Security keyed on `auth.uid()`.

---

## 2. The big picture (data flow)

```
┌──────────────┐   1 Hz active / 5 min idle    ┌─────────────────────────────┐
│   The car    │   batched HTTP (≤15 samples,  │  POST /api/bydmate/telemetry │
│ (DiLink head │   15 s flush; ≤60 s while      │  (Next.js route handler)     │
│  unit)       │   charging below the tail)     │                             │
│              │ ─────────────────────────────▶ │  validate → persist →       │
│ VoltFlow     │   X-API-Key + X-Vehicle-Id     │  auto charging sessions →   │
│ Mate (APK)   │                                │  reconcile → notifications  │
└──────────────┘                                └──────────────┬──────────────┘
                                                               │ writes
                            ┌──────────────────────────────────┼────────────────────┐
                            ▼                  ▼                ▼                     ▼
                  bydmate_live_snapshots  bydmate_telemetry  bydmate_trips +    charging_sessions
                  (latest, 1 row/vehicle)   _samples (~1 Hz   _trip_track_points  (auto start/stop
                            │               append-only) +     (server trip        rows only)
                            │               _hourly rollups    inference)               │
              Supabase Realtime                  │                   │                   │
                            │                    │ charts/analytics  │ trip charts/maps  │ ~1 Hz progress
                            ▼                    ▼                   ▼            written by PWA
                  ┌─────────────────────────────────────────────────────────────────────────┐
                  │                       VoltFlow PWA (browser / installed)                  │
                  │  Live vehicle · Charging cockpit · History+Analytics · Trips · Knowledge  │
                  └─────────────────────────────────────────────────────────────────────────┘
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

---

## 3. The stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 App Router + React 19 |
| UI | Tailwind CSS 4, shadcn-style components, lucide-react |
| State & data | TanStack Query, Zustand |
| Forms & validation | React Hook Form, Zod |
| Backend | Supabase: Auth, Postgres, Realtime, RLS, Storage, pgvector, pg_cron |
| PWA | `manifest.ts`, production-only service worker, web push (VAPID) |
| Semantic search | OpenAI embeddings → pgvector (HNSW, cosine) |
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
4. **Charging energy/cost = `SOC_delta% × battery_capacity_kwh ÷ 100`, efficiency ≈ 100 %.**
   Capacity is **per-car/per-user**, never hardcoded. The BMS counter `kwh_charged` measures
   **battery-cell energy only** (~47 % low vs the grid because of thermal management draw) and
   must **not** drive cost — keep it for diagnostics only. See
   [CHARGING_SESSIONS.md §Charging energy & cost](CHARGING_SESSIONS.md).
5. **Auto-detect charging from `charge_power_kw`, never traction `power_kw`** (the 2026-06-03
   phantom-session root cause).
6. **`vehicle_id` is a soft text key**, matched `cars.vehicle_alias` → telemetry/trip
   `vehicle_id` by string equality. There is no FK yet (see [BACKLOG.md](../BACKLOG.md)).
   History/session APIs must resolve the alias from the car/session — never default to the
   dev value `"way"` in production paths.
7. **RLS scopes every user table by `auth.uid()`.** The service role key is server-only.

---

## 5. Subsystems at a glance

| Subsystem | What it does | Canonical doc | Key code |
| --- | --- | --- | --- |
| **Telemetry ingest** | Validate + persist car data; trigger sessions/reconcile/notifications | [supabase/TELEMETRY.md](../supabase/TELEMETRY.md), [supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | `src/app/api/bydmate/telemetry/route.ts`, `src/lib/bydmate/*` |
| **Charging sessions** | Start/stop, ~1 Hz progress, auto sessions, reconcile, tariffs | [CHARGING_SESSIONS.md](CHARGING_SESSIONS.md) | `src/lib/charging-*`, `src/lib/bydmate/charging-auto-session*` |
| **Trips** | Server-side trip inference, junk filtering, distance deltas, GPS tracks | [TRIPS.md](TRIPS.md) | `bydmate_ingest_telemetry` (SQL), `src/lib/bydmate/trip-*` |
| **Analytics & charts** | History→Analytics, trip charts, route maps, route insights | [CHART_OPTIMIZATION_SPEC.md](CHART_OPTIMIZATION_SPEC.md) | `src/components/vehicle/*`, `src/lib/bydmate/telemetry-*` |
| **Notifications** | Web push (charge thresholds) + Telegram vehicle-state events | [VEHICLE_STATE_NOTIFICATIONS.md](VEHICLE_STATE_NOTIFICATIONS.md) | `src/lib/push/*`, `src/lib/telegram/*` |
| **Remote commands** | Abstract commands PWA → car via Mate poller (lock, set SOC limit, …) | [supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | `src/app/api/bydmate/commands/*`, `vehicle_commands` |
| **Premium & retention** | Entitlements, tiered telemetry retention, admin tools | [PREMIUM_ADMIN.md](PREMIUM_ADMIN.md) | `is_user_premium()`, `purge_old_bydmate_telemetry_by_tier()` |
| **Knowledge base** | Telegram-style CMS + semantic search + service catalog | README §Knowledge, [SKILLS.md](../SKILLS.md) | `src/app/telegram/*`, `src/lib/knowledge-search.ts` |
| **Database** | Tables, RLS, RPCs, enums, storage buckets | [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | `supabase/migrations/` |
| **PWA / shell** | Install, service worker, mobile nav, i18n (en/be/ru) | [INSTALL.md](../INSTALL.md), README §PWA | `src/app/manifest.ts`, `src/components/layout/*` |

---

## 6. Documentation map

### Living reference (current truth — keep updated)

| Doc | Scope |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **This file** — overview, data flow, invariants, doc map |
| [../README.md](../README.md) | Product surface, setup, scripts, project structure |
| [../AGENTS.md](../AGENTS.md) | Hard rules & invariants for AI/coding agents |
| [../SKILLS.md](../SKILLS.md) | Per-area file maps + safe-change workflow |
| [../INSTALL.md](../INSTALL.md) | User-facing PWA install guide (RU) |
| [CHARGING_SESSIONS.md](CHARGING_SESSIONS.md) | Charging sync, auto sessions, reconcile, tariffs, energy/cost |
| [TRIPS.md](TRIPS.md) | Trip lifecycle, junk filtering, distance deltas |
| [CHART_OPTIMIZATION_SPEC.md](CHART_OPTIMIZATION_SPEC.md) | Analytics/trip chart spec & phasing |
| [VEHICLE_STATE_NOTIFICATIONS.md](VEHICLE_STATE_NOTIFICATIONS.md) | Telegram connect/park/disconnect events |
| [PREMIUM_ADMIN.md](PREMIUM_ADMIN.md) | Entitlements, retention tiers, admin runbook |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Full schema, RLS, RPCs, enums, storage |
| `GROWTH_MARKETING.md` | Ongoing growth/marketing strategy — **local only** (not in public repo) |
| `OPS_LOCAL.md` | Infra recipe (hosts, pooler, project ref) — **local only** |
| [../supabase/TELEMETRY.md](../supabase/TELEMETRY.md) | Telemetry storage model, retention, Di+ fields, analytics APIs |
| [../supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | APK ingest + command contract (handoff to the Mate repo) |
| [../supabase/MIGRATIONS_AUDIT.md](../supabase/MIGRATIONS_AUDIT.md) | Migration chain audit + one-at-a-time workflow |

### Process / status

| Doc | Scope |
| --- | --- |
| [PRODUCT_STATUS.md](PRODUCT_STATUS.md) | Plain-language capabilities + improvement roadmap |
| [../CHANGELOG.md](../CHANGELOG.md) | Shipped initiatives & notable fixes (built work log) |
| [../BACKLOG.md](../BACKLOG.md) | Proposed-but-unbuilt plans awaiting go-ahead |
| `docs/PLAN_A_PARTITION_DRAFT.sql` | Annotated draft for the (unbuilt) partitioning plan — **local only** |
| `docs/archive/` | Finished/superseded plans (egress, hosting, phase-0, telegram) — **local only** |

---

## 7. Conventions every contributor must know

- **This is Next.js 16** — treat it as version-specific. Read the relevant guide in
  `node_modules/next/dist/docs/` before changing routing, server actions, metadata,
  middleware, caching, or file conventions.
- **Migrations are append-only and idempotent.** Never edit an applied migration
  (`supabase db push` skips it). Self-hosted prod has no `schema_migrations` table, so
  every migration must be `IF NOT EXISTS`-guarded — the repo file is the only history.
  Apply on self-hosted prod with `psql -f` (the Supabase CLI can't reach the no-TLS
  pooler). See [../supabase/MIGRATIONS_AUDIT.md](../supabase/MIGRATIONS_AUDIT.md).
- **Tests** use Node's built-in runner with `--experimental-strip-types` (no Jest/Vitest).
  Tested `src/lib` modules must use **relative** `.ts` imports, not `@/` aliases.
  `npm run test` runs `src/**/*.test.mjs`; `charging-auto-session.test.mjs` is excluded
  from the glob and must be run explicitly.
- **A local pre-commit hook bumps the patch version** on every commit (`.git/hooks/`,
  not committed). See README §Automatic Version Bump.
- **When behavior changes, update the matching doc** (see §6) and add/adjust tests for
  parser logic, charging completion, trip filtering, telemetry history, or push thresholds.
