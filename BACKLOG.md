# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

---

## 🟢 Telegram live-widget chat-list summary — APPROVED 2026-07-10

**Goal:** keep the complete editable vehicle-status widget in the bot chat while
showing a useful compact value in Telegram's chat list.

**Constraint:** Telegram has no independent chat-list-preview field for a bot
message. The chat list renders the beginning of the latest message, so the
first line of the existing editable widget is the only reliable control point.

**Options:**

1. **Compact first line (recommended):** prepend `🔋 79% · P 41 694 км`, then
   retain the car name/state, SOC bar, charging details, map link, and button
   below. The chat list stays current because the same message is edited every
   30 seconds.
2. **Separate short message:** would make the list compact, but it would
   clutter the conversation and leave the live widget no longer latest.
3. **Keep the current header:** preserves the current widget order, but the
   chat list continues to truncate the car/state instead of showing SOC and
   mileage.

**Recommendation:** option 1. User explicitly approved build and production
deployment on 2026-07-10.

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

## ✅ DiLink 5 full data collection — DONE 2026-07-09

See [CHANGELOG](CHANGELOG.md) for full details. All 3 phases shipped + applied to prod.
APK-side (BYDMate-own repo) still needs implementation for autoservice Binder reads.

---

### energydata trip-summary cloud sync — web + APK halves DONE, docs follow-up pending

**Web half shipped 2026-07-06, APK half shipped 2026-07-08** (VoltFlow Mate v0.4.7,
`TripSummaryCloudSync` in BYDMate-own) — see [CHANGELOG](CHANGELOG.md). Migration
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
