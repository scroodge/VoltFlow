# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

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

## 🟡 DiLink 5 full data collection — 3-phase plan, go-ahead 2026-07-08

Audit confirmed on real user `konev.alexey@gmail.com` (Yuan UP 2025, 874 trips synced).
Full AndyShaman parity plan in 3 phases. See also `BACKLOG` energydata section below.

### Phase 1: energydata completeness (no ADB) — IN PROGRESS

| # | File | Change |
|---|------|--------|
| 1 | `supabase/migrations/...sql` | Add `fuel_kwh` column to `bydmate_trips` |
| 2 | `src/lib/bydmate/trip-summary-payload.ts` | Add `fuel_kwh` optional field to Zod schema |
| 3 | `supabase/migrations/...sql` (RPC) | Parse + store `fuel_kwh` in `bydmate_ingest_trip_summaries` |
| 4 | `src/types/database.ts` | Add `fuel_kwh?: number \| null` to `BydmateTripRow` |
| 5 | `src/components/history/history-view.tsx` | Show fuel in `TripStatsGrid` when > 0 |

APK side (BYDMate-own repo):
- `EnergyDataReader.kt`: add `fuel` to `BydTripRecord`
- `HistoryImporter.kt`: include `fuel_kwh` in trip entity
- Cloud sync sender: POST `fuel_kwh`, filter `is_deleted` rows

### Phase 2: autoservice Binder reads (ADB required)

New autoservice FID fields to read via `service call autoservice`:

| Field | FID | Description |
|-------|-----|-------------|
| `soh_percent` | `FID_SOH` | BMS State of Health |
| `power_kw` | `FID_ENGINE_POWER` | Signed engine power (replaces Di+) |
| `charge_gun_state` | `FID_GUN_CONNECT_STATE` | Gun state (replaces Di+) |
| `kwh_charged_bms` | `FID_CHARGING_CAPACITY` | Per-session BMS counter |
| `odometer_bms_km` | `FID_LIFETIME_MILEAGE / 10` | BMS-authoritative odometer |
| `lifetime_kwh` | `FID_LIFETIME_KWH` | Total energy throughput |
| `battery_type` | `FID_BATTERY_TYPE` | LFP vs NCM |
| `charge_battery_volt` | `FID_CHARGE_BATTERY_VOLT` | Charger HV voltage |

APK: implement `FidRegistry.kt` + `AutoserviceClient.kt` reads
Web: migration + telemetry route + UI updates

### Phase 3: advanced collection

- Battery snapshots on charge end (SOC delta ≥ 5%)
- Idle drain table for zero-km trips
- Catch-up charge reconstruction (cascade A/B/C with SOH)
- Odometer-based trip energy (BMS `totalElecConsumption` delta)

---

### energydata trip-summary cloud sync — web half DONE, APK half pending

**Web half shipped 2026-07-06** — see [CHANGELOG](CHANGELOG.md). Migration
`20260706190000_bydmate_trip_summary_source.sql` (`bydmate_trips.source` +
`bydmate_ingest_trip_summaries` RPC, applied to prod) + `POST /api/bydmate/trip-summaries`
+ "BYD log" trip badge.

**Audit 2026-07-08:** Real user `konev.alexey@gmail.com` — 874 trips, 8,330 km synced.
EC_database.db schema: `_id, month, date, start_timestamp, end_timestamp, is_deleted,
duration, trip, electricity, fuel`. Gap: `fuel` column not sent. Phase 1 fixes this.

**Docs/onboarding follow-up (web, not yet done):** replace the flat "ADB required on
DiLink 5" with: "check whether your car writes energydata via the «Диагностика BYD»
button (VoltFlow Mate v0.4.6+) — if yes, trips/consumption sync without ADB; live data
still needs ADB."

---

## Notes / smaller debt

- **Overlapping tariff columns on `profiles`:** legacy `default_price_per_kwh` coexists
  with `home/commercial_ac/fast_dc_price_per_kwh`. The legacy column could be retired.
- **`numeric` for telemetry** that doesn't need exact decimals — `real`/`double precision`
  would be smaller/faster (lat/lon already use `double precision` — inconsistent).
- **Client `isJunkTrip` vs server discard** are out of sync (server is authoritative);
  sync Rules B/C into `trip-filter.ts` only if phantoms surface in the UI. See
  [docs/TRIPS.md](docs/TRIPS.md).
