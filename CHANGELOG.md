# Changelog — shipped initiatives & notable fixes

A running log of completed work that was previously tracked as "plans". Newest first.
For unbuilt proposals see [BACKLOG.md](BACKLOG.md); for current behavior see the
[docs/](docs/ARCHITECTURE.md) reference set.

> Dates are when the work landed in the working tree. "Built" here means code +
> tests + (where applicable) migrations applied to prod, as recorded at the time.

---

## 2026-07-11

### Persist the onboarding car-generation choice

- Independent gap found while investigating the distance bug: the onboarding
  "2025+ / 2024" toggle only switched which Mate install steps were displayed and was
  never saved, and the car form defaults new cars to `gen1_2024`. A gen2 owner who
  answers the toggle correctly could still end up with a `gen1_2024` row. (Cl's own
  car is correctly `gen1_2024`, so his label was never the distance-bug cause — that
  fix keys on energydata presence, not generation — but the field still drives
  charger presets and knowledge-base filtering, so it should reflect reality.)
- The toggle answer is now committed on onboarding exits (Next → link step, Skip):
  stored in app preferences (`onboardingCarGeneration`, validated by
  `isCarGeneration` on parse/merge) and written to any existing car rows via the new
  `setUserCarGeneration` server action (RLS-scoped). The connected-screen "Enter"
  intentionally does not persist — an already-linked account revisiting /onboarding
  never sees the toggle, and writing its untouched default would clobber a
  deliberate setting.
- `CarForm` (create mode) now seeds its generation default from the persisted
  onboarding choice, falling back to the historical `gen1_2024`.
- Verification: `npm run test` 102/102, ESLint clean on all five touched files,
  `npm run build` passes.

### Fix "distance since charge" double-counting energydata trip twins

- User Cl's live view showed 198.2 km "driven since charge" — impossible for a 50%
  SOC drop at 2.1 km/%. Prod DB confirmed: since the last finished charge
  (2026-07-03), 18 `telemetry` trips (114.7 km) each had a near-identical
  `byd_energydata` cloud-summary twin (11 rows, 83.5 km) from the Mate v0.4.7
  trip-summary sync, and `sumDistanceSinceCharge` summed both: 114.7 + 83.5 = 198.2.
- New `dedupeTripsBySource(trips)` in `src/lib/bydmate/hero-drive-metrics.ts`: an
  energydata row is dropped when a telemetry trip overlaps it in time (±5 min
  tolerance); energydata rows with no telemetry twin are kept (daemon was offline).
  `computeHeroDriveMetrics` dedupes before summing and picks the latest trip from the
  deduped list, so km/1% prefers the SOC-bearing telemetry row.
- Keys purely on the presence of `byd_energydata` rows, **not** on
  `cars.model_generation`. Cl's car is genuinely `gen1_2024` (DiLink 3) yet still
  syncs energydata summaries — energydata capability tracks firmware, not model
  generation — so gating on generation would have wrongly skipped exactly the user
  who reported the bug. (An earlier iteration gated on `gen2_2025`; that parameter
  was proven dead — with no energydata rows there is nothing to drop regardless of
  generation — and removed.)
- Verified against Cl's prod data with equivalent SQL: dedupe yields 18 trips /
  114.7 km, matching the SOC sanity check (~105–115 km).
- Also repaired a stale assertion in `hero-drive-metrics.test.mjs`
  (`formatKmPerPercent` no longer embeds the "km/1%" unit — it lives in the label).
- Verification: focused tests 9/9, `npm run test` 102/102, targeted ESLint clean
  (file-level errors pre-exist unchanged), `npm run build` passes.

## 2026-07-10

### Repair analytics correctness and database query fan-out

- Phantom drain no longer consumes a silently capped 1,000-row raw response. New
  `bydmate_phantom_drain_daily` aggregates the full selected range in Postgres and
  treats Di+ gun state `1` as unplugged before a stale `is_charging` fallback.
- The year SoH chart now receives one valid latest sample per UTC day from
  `bydmate_soh_daily` (with a partial SoH index), instead of up to 366 raw queries.
- Route insights now fetch bounded track and temperature inputs for all visible trips
  with one `bydmate_route_insight_inputs` call, removing the serial per-trip N+1
  waterfall. All three callers retain correct, temporary fallbacks until their
  matching migration is present.
- Analytics resolves a selected telemetry `vehicle_id` through `cars.vehicle_alias`
  and filters `charging_sessions.car_id`, fixing mixed charging costs/sessions for
  multi-car users in monthly, period, and cost-per-km summaries.
- Added focused response-mapping and session-scope regression tests; documented the
  production query invariants in `docs/CHART_OPTIMIZATION_SPEC.md`.
- Verification: focused tests pass, `npm run test` passes (100 existing globbed tests),
  targeted ESLint passes, and `npm run build` passes. Local migration execution was
  not possible because `127.0.0.1:54322` is not running; migration
  `20260710170000_analytics_query_fanout_repairs.sql` still needs to be applied before
  deploying the matching web code.

### Fix History Analytics range chips jumping into a future period

- Reproduced the anchor drift: Day July 10 → Week W28 → Month July (month-end anchor)
  → Week W31 / July 27 → Day July 27, despite no forward navigation.
- Analytics range chips now re-anchor from the user's current **local** calendar date
  on every selection. Historical navigation remains available through the dedicated
  range anchor controls.
- Added pure regression coverage for the July 10 Day → Week → Month → Week → Day flow
  and documented the behavior in `docs/CHART_OPTIMIZATION_SPEC.md`.

---

### Fix false auto-charging sessions when Di+ says the gun is unplugged

- Diagnosed car `way`: a parked 79% snapshot had no charge power and Di+ gun state
  `1` (unplugged), but a stale `is_charging: true` created a zero-energy open session
  and made the dashboard correctly—but misleadingly—show **Stop Charging**.
- `isMateAutoSessionCharging` now accepts the normalized Di+ context and rejects the
  stale Boolean fallback when gun state is explicitly `1`; a positive
  `charge_power_kw` still wins as real charging evidence.
- `processBydmateAutoChargingSessions` now passes each telemetry sample’s Di+ context
  into the detector. Two subsequent unplug samples will close the existing false row
  through the normal auto-stop path.
- Added the regression test and updated `AGENTS.md` plus
  `docs/CHARGING_SESSIONS.md` to document the precedence rule.
- Focused charging suite: 45 passing. Production build and touched-file ESLint pass.

---

### Agent guidance contract and skill map consolidated

- `AGENTS.md` now clearly gates every tracked-file change behind a researched
  `BACKLOG.md` plan and explicit approval; read-only reviews remain non-mutating.
- Added a documentation-precedence order: `AGENTS.md` for workflow and durable
  safeguards, canonical domain docs for detailed behavior, then source/tests for
  suspected drift. `SKILLS.md` is explicitly navigational and never authoritative
  over a domain doc.
- Rewrote `SKILLS.md` around owner-file maps and verification commands. It no longer
  duplicates volatile charging thresholds, removes the duplicated reconcile entry,
  includes the plan/Agentmemory/Next.js startup gates, and makes branch creation safe
  for dirty working trees.
- Verified the Mate auto-start truth remains four consecutive parked charging samples
  (`charging-auto-session-step.ts` and `docs/CHARGING_SESSIONS.md`); the former stale
  two-sample instruction is gone.

---

### Vercel Hobby efficiency: remove redundant proxy/API work

- `src/proxy.ts` now bypasses public pages before creating a Supabase client and excludes
  all `/api/`, PWA metadata, and icons in its matcher. Protected page redirects and the
  authenticated `/login` redirect remain intact.
- Trip reads now use the browser Supabase client under RLS, preserving the existing
  energy enrichment and development API path. Realtime refreshes on trip creation or
  completion; the 60-second fallback does not requery during every ingest update.
- Command polling changed from 15 to 60 seconds in production (Realtime stays primary).
  Active charging-session sample polling changed from 15 to 30 seconds and stops while
  the tab is backgrounded.
- The GitHub Mate release route now has a five-minute CDN cache. `vercel.json` runs a
  docs/migrations/screenshots-only ignore command to avoid unnecessary build execution.
  Vercel still counts canceled ignored deployments toward deployment/concurrency limits,
  so this is build-time hygiene rather than a quota solution.
- Added `src/proxy.test.mjs` matcher coverage. `npm run test` (100 tests) and
  `npm run build` pass.

The remaining dominant source of Vercel invocations is Mate telemetry ingest. The next
recommended step is the separately scoped BYDMate APK flush-interval change, then
measure Vercel Observability before considering an Edge Function port.

---

### Fix the 7 bugs from the 2026-07-10 code review (reconcile windows, autoservice ingest gap, dead is_charging branch)

All 7 confirmed findings from the review of a51e6c5 + 6177911:

1. **[CRITICAL] autoservice columns always NULL** — new migration
   `20260710120000_ingest_autoservice_fields.sql` redefines the 10-arg
   `bydmate_ingest_telemetry` wrapper to extract `autoservice.*` from
   `p_raw_payload` into the 9 `autoservice_*` columns on samples + live
   snapshots (batch path calls the wrapper per sample, so both ingest routes are
   covered; no route change needed). Live snapshots carry last-seen values
   forward when a sample has no autoservice block (SoH-style carry-forward).
   **Not yet applied to prod** — needs the psql pooler apply.
2. **[HIGH] Corrupt `stopped_at` bypassed the live SOC window** and
3. **[HIGH] backwards `stopped_at` blocked it** — `liveSocWithinSessionWindow`
   moved into `charging-session-reconcile-logic.ts` (testable) and now anchors
   the window end on `updated_at` (the moment of the botched close) whenever
   `stopped_at` is unparseable or before `started_at`; no usable anchor → no
   trusted window. Returns `{ soc, receivedMs }` so the caller can also use the
   snapshot's receipt time as a stop anchor.
4. **[HIGH] dead `is_charging` fallback** — `isMateAutoSessionCharging` now
   returns `true` for parked `is_charging` below 100% SOC (the final return
   repeated an always-false power check; auto-start never fired on
   `is_charging`-only evidence).
5. **[MEDIUM] 1-minute duration fallback** — `buildReconciledSessionPatch`
   returns `null` (leave the row alone) when there is no plausible stop
   evidence, instead of stamping `started_at + 60s`; the in-window live
   snapshot's `received_at` now joins the last-resort stop candidates.
6. **[MEDIUM] future `stopped_at` won `Math.max`** — stop candidates (and the
   stored-stopped_at validity check) are capped at `nowMs + 60s` skew.
7. **[LOW] `fuel_kwh` rendered as "L"** — TripStatsGrid unit fixed to `kWh`.
   (Note: the `20260708120000` migration comment calls the source field "liters
   equivalent" — if real PHEV data proves it's liters, rename the column
   instead.)

8 new regression tests (`charging-session-reconcile.test.mjs`,
`telemetry-charging.test.mjs`); full suite 104 tests green, build passes.

---

## 2026-07-09

### DiLink 5 full parity: fuel_kwh, autoservice FID fields, battery snapshots + idle drains

Three-phase implementation to reach full BYDMate data collection parity with DiLink 5 vehicles:

**Phase 1 — energydata fuel fix:**
- Migration `20260708120000_add_fuel_kwh_to_trips.sql` — adds `fuel_kwh` column to `bydmate_trips`, updates `bydmate_ingest_trip_summaries` RPC to accept fuel_kwh
- `src/lib/bydmate/trip-summary-payload.ts` — Zod schema accepts `fuel_kwh?: number | null`
- `src/types/database.ts` — `BydmateTripRow.fuel_kwh?: number | null`
- `src/components/history/history-view.tsx` — TripStatsGrid shows fuel when > 0 (PHEV indicator)
- `src/lib/i18n.ts` — `fuel` key in ru/be/en dictionaries

**Phase 2 — autoservice Binder fields:**
- Migration `20260708130000_add_autoservice_fid_fields.sql` — 9 autoservice columns on `bydmate_telemetry_samples` + `bydmate_live_snapshots` (soc, power, gun state, BMS state, capacity, voltage, battery type, lifetime mileage, lifetime kWh)
- `src/lib/bydmate/ingest-payload.ts` — `autoservice` object added (optional, passthrough)
- `src/types/database.ts` — autoservice fields on both sample + snapshot row types

**Phase 3 — battery snapshots + idle drains:**
- Migration `20260708140000_battery_snapshots_and_idle_drains.sql` — `bydmate_battery_snapshots` (BMS health at charge session ends, SOC delta >= 5%) + `bydmate_idle_drains` (zero-km parked consumption)
- Policies wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object` for idempotency

All 3 migrations applied to production. Build passes.

**APK side not yet implemented** — user must add Binder reads in BYDMate-own repo.

---

## 2026-07-08

### energydata trip-summary cloud sync — APK sender shipped (VoltFlow Mate v0.4.7)

The missing APK half of the 2026-07-06 web work (BYDMate-own repo,
[release v0.4.7](https://github.com/scroodge/BYDMate-own/releases/tag/v0.4.7)).
New `TripSummaryCloudSync` posts locally imported energydata trips to
`POST /api/bydmate/trip-summaries` after each `HistoryImporter.runSync()`:

- Same auth as telemetry (`X-API-Key` / `X-Vehicle-Id` via `CloudTelemetryClient`);
  endpoint derived from the configured telemetry URL. Hard-gated on Cloud Sync
  linked + car named, data source ENERGYDATA only (ADB/DiPlus cars don't
  double-report), Wi-Fi-only respected.
- Batches ≤300 (server zod limit) with a `start_ts` watermark advanced only on
  acknowledged batches; server upserts on `(user, vehicle, started_at)` so lost
  acks re-send safely. Zero-km idle records and out-of-zod-range rows filtered
  client-side (one bad element would 400 the whole batch).
- 14 unit tests (`TripSummaryCloudSyncTest`); full suite green.

**Verified in prod:** real DiLink 5 user synced 874 trips / 8,330 km (audit
2026-07-08). Docs/onboarding follow-up still pending — see BACKLOG.

---

## 2026-07-07

### Fixed: closed-session reconcile inflating finished charging sessions with a later charge's SOC

Car `way`, 2026-07-06: a DC fast charge that really ran 16→38% got recorded as 16→68%
with `stopped_at` rewritten to a highway sample mid-drive, double-counting the following
AC session's energy. Root cause was three compounding bugs in the closed-session repair
path (`src/lib/charging-session-reconcile-logic.ts` + `charging-session-reconcile.ts`),
not the auto start/stop logic (which worked correctly):

1. **Live-SOC bleed across sessions** — `measuredSocFromMate` used the car's live SOC
   *fresh relative to now*, with no check that it belonged to the session being repaired.
   Every later app-open during the next charge ratcheted the already-closed session's
   `current_percent` up to the car's current SOC. Fix: `liveSocWithinSessionWindow()` in
   `charging-session-reconcile.ts` now only passes `liveSoc` into the closed-session patch
   when the live snapshot's `received_at` falls inside `[started_at, stopped_at + 5min]`.
2. **Driving samples counted as charging evidence** — `isAcWallboxCharging` fell back to
   `power_kw` (positive while driving) with no speed guard, so `stopped_at` got dragged
   forward through an entire drive. Replaced with `isChargingEvidence()`: requires
   `charge_power_kw > threshold` and the vehicle parked (`speed_kmh ≤ 5`), reusing the
   same constants as the (already-correct) auto-session charging check.
3. **`stopped_at` candidate list included `lastSocAt`** (any sample with a SOC reading,
   charging or not) — dropped from the primary candidates; kept only as a last-resort
   fallback when the stored `stopped_at` itself is missing/invalid.
4. **Latent collapse risk** (found while reading, not yet observed in the wild): a
   below-target session with no SOC telemetry in its window and no live SOC would fall
   back to `start_percent`, wiping a legitimate recorded session. `buildReconciledSessionPatch`
   now returns `null` (no-op) instead of guessing.

Regression tests added to `charging-session-reconcile.test.mjs` modeled on the July-6
shape (6 new cases); all pre-existing tests + full suite + `tsc` + `next build` pass.

**Data repair:** three prod rows had already drifted from the bug — `712dd712…` (Jul 6,
16→68% → corrected to 16→38%), `333a1835…` (Jun 30, 32→100% → corrected to 32→64%),
`58f82cfb…` (Jul 3, 50→72% → corrected to 50→66%) — repaired directly via `psql` against
the self-hosted pooler, values re-derived from `bydmate_telemetry_samples` (last real
`charge_power_kw > 0` sample while parked, before the following drive).

**Not yet done:** code changes are in the working tree, not yet committed or deployed; the
bug is still live in prod until the next deploy — reconcile could re-corrupt the just-repaired
rows (or others) if the app is opened again before shipping. Item G from the original research (skip
re-scanning telemetry for consistent sessions older than ~48h, to cut egress) was not
built — kept as a possible follow-up if needed.

## 2026-07-06

### Providers unified into user-owned data (Home permanent, rest fully deletable)

Replaced the hardcoded `PROVIDER_TARIFF_PRESETS` + per-user `provider_tariffs`
override table with a single model: every provider (Home, Malanka, Evika!,
forEVo, Zaryadka, BatteryFly, plus any custom ones) is now a `user_providers`
row the user owns outright. Prompted by feedback that providers should be
user-dependent data, not app-wide constants with a bolted-on override/hide
layer — the fix is to make the already-working `user_providers` CRUD (add,
edit, checkbox → "Delete selected") the single source of truth.

- **Migration** `20260706200000_fold_builtin_providers_into_user_providers.sql`:
  adds `user_providers.is_default boolean`; seeds the 6 baseline providers per
  existing user (price = their old `provider_tariffs` override if present, else
  the hardcoded default; Home flagged `is_default`); repoints existing
  `charging_tariff_locations` rows from the bare enum (`'malanka'` etc.) to the
  newly-seeded `user_providers` row so auto-resolution keeps using each user's
  price; drops `provider_tariffs`.
- **New users**: seeding isn't a DB trigger (GoTrue has silently dropped
  `on_auth_user_created` before — see [[handle-new-user-trigger-dropped]]).
  Instead `useSeedDefaultUserProviders()` (`src/hooks/use-user-providers-query.ts`)
  lazy-inserts the 6 defaults the first time `user_providers` resolves empty,
  mounted globally via `<DefaultProvidersSeed />` in `MobileShell` so it fires
  regardless of which page loads first.
- **Lib** (`src/lib/charging-tariffs.ts`): new `defaultUserProviderSeeds()` and
  `findDefaultHomeProvider()`; `PROVIDER_TARIFF_PRESETS` kept only as the
  fallback for historical bare-enum rows. The power-based auto-tier fallback
  (no manual pick, no GPS match, low charger power) now resolves through the
  user's `is_default` Home row instead of a hardcoded constant.
- **Settings UI**: the separate "Provider tariffs" (built-in, price-override-only)
  card is gone — merged into "Your providers", which now lists every provider
  with editable AC/DC prices. Home has no checkbox (can't be selected for
  delete); every other row can be repriced or removed like a custom one.
- **Dashboard / charge screen / settings location form**: all 4 places that
  used to hardcode the built-in provider list now enumerate `user_providers`
  rows only, plus `custom` (manual price, always available).
- Fixed a latent bug found while touching this: the dashboard's parked-charge
  price estimate never passed its `estimateUserProviderId` into price
  resolution, so picking a custom provider there silently priced at 0.
- **Tests**: `charging-tariffs.test.mjs` covers the seed shape, the Home-excluded
  auto-fallback, and legacy bare-enum resolution for historical data.

### energydata trip-summary cloud sync — web half

Web side of letting no-ADB BYD trip logs reach VoltFlow (APK side still pending —
see BACKLOG). Triggered by a real user's Yuan UP 2025 / DiLink 5 confirming (via the
VoltFlow Mate v0.4.6 «Диагностика BYD» button) that their firmware writes
`/storage/emulated/0/energydata/EC_database.db` — 876 trips, readable with no ADB.

- **Migration** `20260706190000_bydmate_trip_summary_source.sql`: `bydmate_trips.source`
  (`telemetry` default / `byd_energydata`), a partial unique index on
  `(user_id, vehicle_id, started_at) where source='byd_energydata'` for idempotent
  re-import, and `bydmate_ingest_trip_summaries(user_id, vehicle_id, trips jsonb)` RPC
  (security definer, service_role only) that upserts per-trip aggregates and derives
  `avg_speed_kmh` / `avg_consumption_kwh_100km` server-side so the existing history UI
  needs no new fields. Verified in a rolled-back transaction: insert, then re-ingest with
  the same `started_at` updates in place (no duplicate row); math matches the real
  report's trip (46.85 km/h, 20.0 kWh/100km for 6.0 km / 461 s / 1.20 kWh).
- **API** `POST /api/bydmate/trip-summaries` (`src/app/api/bydmate/trip-summaries/route.ts`):
  same `X-Api-Key` → `profiles.bydmate_cloud_api_key` auth as `/api/bydmate/telemetry`;
  Zod-validated batch (`src/lib/bydmate/trip-summary-payload.ts`, max 300, epoch-second
  timestamps matching `EnergyConsumption.start_timestamp`).
- **UI**: small "BYD log" badge on trip cards where `source === 'byd_energydata'`
  (`history-view.tsx`); no other changes needed — charts/route panels already have
  empty states for trips with no telemetry samples or GPS track, and `fmt()` already
  renders missing SOC as `—`.
- These are per-trip **aggregates only** (no samples, no track, no SOC) — bypass
  `bydmate_ingest_telemetry` and its junk-trip rules entirely.

### Editable provider tariffs + auto-save GPS point after manual provider pick

Two-part feature so per-provider prices (Malanka, Evika, etc.) are no longer
hardcoded, and a manual provider pick during a charge quietly turns into a saved
GPS location for next time.

**Part 1 — editable provider tariffs:**
- **Migration** `20260706010000_provider_tariffs.sql`: new `provider_tariffs` table
  (PK `user_id, provider_type`, AC/DC/home prices, RLS own). No seed rows — a
  missing row means "use the hardcoded `PROVIDER_TARIFF_PRESETS` default".
- **Lib** (`src/lib/charging-tariffs.ts`): `resolveProviderTariff()`,
  `providerTariffsFromRows()`; `resolveTariffPrice()` / `resolveSessionTariff()`
  take an optional `providerTariffs` overrides map — user override wins over the
  hardcoded preset, a location's `price_per_kwh_override` still wins over both.
- Wired into all three tariff-resolution call sites (`startChargingSession`,
  `syncChargingSessionTariffFromGps` in `src/actions/sessions.ts`, and
  `resolveTariffForTelemetry` in `src/lib/bydmate/charging-auto-session.ts`) and
  three client spots (charge-screen provider pick, dashboard park estimate,
  settings) via a new `useProviderTariffsQuery` / `useProviderTariffOverrides`
  hook (`src/hooks/use-provider-tariffs-query.ts`).
- **Settings UI**: the old "Provider preset" dropdown (which silently reset to
  "Manual values" and never actually persisted a chosen provider — see the
  superseded BACKLOG item) is replaced by a "Provider tariffs" editor: one row per
  built-in provider with AC/DC price fields and a single save button. Rows with a
  saved override show a checkbox — checking one or more swaps "Save provider
  tariffs" for a "Cancel" / "Delete selected (N)" row, which deletes those
  override rows from `provider_tariffs` (the provider itself reverts to its
  hardcoded default price, same bulk-select pattern as custom providers below it).

**Part 2 — delayed GPS point save:**
- **Migration** `20260706020000_charging_sessions_tariff_selected_at.sql`: new
  `charging_sessions.tariff_selected_at`, set whenever the user manually saves a
  tariff on the active charge screen; re-picking resets the clock.
- New pure decision module `src/lib/charging-tariff-location-autosave.ts`
  (`decideTariffLocationAutosave`, `TARIFF_LOCATION_AUTOSAVE_DELAY_MS = 5 min`,
  `uniqueTariffLocationName`) plus server action
  `persistManualTariffLocationFromSession` (`src/actions/sessions.ts`): once a
  manual, non-custom provider pick has stuck for 5 minutes on a still-charging
  session, it takes the car's GPS from the live snapshot (browser GPS fallback),
  dedupes against existing saved locations (same provider → skip, different
  provider → correct that point), and otherwise inserts a new point named after
  the provider (150 m radius, no price override, so later tariff edits propagate).
  Unplugging before 5 minutes saves nothing (filters out mis-taps).
- **Trigger**: new hook `useChargingTariffLocationAutosave`, polled every 30 s from
  the global `ChargingSessionBackgroundSync` — survives navigating away from the
  charge screen.
- Tests: `src/lib/charging-tariffs.test.mjs` (override lookup) and
  `src/lib/charging-tariff-location-autosave.test.mjs` (persist decision:
  too-early / not-manual / custom-provider / dedupe-same / dedupe-different /
  insert).

### User-connected providers — add/remove custom providers per-user

Users can now create their own charging providers with custom names and prices, and
remove them. These appear alongside built-in providers (Malanka, Evika, etc.) in all
selectors. Built-in providers remain unchanged.

**Migration** `20260706180000_user_providers.sql`:
- Added `'user_provider'` to `charging_provider_type` enum (marker value)
- New `user_providers` table (per-user label + 3 prices, RLS, unique per label)
- Nullable `user_provider_id` FK on `charging_sessions` and `charging_tariff_locations`

**Lib** (`src/lib/charging-tariffs.ts`):
- `resolveProviderTariff()` now handles `'user_provider'` — looks up prices from
  `user_provider` rows
- New `userProvidersFromRows()`, `resolveUserProviderPrices()`, `UserProviderMap` type
- `TariffResolution` includes `userProviderId`
- `ProviderTariffOverrides` excludes `user_provider` (prices live in user_providers)

**Types** (`src/types/database.ts`): `ChargingProviderType` union includes `'user_provider'`,
new `UserProviderRow` type, `user_provider_id` on `ChargingSessionRow` and
`ChargingTariffLocationRow`.

**Hook** (`src/hooks/use-user-providers-query.ts`): fetches user's `user_providers` rows;
`useUserProviderMap()` returns the id→row map for resolution.

**Server actions** (`src/actions/sessions.ts`, `src/lib/bydmate/charging-auto-session.ts`):
all tariff resolution call sites also fetch `user_providers` rows and pass
`userProviderMap` into `resolveSessionTariff`. Created sessions save `user_provider_id`.

**Settings UI** (`src/components/settings/settings-view.tsx`): new "Your providers" card
with:
- List of existing user providers (label, AC/DC prices), each row a checkbox rather
  than a per-row Delete button — selecting one or more swaps the add-provider form
  for a "Cancel" / "Delete (N)" action row, so removing several providers doesn't
  need N separate confirmations.
- Add provider form (label, AC price, DC price, Save button) — hidden while a
  selection is active.
- Duplicate label detection and validation

**Provider selectors** (4 components):
- Dashboard park estimate (`dashboard-view.tsx:ParkChargeEstimatePanel`)
- Dashboard manual session dialog (`dashboard-view.tsx`)
- Charging session screen (`charging-session-screen.tsx`)
- Settings tariff location form (`settings-view.tsx`)
All use `up_<uuid>` namespace convention for user-provider values and merge built-in +
user providers in a single dropdown.

**i18n**: new keys in en/be/ru for add/delete provider flows.

**Tests**: `charging-tariffs.test.mjs` – user provider tariff resolution, user provider
with location match.

### Inactive account auto-cleanup

30-day inactivity → Resend warning email → 60-day auto-deletion. Premium users exempt.

- **Migration** `20260706120000_profiles_inactivity_cleanup.sql`: added
  `last_active_at` + `inactivity_warning_sent_at` to `profiles`.
- **Activity tracking**: `last_active_at` updated on every telemetry ingest
  (`route.ts`) and on web login via `touchUserActivity()` server action
  (throttled to 1/hour, called from `MobileShell` on mount).
- **Email infra**: `resend` npm package installed; `sendInactivityWarning()` in
  `src/lib/email/inactivity-warning.ts`.
- **Cron route**: `POST /api/cron/inactivity-check` (CRON_SECRET gated) sends
  warnings at 30d and deletes accounts at 60d via
  `supabaseAdmin.auth.admin.deleteUser()`.
- **Self-service deletion**: "Delete account" card in settings with type-to-confirm
  (`Trash2`, DELETE text), calls `src/actions/account.ts`.
- **Policy updates**: privacy + terms (world + belarus) × 3 locales — added
  inactivity paragraph in Retention / Termination sections. Date bumped to
  2026-07-06.
- **Remaining**: add daily crontab entry on Contabo to curl the cron route.

### Auto page while charging: charge params lead, then rest, Delta, Remote
During an active charge the Авто page used to mix charge metrics into the hero grid
and duplicate power/type/temps in a "Идет зарядка" card at the very bottom. Rebuilt
the charging layout in `src/components/vehicle/vehicle-live-view.tsx` (single file,
no schema/i18n changes):
- **Hero** is slimmed while charging: SOC + status badge + last update only.
- **`ChargingModeCard`** (cyan, "Идет зарядка") moved to directly under the hero and
  extended from 4 to 7 tiles: charge power, charge type, battery temp, outside temp,
  remaining, energy delivered, cost at 100%. The `chargeSummary` projection memo
  moved out of `Hero` into this card (takes `session` prop); `—`-valued tiles are
  hidden via `isMissingMetricValue`.
- New **`RestMetricsCard`** below it with the displaced hero metrics: AI range,
  math range, 12V battery, odometer.
- Then **`ChargingDeltaCard`** (Delta by SOC) and **`VehicleControlPanel`**
  (Remote commands, admin) in that order.
- Non-charging and stale layouts unchanged; `is_charging` without an open
  auto-session still renders power/type/temps from telemetry (summary tiles hidden).
- Verified: `npm run build` clean; lint shows no new issues in the file.

### Telegram: only the live widget remains — verbose state messages removed
The "ℹ️ Ваш автомобиль … подключился к сети / в режиме стоянки / отключен от сети"
messages (Пробег/🔋/Время + maps link) duplicated the editable live widget and
spammed the chat on every connect/park/reconnect. Built backlog Option A:
- Deleted `src/lib/push/vehicle-state-notifications.ts` and its call + import +
  `vehicle_state_notifications` response field in
  `src/app/api/bydmate/telemetry/route.ts` (its only call site).
- Migration `20260706000000_drop_bydmate_vehicle_state_notifications.sql` drops the
  module's state table (`drop table if exists`, idempotent). ⚠️ **Deploy order
  matters:** with the table gone but the *old* code still deployed, every ingest
  batch sees "no previous state" and fires a connected message — so the table was
  re-created on prod as a shim. **Run the drop migration via the pooler psql recipe
  AFTER the new code is live on Vercel.**
- Side benefit: ~4 fewer DB queries per ingest batch (egress/CPU initiative).
- Kept: the live widget (`updateTelegramLiveWidgets`) and the separate
  `Charging: 80/95/100%` threshold notifications (user chose to keep them).
- Accepted trade-offs: no Telegram ping on connect (widget edits are silent), no 💰
  cost estimate line, no explicit "disconnected" message (widget shows 💤 Офлайн).

### Settings → tariff save: visible progress + confirmation (UX)
Pressing **Save** under Settings → Economics gave no feedback until the Supabase
round-trip finished (fire-and-forget update, no pending state on the button).
Built Option A from the backlog plan, in `settings-view.tsx` + `i18n.ts` only:
- Save button now has a `saving` state (disabled + spinner + "Saving…") and a ~2 s
  "Saved ✓" confirmation state where the user is looking; double-submit guarded.
- `toast.promise` shows an instant "Saving…" toast that resolves to success/error;
  on error the previous prices are rolled back (as before).
- Applying a **provider preset** now shows an info toast reminding that the values
  still need to be saved (they only fill the form).
- New i18n keys `settings.tariffSaving`, `settings.tariffSavedShort`,
  `settings.locationTariffs.presetAppliedHint` in en/be/ru.

---

## 2026-06-30

### Inline charging on `/vehicle` Live + Charge tab removed
The Charge tab used to redirect to a separate `/charging/[id]` page while charging.
Charging params (time-left, delivered kWh, cost-at-100 %) and the SOC graph now render
inline on the Live view when a session is active; the Charge tab is gone (`?tab=charge`
→ Live). Deep links `/charging/[id]` and `/history` are unchanged. Exactly one
`useChargingSessionLiveSync` owner while charging.

### Charge-session finish detection — overshoot/stuck fixes
Fixed four compounding finish-detection bugs:
- **Math overshoot** → SOC clamp (`clampDerivedToSocCeiling`): projected `current_percent`
  can't exceed `latestSoc + rate × secondsSinceLatestSoc`.
- **Garbage charger power** → `sanitizeChargerPowerKw` rejects AC > 22 kW / DC > 350 kW.
- **Stuck-open sessions** (car sleeps, no unplug samples) → stop-on-silence in reconcile
  (`OPEN_SESSION_SILENCE_MS = 15 min` + stale live SOC).
- **`energy_overridden` lock-in** → repair migration
  `20260630150000_repair_math_overshoot_sessions.sql` (applied prod).

### BMS-measured charge energy — investigated, **not** used for cost
Validated on car `way` (45.1 kWh): the BMS counter `telemetry.kwh_charged`
(`FID_CHARGING_CAPACITY`) measures **battery-cell energy only** and reads ~47 % low vs
grid truth, because ~1.7 kW of active battery thermal management draws from the OBC
output before the cells. **Correct cost formula stays `SOC_delta% × capacity ÷ 100`,
efficiency ≈ 100 %.** `kwh_charged` is retained for diagnostics/thermal monitoring only.
> ⚠️ Follow-up: any code path that used `maxKwhCharged` for cost, or
> `deriveChargePowerFromEnergyDeltaKw` on the power display, must be reverted — those
> understate cost / show misleading cell-side power. Tracked in [BACKLOG.md](BACKLOG.md).

### Storage bucket write policies
`20260630120000` restricts insert/update/delete on the five knowledge/service buckets
to admins. Without these, admin CMS uploads silently 500'd on self-hosted prod (the
buckets/policies weren't carried over in the hosting migration). See
[docs/DATABASE_SCHEMA.md §Storage](docs/DATABASE_SCHEMA.md).

### BatteryFly charging provider
Added `batterfly` to the `charging_provider_type` enum (`20260630110000`).

### Telemetry samples — BRIN interim (partitioning Plan B)
BRIN index on `bydmate_telemetry_samples(device_time)` (~72 kB vs 10–42 MB btrees);
planner confirmed using it for time-range scans. Full range-partitioning (Plan A)
remains unbuilt — see [BACKLOG.md](BACKLOG.md).

---

## 2026-06-29

### Settings — no GPS prompt on every open
Removed the mount-time `getCurrentPosition()` in `settings-view.tsx`; GPS is fetched
only when the user explicitly asks, and the last value is cached in `localStorage`
(per-device, no DB privacy concern).

### Vehicle-state Telegram notifications
Connect / park / disconnect events detected during ingest and pushed to Telegram.
State in `bydmate_vehicle_state_notifications` (`20260629130000`). See
[docs/VEHICLE_STATE_NOTIFICATIONS.md](docs/VEHICLE_STATE_NOTIFICATIONS.md).

---

## 2026-06-24 — Egress / CPU initiative

Cleared the Vercel Fluid Active-CPU + Supabase egress caps (full details in the
local-only `docs/archive/EGRESS_CPU_MASTER_PLAN.md`):

- **A** Tiered charging-session poll (60 s / 5 s / 1 s by SOC), unified in
  `chargingSessionsRefetchInterval` so all observers of `queryKeys.sessions` agree
  (TanStack uses the shortest observer interval).
- **B** Reconcile gated to auto-session start/stop in the ingest route.
- **C** Trimmed the echoed `raw_payload` from the post-ingest verify re-read.
- **D** pg_cron daily telemetry purge (`20260624130000` →
  `purge_old_bydmate_telemetry_by_tier()`).
- **E** APK charging-bulk ~60 s flush (Mate repo) — ~4× fewer charging-phase POSTs.

Also dropped the redundant raw `diplus` blob from telemetry (DB 509 → 258 MB).

---

## 2026-06 (earlier) — Charging session integrity

- Auto start/stop sessions from Mate ingest (`20260602120000` +
  `processBydmateAutoChargingSessions`).
- One-time backfill of false `completed` rows (`20260602103500`).
- Fixed 2026-06-03 phantom sessions on car `way` (root cause: traction `power_kw` treated
  as charging; fix: `isMateAutoSessionCharging`, parked check, 4 samples, 3-min window).
- Tiered, premium-aware telemetry retention (`20260617133000`, `20260617135500`,
  `20260626130000`): free 30 d raw, premium + admin kept indefinitely.

---

## Infrastructure

- **Self-hosted Supabase** with Grafana monitoring and Telegram alerts. Migrations apply
  via `psql` (the CLI can't reach the no-TLS pooler). Host/infra specifics are in the
  local-only `docs/OPS_LOCAL.md`; migration history in the local `docs/archive/`.
- **GoTrue SMTP via Resend** for auth emails; fixed forgot-password 500 + prefetch-proof
  recovery flow.
- **Telegram Mini App entry** (BotFather Main Mini App); archived plan in the local-only
  `docs/archive/TELEGRAM_MINIAPP_PLAN.md`.
