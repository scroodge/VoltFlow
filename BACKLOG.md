# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

---

## 🟢 Providers should be user-owned data, not app-wide hardcoded + a hide-list

**Requested 2026-07-06.** Rejected the first draft of this plan (a `hidden_providers`
exception table layered on top of the hardcoded `PROVIDER_TARIFF_PRESETS` list) —
user's correction: **"providers is user dependent, not app dependent."** The
architecture should reflect that from the start, not bolt a hide-list onto a
global constant. Since `user_providers` (custom providers) already has full,
working CRUD — add, edit-by-replace, and the checkbox → "Delete selected (N)"
flow — the fix is to make **that** table the single source of truth for every
provider, built-in ones included.

**Current split (the thing being unified):**
- `PROVIDER_TARIFF_PRESETS` (`src/lib/charging-tariffs.ts`) — hardcoded, global,
  same for every user.
- `provider_tariffs` — per-user *price override* on top of a hardcoded provider.
- `user_providers` — per-user, fully owned, add/delete already works.
- 4 separate hardcoded built-in lists enumerate providers for selectors:
  `settings-view.tsx:96` (`EDITABLE_PROVIDERS`), `settings-view.tsx:204`
  (`locationProviderOptions`), `dashboard-view.tsx:99`
  (`BUILT_IN_PROVIDER_OPTIONS`), `charging-session-screen.tsx:123` (inline).

### Design — fold built-ins into `user_providers`

**Seed, don't hardcode.** Every user's `user_providers` table gets pre-populated
with the current Belarus baseline (Home, Malanka, Evika!, forEVo, Zaryadka,
BatteryFly) as ordinary rows they can rename, reprice, or (except Home) delete —
exactly like a provider they typed in themselves. Deleting one is the existing
"Delete selected" flow; there is no separate "built-in" concept left to
special-case.

- **Home is permanent — decided 2026-07-06.** New `is_default boolean not null
  default false` column on `user_providers`, `true` only for the seeded Home row.
  Settings UI hides the selection checkbox for `is_default` rows (nothing to
  delete), so it never appears in a "Delete selected" batch. Price stays fully
  editable like any other row. This also removes the "what if Home gets deleted"
  fallback question entirely — it can't happen.
- **Existing users (migration, one-time, idempotent):** for each `profiles.id`,
  insert the 6 seed rows into `user_providers` (`ON CONFLICT (user_id, label) DO
  NOTHING`, so reruns are safe) — price = the user's existing `provider_tariffs`
  override if one exists, else `PROVIDER_TARIFF_PRESETS` default; Home row gets
  `is_default = true`. Existing `charging_sessions`/`charging_tariff_locations`
  rows keep their historical `provider_type` enum value (`'malanka'` etc.) and
  display exactly as before — no retroactive rewrite, this is additive only.
- **New users:** the DB trigger route is a known landmine here — GoTrue upgrades
  have silently dropped `on_auth_user_created` before (see
  [[handle-new-user-trigger-dropped]]), which is exactly the kind of place a
  seed-on-signup step would go quietly missing. Instead, **lazy-seed on first
  Settings load**: if `useUserProvidersQuery()` returns zero rows for a user,
  insert the 6 defaults client-side once (Home flagged `is_default`).
  Self-healing if it's ever missed.
- **Selectors:** all 4 places drop their hardcoded built-in arrays and enumerate
  `user_providers` rows only (already the `up_<uuid>` merge convention — this
  removes the "other half" of the merge, it doesn't add a new one). `custom`
  stays as the always-available manual-price fallback (not a stored provider).
- **`provider_tariffs` table:** becomes dead after the seed migration folds its
  data into `user_providers`. Drop it in the same migration once the backfill
  read is done (no lingering unused table/columns).
- **Tariff resolution** (`resolveSessionTariff` / `resolveTariffPrice`): the
  hardcoded-preset branch stays *only* for reading old sessions/locations still
  tagged with a bare enum value (`'malanka'`, not `'user_provider'`) — dead for
  all new picks, which now always resolve through `resolveUserProviderPrices`.
  The power-based auto-tier fallback (no manual pick, no GPS match, low charger
  power ⇒ home tariff) now always resolves through the user's `is_default` Home
  row, which is guaranteed to exist.

**Tests:** the seed-migration backfill logic (idempotent re-run, override price
carried over, Home always `is_default`) and that the Home row is excluded from
delete-selection, alongside the existing `charging-tariffs.test.mjs` coverage.

**Verify:** `npm run lint`, `npm run build`, `npm run test`; manual: fresh user
lands in Settings → sees the 6 seeded providers pre-filled, editable, all
deletable down to just Home (no checkbox on the Home row, can't be selected for
delete); existing user's prior `provider_tariffs` override price shows up
correctly on the seeded row after migration; old charging history still displays
correctly.

---

## 🟢 Email verification for signup (onboarding) — DECIDED, awaiting build go-ahead

**Decision (2026-07-01):** free-user signup should **require email verification**
(chosen over the current instant-access / autoconfirm behavior).

**Current state (root cause of "no signup email"):** GoTrue runs with
`ENABLE_EMAIL_AUTOCONFIRM=true` → `GOTRUE_MAILER_AUTOCONFIRM: true`. Signups are
auto-confirmed and instantly logged in server-side; **no confirmation email is ever
generated** (verified in `docker logs supabase-auth`: `user_signedup` +
`immediate_login_after_signup:true`, zero mailer sends; Resend also shows nothing).
The Resend pipeline itself is healthy (it sends the recovery emails).

**Known landmine:** the default confirm link (`{{ .ConfirmationURL }}` → auto-verifying
`/auth/v1/verify` GET) gets **consumed by email-link prefetchers** (Apple Mail Privacy
Protection, Telegram preview bot) before the user clicks → `otp_expired`. Already solved
for password reset via a **token_hash link verified only on click** — reuse that exact
pattern here. See [[gotrue-smtp-resend]].

### Work items

**1. Server (contabo `/opt/supabase`)**
- `.env`: `ENABLE_EMAIL_AUTOCONFIRM=false`.
- Add confirmation subject + template env to the `auth` service in `docker-compose.yml`:
  `GOTRUE_MAILER_SUBJECTS_CONFIRMATION`, `GOTRUE_MAILER_TEMPLATES_CONFIRMATION` →
  `https://supabase.mykid.life/auth-templates/confirmation.html`.
- Host `confirmation.html` at `/opt/supabase/volumes/auth-templates/` (served by the
  existing nginx `location /auth-templates/` block). Link →
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup` (**token_hash, no
  auto-verify**).
- (Optional, while in the file) add `supabase.mykid.life` to
  `GOTRUE_MAILER_EXTERNAL_HOSTS` to stop the log flood.
- Apply: `cd /opt/supabase && docker compose up -d auth`. Back up `.env` +
  `docker-compose.yml` first.
- **Existing 28 users unaffected** (already confirmed); Google OAuth unaffected.

**2. Client (Next.js)**
- New public page `src/app/auth/confirm/page.tsx`: reads `token_hash`+`type`, calls
  `supabase.auth.verifyOtp({ type: 'signup', token_hash })` on mount (bots doing a plain
  GET don't run the JS, so the token survives), then routes into `/onboarding`. Error
  state offers a **resend**.
- Add `/auth/confirm` to `PUBLIC_PATHS` in `src/proxy.ts`.
- `login-form.tsx` `handleSignUp`: with autoconfirm off, `data.session` is null →
  show a clear **"check your inbox"** state (not the misleading current toast), with a
  **Resend** action (`supabase.auth.resend({ type: 'signup', email })`).
- Handle `email_not_confirmed` on the **sign-in** path (user tries to log in before
  confirming) → friendly message + resend.

**3. i18n** — new keys for confirm page, resend, and the not-confirmed error, in en/be/ru
(ru is `defaultLocale`, so keys must exist there or `tsc` breaks).

**4. Verify** — `tsc` + `eslint` + `npm run build`; then a real end-to-end test:
signup → Resend shows the mail → click link → verify → land in onboarding; confirm a
prefetch (plain GET) does **not** burn the token.

**Trade-off:** more friction + more moving parts vs. instant access, but gives real email
ownership. The whole flow hinges on the token_hash pattern to survive prefetchers.

---

## 🔴 Revert BMS-for-cost code paths (correctness)

The BMS counter `kwh_charged` is battery-**cell** energy only (~47 % low vs grid) and
must not drive cost or the power display. Validated 2026-06-30 — see
[CHANGELOG](CHANGELOG.md) and [docs/CHARGING_SESSIONS.md](docs/CHARGING_SESSIONS.md).

**To revert:**
- `buildReconciledSessionPatch` — stop using `maxKwhCharged` for energy/cost; use
  `SOC_delta% × capacity ÷ 100` (efficiency ≈ 100 %).
- `useFloatChargePowerKw` wired into `vehicle-live-view.tsx` +
  `charging-session-screen.tsx` — revert (shows cell-side ~2.5 kW vs grid 4.6 kW).
- Keep `kwh_charged` in telemetry and the tested `deriveChargePowerFromEnergyDeltaKw`
  helper for diagnostics; just don't let them drive cost/power UI.

> This is the one backlog item that is a **bug**, not an enhancement. Prioritize it.

---

## 🟡 Partition `bydmate_telemetry_samples` by time (Plan A)

The high-volume ~1 Hz append-only table. Retention is `DELETE`-based (bloat + vacuum
pressure). **Plan B (BRIN index) is done** (see CHANGELOG). **Plan A (full declarative
range partitioning by `device_time`, monthly)** turns retention into `DROP PARTITION`
and shrinks indexes.

- Forces composite PK `(id, device_time)`; the existing unique
  `(user_id, vehicle_id, device_time)` already includes the partition key. ✅
- Subtle part: the prune rewrite — mixed retention tiers (free 30 d vs premium/admin
  forever) in one time partition means a hybrid of `DROP PARTITION` (past the longest
  tier) + per-user `DELETE` within retained partitions.
- Annotated, **not-applied** draft: [docs/PLAN_A_PARTITION_DRAFT.sql](docs/PLAN_A_PARTITION_DRAFT.sql).
- Needs user go-ahead **and** a pg_dump/host backup before applying.

Not urgent at current scale; worth doing before the userbase grows.

---

## 🔵 Promote `vehicle_id` to a real foreign key

`vehicle_id` is a soft `text` key across telemetry, trips, snapshots, commands, and
notifications (~36 occurrences), linked by `cars.vehicle_alias` (text) → `*.vehicle_id`
(text) string equality with **no referential integrity**. A typo or alias change
silently orphans data.

**Recommendation:** a real `vehicles` table (uuid PK), FK from all telemetry/trip/command
tables, keeping `vehicle_alias` as the external device id. Big, multi-RPC migration on
the hottest write path (ingest) — defensible to defer until the telemetry tables are
already being opened up (e.g. combine with the partitioning cutover above). Lower
priority than partitioning; build only if explicitly prioritized.

---

## ⚠️ APK: no-ADB basic mode — verdict REVISED 2026-07-06 (varies by firmware)

> **2026-07-06 correction:** a real user's **Yuan UP 2025 / DiLink 5** ran the v0.4.6
> «Диагностика BYD» button: `/storage/emulated/0/energydata/EC_database.db` **EXISTS**
> (876 rows, `canRead=true`, DiPlus not running, no ADB), and the APK's existing importer
> had already pulled **873 trips into its local DB**. So `energydata` presence **varies by
> firmware/model-year within Yuan UP** — the owner's car lacks it, the 2025 car has it.
> Basic mode is viable on such cars; the ⛔ below stands only for cars without the file.
> → The trip-summary cloud sync plan below is now **justified by a real user**.

### Original investigation (2026-07-02, owner's car)

Investigated adopting AndyShaman's no-ADB `energydata` read. **Dead end on the Yuan UP** —
verified on car `way` via ADB:

- `/storage/emulated/0/energydata/EC_database.db` (AndyShaman's source) **does not exist**
  on the Yuan UP — it's Leopard-3-only. `EnergyDataReader.kt` already reads it; nothing to
  read on this model.
- di+ `van_bm_db` (`/storage/emulated/0/vandiplus/db/van_bm_db`) has rich trip+charging
  history and a reader (`DiPlusDbReader`), but di+ only **writes** it when di+ works —
  which needs ADB. No ADB → empty.

**Conclusion:** on DiLink 5 there is no no-ADB source; ADB is required for any data. Docs +
onboarding reverted from "basic mode coming soon" to "ADB required." No APK work to do
unless a future model ships the `energydata` DB. See [[adb-data-source-reality]].

**Clarification vs upstream README (2026-07-05):** AndyShaman's no-ADB basic mode is real
but rests entirely on the `energydata` file — and per his own architecture table, live
SOC/temps/SoH/cells come from the **autoservice Binder under shell (ADB)** even upstream.
Basic mode ≠ live cockpit anywhere; it's trips/consumption + GPS only. His car (Leopard 3)
writes `energydata`; the Yuan UP doesn't.

---

## 🟡 energydata trip-summary cloud sync — web half DONE, APK half pending

**Web half shipped 2026-07-06** — see [CHANGELOG](CHANGELOG.md). Migration
`20260706190000_bydmate_trip_summary_source.sql` (`bydmate_trips.source` +
`bydmate_ingest_trip_summaries` RPC, applied to prod) + `POST /api/bydmate/trip-summaries`
+ "BYD log" trip badge. Confirmed real schema from a Yuan UP 2025 / DiLink 5 user's
Диагностика BYD report: `EnergyConsumption(_id, month, date, start_timestamp[sec],
end_timestamp, is_deleted, duration, trip[km], electricity[kWh], fuel)` — no SOC columns.

**Still missing — the APK sender (`BYDMate-own`):** after `HistoryImporter.syncFromEnergyData()`
imports locally, POST new records to `/api/bydmate/trip-summaries` (same
`X-Api-Key`/`X-Vehicle-Id` headers as telemetry; body = array of
`{ start_timestamp, end_timestamp, distance_km, energy_kwh, duration_seconds }`, epoch
seconds; watermark on max `start_timestamp` already synced; only when data source =
ENERGYDATA, to avoid double-trips on ADB cars that also run telemetry). Ship as the next
VoltFlow Mate release.

**Docs/onboarding follow-up (web, not yet done):** replace the flat "ADB required on
DiLink 5" with: "check whether your car writes energydata via the «Диагностика BYD»
button (VoltFlow Mate v0.4.6+) — if yes, trips/consumption sync without ADB; live data
still needs ADB."

**Limits (both today and after the APK sender ships):** no live snapshots → live cockpit
stays empty; charging stays manual; no SOC per trip (`soc=-→-`). Trips + consumption
history only.

---

## Notes / smaller debt

- **Overlapping tariff columns on `profiles`:** legacy `default_price_per_kwh` coexists
  with `home/commercial_ac/fast_dc_price_per_kwh`. The legacy column could be retired.
- **`numeric` for telemetry** that doesn't need exact decimals — `real`/`double precision`
  would be smaller/faster (lat/lon already use `double precision` — inconsistent).
- **Client `isJunkTrip` vs server discard** are out of sync (server is authoritative);
  sync Rules B/C into `trip-filter.ts` only if phantoms surface in the UI. See
  [docs/TRIPS.md](docs/TRIPS.md).
