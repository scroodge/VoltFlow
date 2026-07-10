# VoltFlow Change Map and Verification Guide

Use this file with [AGENTS.md](AGENTS.md) and the documentation map in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It identifies the code that owns each
area and the checks to run after an approved change; it is **not** the source of truth
for detailed, mutable domain behavior.

## Start every change here

1. Follow the change gate in [AGENTS.md](AGENTS.md): research, write the proposed
   plan in `BACKLOG.md`, ask **“Should I build this?”**, then wait for approval.
   Read-only reviews do not edit files.
2. Recall relevant Agentmemory context. If it is unavailable, continue from the
   repository docs and source; do not block on it.
3. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), then the canonical doc for the
   subsystem you will touch.
4. For Next.js routing, layouts, server actions, metadata, proxy/middleware, caching,
   or file conventions, read the relevant guide in `node_modules/next/dist/docs/`
   before editing.
5. Read the owning code and its nearby tests before deciding the change boundary.

### Authority order

`AGENTS.md` governs workflow and durable safeguards. The canonical domain docs govern
detailed behavior. Source code and focused tests settle undocumented or suspected-drift
facts. This file provides maps and verification only; never use a summary here to
override `docs/CHARGING_SESSIONS.md`, `docs/TRIPS.md`, or a Supabase contract doc.

## Shared change rules

- Prefer the smallest owner boundary: route, component, hook, library module, action,
  API route, or migration.
- Preserve existing data contracts unless the approved plan contains a migration and
  compatibility path.
- Keep RLS scoped by `auth.uid()` and keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Do not edit applied migrations or delete migration history. Follow the one-at-a-time
  workflow in `AGENTS.md` and [supabase/MIGRATIONS_AUDIT.md](supabase/MIGRATIONS_AUDIT.md).
- Add or update focused tests for shared logic, parsing, charging completion, trip
  filtering, telemetry history, push thresholds, or database-sensitive behavior.
- Update the canonical behavior doc when the behavior or contract changes; move the
  approved plan from `BACKLOG.md` to `CHANGELOG.md` when it ships.

## Charging sessions

**Canonical behavior:** [docs/CHARGING_SESSIONS.md](docs/CHARGING_SESSIONS.md).
Read it before touching session state, auto start/stop, reconciliation, energy/cost,
or charging history. It owns dynamic thresholds and incident rules; consult source and
tests rather than copying those values into this file.

| Concern | Owner files |
| --- | --- |
| Live calculation and source priority | `src/lib/charging-math.ts`, `src/lib/charging-live.ts`, `src/lib/charging-session-sync.ts` |
| Mate auto start/stop | `src/lib/bydmate/charging-auto-session.ts`, `src/lib/bydmate/charging-auto-session-step.ts`, `src/lib/bydmate/telemetry-charging.ts` |
| Session repairs and vehicle resolution | `src/lib/charging-session-reconcile.ts`, `src/lib/charging-session-reconcile-logic.ts`, `src/lib/charging-session-vehicle.ts` |
| PWA persistence and manual stop | `src/hooks/use-charging-session-live-sync.ts`, `src/components/charging/charging-session-background-sync.tsx`, `src/actions/sessions.ts`, `src/lib/charging-session-finalize.ts` |
| Charging UI | `src/components/charging/charging-session-screen.tsx`, `src/components/charging/charging-hub-view.tsx`, `src/components/dashboard/dashboard-view.tsx`, `src/app/(app)/charging/` |
| Charging history | `src/app/(app)/history/`, `/api/vehicle/charging-sessions/[sessionId]/samples` |

Focused checks after a charging or ingest-session change:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test \
  src/lib/bydmate/telemetry-charging.test.mjs \
  src/lib/bydmate/charging-auto-session.test.mjs \
  src/lib/charging-session-reconcile.test.mjs
npm run build
```

## VoltFlow Mate telemetry and trips

**Canonical behavior:** [supabase/TELEMETRY.md](supabase/TELEMETRY.md),
[supabase/BYDMATE_APK_API.md](supabase/BYDMATE_APK_API.md), and
[docs/TRIPS.md](docs/TRIPS.md). Read `docs/TRIPS.md` before changing
`bydmate_ingest_telemetry` or `bydmate_discard_trip_if_junk`.

| Concern | Owner files |
| --- | --- |
| HTTP ingest and notifications | `src/app/api/bydmate/telemetry/route.ts` |
| Payload validation and normalization | `src/lib/bydmate/ingest-payload.ts`, `src/lib/bydmate/telemetry-sanitizer.ts` |
| History, windows, ranges | `src/lib/bydmate/telemetry-history.ts`, `src/lib/bydmate/telemetry-session-window.ts`, `src/lib/bydmate/telemetry-ranges.ts` |
| Trips and energy | `src/lib/bydmate/trip-filter.ts`, `src/lib/bydmate/trip-energy.ts`, `src/lib/bydmate/range-estimate.ts` |
| Trip APIs and queries | `src/app/api/vehicle/trips/`, `src/hooks/use-bydmate-trips-query.ts`, `src/hooks/use-bydmate-trip-samples-query.ts`, `src/hooks/use-bydmate-trip-track-query.ts` |

The ingest contract accepts a single sample, `{ "samples": [...] }`, or an array;
keeps `(user_id, vehicle_id, device_time)` idempotent; caps batches at 300; and stores
charging telemetry without extending driving trips. Treat the canonical docs and tests
as authoritative for validation and filtering details.

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test \
  src/lib/bydmate/ingest-payload.test.mjs \
  src/lib/bydmate/telemetry-sanitizer.test.mjs \
  src/lib/bydmate/telemetry-history.test.mjs \
  src/lib/bydmate/trip-filter.test.mjs \
  src/lib/bydmate/trip-energy.test.mjs \
  src/lib/bydmate/range-estimate.test.mjs
```

## Vehicle analytics and maps

**Canonical behavior:** [docs/CHART_OPTIMIZATION_SPEC.md](docs/CHART_OPTIMIZATION_SPEC.md).
Analytics lives under **History → Analytics**; do not move it into the Vehicle page
without an explicit product decision.

- `src/components/history/history-view.tsx`
- `src/components/vehicle/vehicle-analytics-panels.tsx`
- `src/components/vehicle/analytics-day-view.tsx`
- `src/components/vehicle/vehicle-live-view.tsx`
- `src/components/vehicle/chart-interaction.tsx`
- `src/components/vehicle/telemetry-analytics-charts.tsx`
- `src/hooks/use-bydmate-soh-history-query.ts`
- `src/app/api/vehicle/telemetry/soh/route.ts`
- `src/lib/bydmate/telemetry-buckets.ts`, `src/lib/bydmate/route-insights.ts`,
  `src/lib/bydmate/trip-energy.ts`, `src/lib/vehicle-analytics.ts`
- `src/components/vehicle/route-insights-section.tsx`,
  `src/components/vehicle/vehicle-analytics-teaser.tsx`,
  `src/app/api/vehicle/analytics/route.ts`, `src/app/api/vehicle/route-labels/route.ts`

Run `npm run test`; run `npm run build` for UI, route, or type-sensitive changes.

## Database and Supabase

**Canonical operations:** [supabase/MIGRATIONS_AUDIT.md](supabase/MIGRATIONS_AUDIT.md)
and the migration section of `AGENTS.md`.

- `supabase/migrations/`, `scripts/supabase-migrate-one.mjs`, `src/types/database.ts`
- `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`,
  `src/lib/supabase/service.ts`, `src/lib/supabase/admin.ts`

Use the migration wrapper for local work:

```bash
npm run db:migrations:status
npm run db:migrations:plan
npm run db:migrations:up
```

The self-hosted production pooler uses the `psql` recipe in local `docs/OPS_LOCAL.md`;
do not substitute a Supabase CLI command that forces TLS.

## Knowledge, Telegram, and PWA

| Area | Canonical guide / owner files | Preserve |
| --- | --- | --- |
| Knowledge and Telegram | `src/app/telegram/`, `src/app/admin/knowledge/`, `src/components/telegram/`, `src/components/admin/knowledge/`, `src/data/telegram/`, `src/lib/telegram/`, `src/lib/knowledge-search.ts`, `src/lib/embeddings.ts`, `src/app/api/knowledge/search/route.ts` | Static fallback works without CMS or semantic search; public routes survive CMS changes; semantic search is optional when `OPENAI_API_KEY` is absent. |
| PWA and mobile shell | [INSTALL.md](INSTALL.md), `src/app/manifest.ts`, `public/sw.js`, `src/components/sw-register.tsx`, `src/components/layout/MobileShell.tsx`, `src/components/layout/BottomNavigation.tsx` | Production-only service-worker registration, `/telegram` start URL, touch-safe areas/nav, Safari iOS and Chrome Android install guidance. |
| Push notifications | `src/lib/push/charge-thresholds.ts`, `src/lib/push/charge-notifications.ts`, `src/lib/push/client.ts`, `src/lib/push/web-push.ts`, `src/actions/push.ts`, `src/app/api/push/vapid-public-key/route.ts` | VAPID stays optional and unsupported browsers fail safely. |

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/push/charge-thresholds.test.mjs
```

## Verification and branches

| Change | Minimum verification |
| --- | --- |
| Shared logic, parsers, telemetry, trips, push | Focused tests, then `npm run test` when practical |
| Charging, finalization, or ingest sessions | Charging focused tests and `npm run build` |
| UI, routes, PWA, Next.js-sensitive work | `npm run lint` and `npm run build`; run the production server only when runtime verification is needed |
| Database schema / RPC | Focused tests plus the approved one-at-a-time migration procedure |
| Documentation-only | Validate links, paths, commands, and cited source behavior; no app build required |

For a new feature or fix, first inspect `git status --short`. Do not checkout, pull, or
create a branch over someone else's uncommitted work. With a clean working tree and an
approved branch workflow, use the repository's current default branch as the base, then
create one focused branch and open a PR before merging.

## Documentation ownership

- `docs/ARCHITECTURE.md` — system overview and doc map
- `AGENTS.md` — mandatory agent workflow, safeguards, commands, and test quirks
- `SKILLS.md` — this owner/verification map
- `docs/CHARGING_SESSIONS.md`, `docs/TRIPS.md`, `supabase/TELEMETRY.md`, and
  `supabase/BYDMATE_APK_API.md` — canonical behavior/contracts for their domains
- `README.md` — product surface, setup, scripts, and project structure
- `INSTALL.md` — user-facing PWA installation
- `BACKLOG.md` — proposed but unbuilt work; `CHANGELOG.md` — shipped work
