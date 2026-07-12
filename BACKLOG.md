# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

---

## 🟡 Currency-aware defaults for Settings → Economics tariff prices

**Problem:** every tariff price field (`profiles.default_price_per_kwh`,
`home_price_per_kwh`, `commercial_ac_price_per_kwh`, `fast_dc_price_per_kwh`) defaults
to a flat **`0.12`** in the database (migrations `20260512100000_profiles_default_tariff.sql`,
`20260617111000_three_tariff_and_location_presets.sql`), regardless of currency. The
built-in `PROVIDER_TARIFF_PRESETS` (`src/lib/charging-tariffs.ts`) are the same flat
numbers (e.g. `home: 0.15, commercial_ac: 0.54, fast_dc: 0.54`) reused across all 4
currencies. `handleCurrencyChange` (`settings-view.tsx:717`) only persists
`preferred_currency` — it never touches or rescales the price fields. `0.12` is
roughly right for EUR home rates; for BYN, USD, or RUB it's either implausibly cheap or
just the wrong order of magnitude, and nothing in the UI signals that to the user —
they'd have to already know their local rate and manually correct every field.

**Note:** I don't have verified, current real-world electricity tariffs for
BYN/USD/RUB to hardcode — whatever numbers get used here need a sourced check
(official tariff schedules, not a training-data guess) before shipping, same care as
was taken researching the BYN symbol itself.

**Options:**

1. **Reset-on-currency-change prompt (recommended).** When `handleCurrencyChange`
   fires, if the user's current price fields still equal the *previous* currency's
   defaults (i.e. untouched), offer a toast/inline prompt: "Switch tariff prices to
   typical `<newCurrency>` rates?" with an explicit accept — non-destructive, never
   silently overwrites a price the user actually customized.
2. **Per-currency default constants only at account creation.** Infer currency from
   signup locale, seed `profiles` with per-currency defaults once. Simplest, zero
   retroactive-mutation risk — but doesn't help existing users who already picked BYN
   and are sitting on the wrong-scale `0.12`.
3. **Contextual hint, no data mutation.** Show a small "typical home rate: ~X `<symbol>`/kWh"
   next to each price field, sourced per currency, purely informational. Zero risk,
   but doesn't fix the underlying default — just helps users notice it's wrong.
4. **Auto-rescale silently on currency change.** Rejected outright: any heuristic for
   "was this customized" can misfire and silently overwrite a real number the user
   set — a financial field is the wrong place to guess.

**Recommendation:** option 1, with option 3 as a cheap complement regardless of which
path is chosen (helps even before a currency switch, e.g. a first-time BYN user setting
up tariffs from scratch, not just people switching currency later). Needs real sourced
tariff numbers per currency before implementation — flag if you have a source, otherwise
that's a research sub-step before building.

---

## 🟡 Lifetime-map pagination: race-safety vs. round-trip latency

`fetchLifetimeTrackPoints` (`src/lib/vehicle-analytics.ts`) pages through
`bydmate_trip_track_points` via `collectPagedRows` (`src/lib/bydmate/paged-query.ts`),
issuing up to 5 sequential `range()` requests for the default 5,000-point cap (shipped
2026-07-11 to fix the 414 error for long histories — see CHANGELOG). Code review
(2026-07-11) flagged two related issues neither fixed nor urgent enough to block:

1. **Offset drift under concurrent writes:** pages are ordered `device_time desc` with
   numeric `range(from, to)` offsets. If the vehicle is actively driving while the map
   loads, a new track point can land between page fetches and shift every later row's
   offset by one — a boundary row can appear duplicated or a row can be silently
   dropped, showing as a small jog/gap on the rendered polyline. The old single-query
   snapshot didn't have this window.
2. **Sequential round trips reintroduce latency:** 5 awaited-in-order requests instead
   of 1, for exactly the long-history vehicles the 414 fix targeted — risk of a slow
   response or Vercel timeout with no `maxDuration` override on the route.

**Options:**
1. **Keyset (cursor) pagination** — page by `.lt("device_time", lastSeenCursor)`
   instead of numeric offsets. Fixes the drift issue outright (immune to concurrent
   inserts above the cursor) but stays sequential, so it doesn't address latency.
2. **Fire all pages in parallel** (page count is known upfront: `ceil(limit/pageSize)`)
   — fixes latency (~1 round trip instead of 5) but narrows, doesn't eliminate, the
   drift window, and changes `collectPagedRows`'s short-circuit-on-short-page contract
   (would need a rewrite of its existing tests).
3. **Both:** parallel keyset pages aren't compositable (each cursor depends on the
   previous page's last row), so getting both properties needs a different design,
   e.g. a single server-side RPC that snapshots the page.
4. **Leave as-is** — the drift is a rare, cosmetic map glitch; the latency risk is
   real but unmeasured (no report of an actual timeout yet).

**Recommendation:** option 1 (keyset) first if the map glitch is ever reported by a
real user; otherwise leave as-is and revisit if `/api/vehicle/lifetime-map` shows up
slow in practice. Not urgent — awaiting go-ahead.

Related, same review pass: `collectPagedRows` itself isn't reused by the two
pre-existing hand-rolled pagination loops in `src/lib/bydmate/telemetry-history.ts`
and `src/lib/charging-session-reconcile.ts`. Worth migrating those to the shared
helper the next time either file is touched, not as a standalone task.

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
