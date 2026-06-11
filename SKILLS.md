# VoltFlow Skills and Change Workflow

This document captures the project-specific skills needed to continue VoltFlow safely. Use it together with [AGENTS.md](AGENTS.md), [README.md](README.md), and the Supabase docs in [supabase/](supabase/).

## Goal

The current priority is to fix and preserve the existing progress, then add new features without breaking working behavior.

In practice:

- First understand the current route, component, data, and migration shape.
- Fix regressions with the smallest reasonable change.
- Add new features behind the existing architecture instead of replacing working flows.
- Keep charging, VoltFlow Mate, PWA, auth, and knowledge-base behavior stable unless the task explicitly targets them.
- Add or update tests when changing parser logic, charging completion, trip filtering, telemetry history, push thresholds, or shared utilities.

## Required Agent Skill

Before changing application code, read [AGENTS.md](AGENTS.md). It contains two hard project rules:

- This project uses Next.js 16. Do not rely on older Next.js assumptions. Read the relevant guide under `node_modules/next/dist/docs/` before editing framework-sensitive areas such as routing, layouts, server actions, metadata, middleware/proxy behavior, caching, or file conventions.
- VoltFlow Mate charging history must preserve delayed completion samples. A chart stopping below the session target does not automatically mean data is missing.

## Core Project Skills

### Charging Skill

Full architecture, 2026-06 incident notes, cleanup script, and tests: **[docs/CHARGING_SESSIONS.md](docs/CHARGING_SESSIONS.md)**.

Know these files before changing charging behavior:

- `src/lib/charging-math.ts`
- `src/lib/charging-live.ts`
- `src/lib/charging-session-sync.ts` — `deriveChargingSessionLiveBundle`, fresh-vs-math persist rules
- `src/lib/bydmate/charging-auto-session.ts` — Mate ingest auto start/stop of `charging_sessions`
- `src/lib/bydmate/telemetry-charging.ts` — `isMateAutoSessionCharging` (never traction `power_kw`)
- `src/lib/charging-session-reconcile.ts` — post-ingest / sessions-list repair of bad rows
- `src/lib/charging-session-vehicle.ts` — `resolveChargingSessionVehicleId` for history delta charts (no global `"way"` default)
- `src/hooks/use-charging-session-live-sync.ts` — ~1s DB persist + auto-complete
- `src/components/charging/charging-session-background-sync.tsx` — mounted from `MobileShell`
- `src/actions/sessions.ts` — manual stop uses `resolveStopProgressForSession` (live → telemetry → math)
- `src/lib/charging-session-finalize.ts`
- `src/lib/charging-session-reconcile.ts` — repairs bad session rows from Mate telemetry/live after ingest and on sessions list load
- `src/components/charging/charging-session-screen.tsx`
- `src/components/charging/charging-hub-view.tsx`
- `src/components/dashboard/dashboard-view.tsx`
- `src/app/(app)/charging/page.tsx`
- `src/app/(app)/charging/[id]/page.tsx`
- `src/app/(app)/history/page.tsx`
- `src/app/(app)/history/[id]/page.tsx`

Preserve these behaviors:

- Wall-clock math can calculate current display state, delivered kWh, cost, ETA, and remaining time.
- Persisted session data keeps refreshes and PWA restores consistent.
- While `status = 'charging'`, `ChargingSessionBackgroundSync` persists `current_percent` / energy / cost to Postgres from any authenticated route (not only `/charging/[id]`). Mate ingest can create/stop sessions but does not stream per-second progress.
- `processBydmateAutoChargingSessions` in `src/app/api/bydmate/telemetry/route.ts` starts a session after two consecutive charging samples for `cars.vehicle_alias`, using live SOC and `charge_power_kw`, and stops on unplug or drive-away.
- `deriveChargingSessionLiveBundle` prefers fresh Mate snapshots (`received_at` within 90s), uses math for persist when Mate is offline, and scopes live rows by `vehicle_alias` when the car has one.
- `ChargingSessionScreen` drives UI via `onDerived` with `skipPersist: true` so background sync remains the single writer.
- Supabase Realtime on `charging_sessions` keeps open screens in sync after writes.
- If fresh VoltFlow Mate live SOC exists, session completion must wait for fresh live SOC and must not be forced by mathematical time estimates.
- Auto-complete must be blocked when fresh live data shows driving (`speed_kmh > 5`) or not-charging state.
- When driving is detected during an active charging session, prefer closing as `stopped` with live-derived percent/energy/cost.
- When fresh live SOC reappears after offline math fallback, reconcile persisted progress toward live SOC when drift is material.

When debugging history:

- Compare `charging_sessions.started_at`, `charging_sessions.stopped_at`, `charging_sessions.current_percent`, and `charging_sessions.target_percent`.
- Compare them with `bydmate_telemetry_samples.device_time` and delayed samples around the stop time.
- If `current_percent` lags telemetry but samples are current, the PWA was likely closed — not a Mate ingest bug.
- If Delta by SOC shows `0 pts` but telemetry exists, check API `vehicleId` in the samples response: it must match `cars.vehicle_alias`, not dev default `"way"`.
- Check whether VoltFlow Mate reports target SOC a few minutes after VoltFlow marks the session `completed`.
- Preserve samples that contain the 100% SOC and cell-voltage tail.
- False `completed` at 100% with drive-away below target: check in-session `speed_kmh > 5` and max SOC vs target; server auto-stop needs deployed ingest + `bydmate_auto_charging_session_state`; inspect ingest JSON `auto_charging_sessions.error`.

### VoltFlow Mate Ingest Skill

Know these files before changing VoltFlow Mate ingest or history:

- `src/app/api/bydmate/telemetry/route.ts` (ingest + charge notifications + auto charging sessions)
- `src/lib/bydmate/ingest-payload.ts`
- `src/lib/bydmate/telemetry-sanitizer.ts`
- `src/lib/bydmate/telemetry-history.ts`
- `src/lib/bydmate/telemetry-session-window.ts`
- `src/lib/bydmate/telemetry-ranges.ts`
- `src/lib/bydmate/trip-filter.ts`
- `src/lib/bydmate/trip-energy.ts`
- `src/lib/bydmate/range-estimate.ts`
- `src/app/api/vehicle/trips/route.ts`
- `src/app/api/vehicle/trips/[tripId]/samples/route.ts`
- `src/app/api/vehicle/trips/[tripId]/track/route.ts`
- `src/hooks/use-bydmate-trips-query.ts`
- `src/hooks/use-bydmate-trip-samples-query.ts`
- `src/hooks/use-bydmate-trip-track-query.ts`
- `supabase/TELEMETRY.md`
- `supabase/BYDMATE_APK_API.md`

Preserve these behaviors:

- Accept single sample payloads, `{ "samples": [...] }`, and direct JSON arrays.
- Accept `diplus: null` and store normalized Di+ safely.
- Accept numeric JSON values and numeric strings.
- Cap batch payloads at 300 samples.
- Keep `(user_id, vehicle_id, device_time)` idempotency.
- Store charging samples in telemetry history but do not create or extend driving trips from charging samples.
- Drop suspicious GPS track points before persistence.

Run focused tests after changes:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/ingest-payload.test.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/telemetry-sanitizer.test.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/telemetry-history.test.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/trip-filter.test.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/trip-energy.test.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/range-estimate.test.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/charging-auto-session.test.mjs
```

### Vehicle Analytics Skill

Know these files before changing History analytics, trip charts, or route maps:

- `src/components/history/history-view.tsx` — History tabs including `?tab=analytics`; trips calendar uses `?month=` dates query
- `src/components/vehicle/vehicle-analytics-panels.tsx` — analytics host (range/anchor picker, KPIs, SoH trend, charging-trend bars, export); also defines `AnalyticsRangeAnchorPicker`
- `src/components/vehicle/analytics-day-view.tsx` — single-day analytics view (line charts)
- `src/components/vehicle/vehicle-live-view.tsx` — `TelemetryHistoryCharts`, `RouteMap` (`headingMode` for dynamic title/point display), `RouteMapPreview`, `LocationCard` (last-trip route map, not a single GPS pin), trip chart prep, route map layers and hover
- `src/components/vehicle/chart-interaction.tsx` — fullscreen crosshair + tooltip helpers shared by line/bar charts
- `src/components/vehicle/telemetry-analytics-charts.tsx` — summary stats, bar charts, loading states, fullscreen bar hover
- `src/hooks/use-bydmate-soh-history-query.ts` — SoH trend query (calls the dedicated SoH endpoint, not hourly rollups)
- `src/app/api/vehicle/telemetry/soh/route.ts` + `fetchSohTelemetryHistory` in `telemetry-history.ts` — probe one raw sample per calendar day for `soh_percent`
- `docs/CHART_OPTIMIZATION_SPEC.md` — chart phasing/spec for the analytics charts
- `src/components/vehicle/route-insights-section.tsx` — route cards, rename, park, map preview
- `src/components/vehicle/vehicle-analytics-teaser.tsx` — Vehicle page link to History analytics
- `src/lib/bydmate/telemetry-buckets.ts` — daily/weekly aggregation and period summary
- `src/lib/bydmate/route-insights.ts` — GPS fingerprint clustering, park filter, API helpers
- `src/lib/bydmate/trip-energy.ts` — regen/traction integration and regen recovery bar segments
- `src/lib/bydmate/telemetry-sanitizer.ts` — `filterDisplayTripTrackPoints()` for map read path
- `src/lib/vehicle-analytics.ts` — monthly, phantom, cost-per-km queries
- `src/app/api/vehicle/analytics/route.ts`
- `src/app/api/vehicle/route-labels/route.ts`
- `src/app/api/vehicle/trips/route.ts` — optional `month=` for calendar dates

Preserve these behaviors:

- Analytics primary UI lives under **History → Analytics**, not inline on the Vehicle page (teaser only).
- Default range is **day/today** — `parseAnalyticsRange()` in `telemetry-ranges.ts` and the `VehicleAnalyticsPanels` `useState` initializers must fall back to `"day"` (not `"week"`), and `anchorDate` must default to today. Opening `/history?tab=analytics` with no params shows today, and switching week→day must anchor to today, not the week's Monday.
- `AnalyticsRangeAnchorPicker` must not use native `week`/`month` `<input>` types — iOS Safari does not support them. Use the custom picker UI instead.
- SoH trend reads **raw samples** via the dedicated `/api/vehicle/telemetry/soh` endpoint; `bydmate_telemetry_hourly` rollups omit `soh_percent`, so do not source the SoH chart from `useBydmateTelemetryHistoryQuery`.
- Charging-trend bars are sorted **ascending (oldest → left)**.
- Week+ ranges use client-side daily/weekly bucket aggregation and bar charts; day range keeps line charts.
- Period summary waits for both telemetry history and period-trips queries before rendering KPIs.
- Route insights exclude parked fingerprints and routes with fewer than three trips from the main list.
- Trip charts: Speed & power on one dual-axis card; regen as distance/time bar chart, not cumulative line.
- Route map zoom anchors to **viewport center** after pan; OSM zoom limits only (z2–z19).
- Chart hover tooltips and crosshair are **fullscreen dialog only** — do not add heavy hover to compact card previews without an explicit UX request.
- When fresh VoltFlow Mate live SOC exists, do not auto-complete charging sessions from math (see Charging Skill). Session row persist is client-side via `ChargingSessionBackgroundSync`.

The full project test command is:

```bash
npm run test
```

Charging auto-session tests are not in the default glob; run explicitly after ingest/session changes:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/charging-auto-session.test.mjs
```

### Build Skill

- Root `npm run build` type-checks the main VoltFlow app only; `screenshots/` is excluded in `tsconfig.json` (separate Next project for App Store capture).
- After charging or finalize changes, run `npm run build` before deploy — TypeScript must pass on `charging-session-finalize.ts`, `charging-session-sync.ts`, and related hooks.

### Supabase Skill

Know these files before changing database shape:

- `supabase/migrations/`
- `supabase/MIGRATIONS_AUDIT.md`
- `scripts/supabase-migrate-one.mjs`
- `src/types/database.ts`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/service.ts`
- `src/lib/supabase/admin.ts`

Preserve these behaviors:

- RLS must continue scoping user data by `auth.uid()`.
- `SUPABASE_SERVICE_ROLE_KEY` must stay server-only.
- Existing migrations remain active history until a deliberate squash/reset plan exists.
- Do not delete old migration files from `supabase/migrations/` just because later migrations supersede their function bodies.

Use the wrapper for controlled migration work:

```bash
npm run db:migrations:status
npm run db:migrations:plan
npm run db:migrations:up
npm run db:migrations:down
```

### Knowledge Base and Telegram Skill

Know these files before changing Telegram or knowledge behavior:

- `src/app/telegram/page.tsx`
- `src/app/telegram/article/[slug]/page.tsx`
- `src/app/telegram/category/[slug]/page.tsx`
- `src/app/admin/knowledge/`
- `src/components/telegram/`
- `src/components/admin/knowledge/`
- `src/data/telegram/`
- `src/lib/telegram/`
- `src/lib/knowledge-search.ts`
- `src/lib/embeddings.ts`
- `src/app/api/knowledge/search/route.ts`

Preserve these behaviors:

- Static fallback content should keep the Telegram experience usable even when CMS or semantic search is unavailable.
- Admin CMS changes should not break public article/category routes.
- Semantic search requires `OPENAI_API_KEY`; without it, the rest of the knowledge experience should still work.
- Generation filters must stay compatible with model/generation metadata in knowledge content.

### PWA and Mobile UX Skill

Know these files before changing install or shell behavior:

- `src/app/manifest.ts`
- `public/sw.js`
- `src/components/sw-register.tsx`
- `src/components/layout/MobileShell.tsx`
- `src/components/layout/BottomNavigation.tsx`
- `INSTALL.md`

Preserve these behaviors:

- Service worker registration is production-only.
- Start URL is `/telegram`.
- Mobile safe areas and bottom navigation must remain touch-friendly.
- iPhone/iPad install instructions expect Safari; Android install instructions expect Chrome.

### Push Notification Skill

Know these files before changing notification behavior:

- `src/lib/push/charge-thresholds.ts`
- `src/lib/push/charge-notifications.ts`
- `src/lib/push/client.ts`
- `src/lib/push/web-push.ts`
- `src/actions/push.ts`
- `src/app/api/push/vapid-public-key/route.ts`

Preserve these behaviors:

- Push requires VAPID environment variables.
- Browser subscription logic must tolerate unsupported browsers.
- Charge-threshold behavior should stay covered by tests.

Run:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/push/charge-thresholds.test.mjs
```

## Git branches for new work

After the 2026-06 charging-session work, **use a new branch per feature or fix** (not more drive-by changes on the same large branch):

```bash
git checkout main && git pull
git checkout -b feature/my-feature
```

Open a PR for review before merging. Charging/ingest behavior is documented in [docs/CHARGING_SESSIONS.md](docs/CHARGING_SESSIONS.md) — update that file when those rules change.

## Safe Feature Workflow

Use this sequence for new features:

1. Identify the existing owner area: route, component, lib module, action, migration, or API route.
2. Read nearby code and docs before changing anything.
3. Keep the feature scoped to the smallest existing boundary that can own it.
4. Preserve current data contracts unless a migration and compatibility plan are included.
5. Add tests for shared logic, parser behavior, completion rules, or database-sensitive code.
6. Run `npm run test` for logic changes and `npm run lint` for code-style and Next.js checks.
7. For PWA/install changes, verify with `npm run build` and `npm run start`.
8. Update docs when behavior, routes, env vars, migrations, or ingest contracts change.

## Current Feature Surface to Keep Untouched

Do not accidentally regress:

- Auth pages and callback flow.
- Vehicle creation/editing.
- Active charging start/stop flow (manual, PWA background sync, Mate ingest auto start/stop).
- Charging progress, ETA, kWh, cost, and tariff calculations.
- Charging history list and detail.
- VoltFlow Mate cloud ingest compatibility with the current Android APK.
- Delayed VoltFlow Mate completion sample preservation.
- Trip inference excluding charging samples.
- Trip API endpoints returning list, samples, and GPS track for each trip.
- History analytics tab, period summary KPIs, route insights clustering, route label persistence, trip charts (speed/power merge, regen bars), route map layers/hover, and fullscreen chart hover tooltips.
- Telegram knowledge home, categories, articles, FAQ, calculators, accessories, and spare parts.
- Admin knowledge CMS forms.
- Semantic search fallback behavior.
- PWA manifest, production service worker, and install docs.
- Push subscription and VAPID public-key endpoint.
- Dev diagnostic pages.

## Documentation Maintenance

When the project changes, update the relevant document:

- `README.md` for product surface, setup, scripts, project structure, and current progress.
- `AGENTS.md` for hard agent rules and project invariants.
- `SKILLS.md` for safe workflow, ownership map, and project-specific development skills.
- `INSTALL.md` for user-facing PWA installation.
- `supabase/TELEMETRY.md` for telemetry schema/storage behavior.
- `supabase/BYDMATE_APK_API.md` for APK ingest contract changes.
- `supabase/MIGRATIONS_AUDIT.md` for migration-chain and squash/reset notes.
- `docs/CHARGING_SESSIONS.md` for charging sync, Mate auto sessions, reconcile, and ops scripts.
- `docs/CHART_OPTIMIZATION_SPEC.md` for the analytics/trip chart phasing, ranges, and chart-type rules.
