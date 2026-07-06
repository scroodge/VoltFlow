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

## 🟢 Editable provider tariffs + auto-save GPS point after manual provider pick — BUILT, see CHANGELOG

**Requested 2026-07-06** (chosen over just fixing the settings preset select). Two parts:

**(1) Provider tariffs become user-editable.** Today they're hardcoded in
`PROVIDER_TARIFF_PRESETS` (`src/lib/charging-tariffs.ts`, Belarus 2026 baseline);
if Malanka changes prices the user can't do anything. Per-user overrides, hardcoded
values remain the default.

**(2) Auto-save a GPS tariff point after a manual provider pick during a charge.**
When the user selects a provider on the active charge screen, remember the spot in
`charging_tariff_locations` **in the background, ~5 min later** (not instantly — the
user may still be flipping through providers, and a mis-tap shouldn't pollute saved
locations). Next charge at that spot then auto-applies the provider with no manual
step.

### Part 1 — editable provider tariffs

**Schema (new migration, idempotent):** table `public.provider_tariffs`
- `user_id uuid` FK → auth.users cascade, `provider_type public.charging_provider_type`,
  PK `(user_id, provider_type)`
- `commercial_ac_price_per_kwh numeric ≥0`, `fast_dc_price_per_kwh numeric ≥0`,
  `home_price_per_kwh numeric ≥0` (kept for shape; presets today all have home = AC
  for commercial providers), `created_at/updated_at` + `set_updated_at` trigger, RLS
  select/insert/update/delete own. **No seed rows** — absence = code preset.

**Lib:** `resolveTariffPrice(tariffType, profile, providerType, overrides?)` and
`resolveSessionTariff({ …, providerTariffs? })` take an optional
`Partial<Record<provider, {home, commercial_ac, fast_dc}>>`; lookup order:
user override → hardcoded preset. Location `price_per_kwh_override` still wins
over everything (unchanged).

**Server call sites (each already batch-queries profile + locations — add one query):**
- `src/actions/sessions.ts`: `startChargingSession` (~68), `syncChargingSessionTariffFromGps` (~297)
- `src/lib/bydmate/charging-auto-session.ts`: `resolveTariffForTelemetry` (~72)

**Client call sites (new `useProviderTariffsQuery` hook + query key):**
- charge screen `applyProviderPresetPrice` (`charging-session-screen.tsx:325`)
- dashboard park estimate (`dashboard-view.tsx:856`)
- settings `applyProviderPreset` (`settings-view.tsx:440`)

**Settings UI:** replace the confusing **"Provider preset" dropdown** in Economics
defaults with a **"Provider tariffs" editor**: one row per provider (malanka, evika,
forevo, zaryadka, batterfly — custom excluded, home lives in Economics defaults):
AC + DC price fields (home column saved = AC, matching today's preset shape),
per-row save + "reset to default" (deletes the row). New i18n keys in **ru
(defaultLocale!), en, be**.

### Part 2 — delayed GPS point save

**Schema (same or second migration):** `charging_sessions.tariff_selected_at
timestamptz` — set by `updateChargingSessionTariff` whenever the user manually
saves a tariff. Re-selection resets the 5-min clock. No "saved" flag needed —
dedupe below makes the save idempotent.

**New server action `persistManualTariffLocationFromSession(sessionId)`:**
1. Session must be **still `charging`**, `tariff_manual = true`, `provider_type ≠
   'custom'`, `tariff_selected_at ≥ 5 min ago` (server re-validates; constant
   `TARIFF_LOCATION_AUTOSAVE_DELAY_MS`). If the user unplugs before 5 min → nothing
   saved (deliberate: too short to be worth memorizing, and the car may move).
2. GPS: latest Mate live-snapshot location for the session's user/vehicle (car is
   stationary while charging); fallback to client-passed browser coords.
3. Dedupe via `matchNearestTariffLocation`: existing point covering the coords with
   the **same provider → skip**; **different provider → update** that point's
   `provider_type`/`tariff_type` (user corrected the spot). Otherwise **insert**:
   name `PROVIDER_LABELS[provider]` (+ " 2", " 3"… on name collision), session's
   `tariff_type`, default radius 150 m, **no price override** (provider price
   comes from Part 1, so a later tariff edit propagates).
4. Returns what happened so the client can toast ("Point saved — Malanka will
   apply here automatically").

**Trigger:** `ChargingSessionBackgroundSync` (global in `MobileShell`, already owns
the ~1 Hz session loop) checks every ~30 s: active session with `tariff_manual`,
`provider ≠ custom`, `tariff_selected_at` past the delay → fire the action once per
selection (in-memory guard per `sessionId+tariff_selected_at`; server dedupe makes
retries harmless). Survives navigation away from the charge screen; PWA closed the
whole 5 min → skipped (acceptable; next manual pick at the same spot retries).

**Interaction with auto-tariff GPS sync:** unchanged — `syncChargingSessionTariffFromGps`
skips `tariff_manual` sessions, so the new point takes effect from the *next*
session onward.

**Tests:** pure-logic `.test.mjs` for the override lookup (`resolveTariffPrice` /
`resolveSessionTariff` with `providerTariffs`) and for the persist decision
(too-early / unplugged / dedupe-same / dedupe-different / insert).

**Migrations note:** self-hosted prod → apply via pooler psql (no CLI), keep
`IF NOT EXISTS`-idempotent.

**Verify:** `npm run lint`, `npm run build`, `npm run test`; manual: pick Malanka
during a charge → after ~5 min a "Malanka" location appears in Settings → edit
Malanka AC price → next session at that spot uses the edited price.

---

## ⛔ Settings → Provider preset select always shows "Manual values" — SUPERSEDED

**Superseded by the plan above (2026-07-06):** the confusing dropdown gets replaced
by the editable provider-tariffs card, so this fix won't be built separately.
Kept for the root-cause record.

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

---

## 🟢 Inactive account auto-cleanup — DECIDED, building

**Decision (2026-07-06):** 30-day inactivity → Resend warning email → 60-day auto-deletion.
Premium users exempt. See full plan in [dev session](#).

### Work items

**1. Migration** `20260706120000_profiles_inactivity_cleanup.sql`:
`last_active_at timestamptz`, `inactivity_warning_sent_at timestamptz` on `profiles`.

**2. Track activity** — telemetry route (`route.ts:250`) + login server action (`src/actions/activity.ts`).

**3. Email infra** — `npm install resend`, `src/lib/email/inactivity-warning.ts`.

**4. Cron route** — `POST /api/cron/inactivity-check` (CRON_SECRET gated), sends
warning emails + deletes accounts via `supabaseAdmin.auth.admin.deleteUser()`.

**5. Policy updates** — privacy + terms (world + belarus) × 3 locales.

**6. Self-service deletion** — settings "Delete account" card + server action.

**7. Contabo crontab** — daily `curl` to the cron route.

---

## Notes / smaller debt

- **Overlapping tariff columns on `profiles`:** legacy `default_price_per_kwh` coexists
  with `home/commercial_ac/fast_dc_price_per_kwh`. The legacy column could be retired.
- **`numeric` for telemetry** that doesn't need exact decimals — `real`/`double precision`
  would be smaller/faster (lat/lon already use `double precision` — inconsistent).
- **Client `isJunkTrip` vs server discard** are out of sync (server is authoritative);
  sync Rules B/C into `trip-filter.ts` only if phantoms surface in the UI. See
  [docs/TRIPS.md](docs/TRIPS.md).
