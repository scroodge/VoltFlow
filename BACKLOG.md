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

## ⛔ APK: no-ADB basic mode — INVESTIGATED, NOT VIABLE on Yuan UP (2026-07-02)

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

## 🟡 energydata trip-summary cloud sync (for models that HAVE the file)

**Proposed, not built.** For cars that do write `/storage/emulated/0/energydata`
(Leopard 3 and similar — NOT Yuan UP), make no-ADB basic mode work **end-to-end into
VoltFlow**, not just locally in the Mate app.

**Already in the fork (inherited upstream, works today, no ADB):**
`EnergyDataReader.kt` (reads `EnergyConsumption`: start/end ts, duration, km, kWh) →
`HistoryImporter.syncFromEnergyData()` → local Room DB + Compose UI; `ENERGYDATA|DIPLUS`
source switch in Welcome/Settings.

**Missing — the cloud half (both repos):**
1. **APK:** after `syncFromEnergyData()`, POST new records to VoltFlow (same API-key auth
   as telemetry; watermark = max `start_timestamp` synced; retry queue). Only when data
   source = ENERGYDATA, to avoid double-trips on ADB cars.
2. **Web:** new `POST /api/bydmate/trip-summaries` → upsert trips with a
   `source='byd_energydata'` marker + unique `(user_id, vehicle_id, started_at)` dedupe.
   These are **per-trip aggregates** (no samples, no GPS route) — bypass
   `bydmate_ingest_telemetry` and its junk rules; `distance_km` is already per-trip. Needs
   a small migration (source column or separate import table merged in UI).
3. **Web UI:** trips list badge ("BYD log"), no-route/no-chart empty states.
4. **Docs/onboarding:** "If your BYD writes energydata (Leopard 3…), basic mode works
   without ADB; Yuan UP requires ADB."

**Limits:** no live snapshots → live cockpit stays empty; charging stays manual. Trips +
consumption history only.

**Recommendation:** defer until at least one real user has such a car — zero benefit to
the current Yuan UP user base. Build on explicit go-ahead.

---

## 🟢 Settings → Provider preset select always shows "Manual values"

**Requested 2026-07-06.** Choosing **Malanka** in Settings → Economics → Provider
preset fills the price fields correctly (0.55 / 0.55 / 0.73 — the Malanka preset
applied fine) but the select immediately shows **"Manual values"** again, so it
looks like the choice failed.

**Root cause (verified in `src/components/settings/settings-view.tsx:1202`):** the
`Select` is hardcoded to `value="custom"`. It's a controlled component pinned to
"Manual values" — `onValueChange` fires `applyProviderPreset` (prices + hint toast)
and the select snaps straight back. The preset choice is never stored anywhere;
only the three prices are.

### Options

- **A — derive the select value from the prices (recommended, no migration).**
  Replace the hardcoded `value="custom"` with a `useMemo` that reverse-matches the
  current tariff state (`homePricePerKwh`, `commercialAcPricePerKwh`,
  `fastDcPricePerKwh`) against `PROVIDER_TARIFF_PRESETS` (epsilon compare, first
  match, else `"custom"`). All preset triples are distinct today.
  - Pick Malanka → `applyProviderPreset` sets the state → select shows **Malanka**
    immediately.
  - Reload → the profile-load effect fills the same state → still matches → still
    shows Malanka. Persistence for free, since `handlePriceSave` writes the same
    three columns.
  - Save manual non-preset values → state updated on save → back to "Manual values".
  - Caveat: manually retyping the exact preset numbers also shows the provider name
    (harmless — identical prices), and editing a field *without saving* doesn't flip
    the select back until save (inputs are uncontrolled `defaultValue`).
- **B — persist a real `profiles.default_provider_type` column.** New migration,
  save/load wiring, and `resolveSessionTariff` could then label sessions with the
  provider. More truthful model, but nothing downstream needs it today — cost math
  runs off the three prices. Overkill for this complaint; revisit if per-provider
  session labeling is ever wanted.

**Recommendation: A.** One `useMemo` + one prop change in `settings-view.tsx`;
no schema, no i18n keys.

**Verify:** `npm run lint`, `npm run build`; manual: pick Malanka → select shows
Malanka + fields fill → Store default → reload → select still shows Malanka; edit a
price → save → select shows Manual values.

---

## Notes / smaller debt

- **Overlapping tariff columns on `profiles`:** legacy `default_price_per_kwh` coexists
  with `home/commercial_ac/fast_dc_price_per_kwh`. The legacy column could be retired.
- **`numeric` for telemetry** that doesn't need exact decimals — `real`/`double precision`
  would be smaller/faster (lat/lon already use `double precision` — inconsistent).
- **Client `isJunkTrip` vs server discard** are out of sync (server is authoritative);
  sync Rules B/C into `trip-filter.ts` only if phantoms surface in the UI. See
  [docs/TRIPS.md](docs/TRIPS.md).
