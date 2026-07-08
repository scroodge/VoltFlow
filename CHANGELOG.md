# Changelog — shipped initiatives & notable fixes

A running log of completed work that was previously tracked as "plans". Newest first.
For unbuilt proposals see [BACKLOG.md](BACKLOG.md); for current behavior see the
[docs/](docs/ARCHITECTURE.md) reference set.

> Dates are when the work landed in the working tree. "Built" here means code +
> tests + (where applicable) migrations applied to prod, as recorded at the time.

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
