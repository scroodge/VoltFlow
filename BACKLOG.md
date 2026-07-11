# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

---

## 🟡 Attribute cost to no-charge driving days (energy carried from a prior charge)

**Problem:** `Cost` everywhere in the app (Day/Week/Month "at a glance", period
cost-per-km — `src/lib/history-day-summary.ts`, `src/lib/vehicle-analytics.ts:331-385`)
is anchored entirely to when a charging session's `started_at` falls in the window, not
to when the energy is actually consumed. If a user charges Monday and only drives
Tue–Thu, those three days show `Cost —` even though they're burning paid-for
electricity the whole time — the money is booked entirely on Monday. This is a
**cash-flow view** ("what did I spend today"), not a **consumption view** ("what did
today's driving cost me"). Both are legitimate; only the first exists today.

**Data available:** each `charging_sessions` row has a resolved `price_per_kwh` (via
`resolveSessionTariff` in `src/lib/charging-tariffs.ts` — manual entry, GPS-matched
location preset, or power-tier auto-pick against the user's `user_providers` prices,
which vary a lot: e.g. home ~$0.15/kWh vs fast DC ~$0.6–0.73/kWh) and
`charged_energy_kwh`. Each `bydmate_trips` row has `traction_energy_kwh` (or a
distance × avg-consumption fallback). `cars.battery_capacity_kwh` is a real per-car
column (`not null check (battery_capacity_kwh > 0)`).

**Options:**

1. **Last-known-price carry-forward.** For a no-charge day with `driveKwh > 0`, look up
   the most recent finished session's `price_per_kwh` before that day and estimate
   `cost = driveKwh × lastPrice`. Trivial (one extra query per period, reused across all
   days in it), no schema change.
   - *Trade-off:* assumes the **entire** battery is priced at the last session's rate,
     which is only true right after a full charge. Someone who tops up small amounts at
     wildly different prices (home vs. fast-DC) gets a noisy, sometimes very wrong
     number — e.g. a single expensive fast-DC top-up prices the next two weeks of
     driving at the DC rate even after that energy is long gone.

2. **Trailing blended (weighted-average) rate.** Average `price_per_kwh` over the last
   N sessions or a lookback window (e.g. 30 days), weighted by `charged_energy_kwh`,
   applied to no-charge days the same way as option 1. Smooths outliers, still one
   aggregate query, no schema change, window size is a tunable constant.
   - *Trade-off:* still an approximation — doesn't model actual depletion order, so it
     can't guarantee the sum of daily estimates reconciles to actual total spend over a
     period the way real inventory accounting would.

3. **True weighted-average-cost (WAC) battery ledger** (proper energy-inventory
   accounting, same method used for stock costing). Maintain a running "blended
   price currently in the battery" per vehicle: on each finished charge, new blended
   price = weighted average of (existing battery kWh × existing blended price) and
   (charged kWh × session price); on each trip, debit `driveKwh` at the *current*
   blended price (draws don't change the per-unit price, only future charges do) and
   record that as the trip's imputed cost.
   - *Trade-off:* the accurate answer, and the only option where daily estimates sum
     correctly to real spend — but real cost: a new persisted ledger (table +
     migration), a defined seed/starting state (battery contents before tracking
     began have no known cost basis), strict chronological processing of interleaved
     trips + charges (out-of-order/late telemetry, corrected sessions from
     `reconcileChargingSessionsForUser` would need the ledger recomputed downstream),
     and a backfill for existing history. Meaningfully more surface area than options
     1–2.

4. **Don't retrofit historical Cost at all** — add a separate, clearly-labeled
   "energy currently in battery: ~$X (blended $Y/kWh)" stat on the live/charging
   screen instead, computed live from the same blended-price idea but with no
   historical day/period claim. Doesn't answer "what did today cost me", but doesn't
   touch existing Cost semantics either.

5. **Session walk-back (on-the-fly depletion, no ledger).** For a no-charge day, walk
   backward through finished sessions ordered by `stopped_at`: for each session, check
   whether cumulative `driveKwh` since that session's end has exceeded its
   `charged_energy_kwh`. If not, price the day at that session's `price_per_kwh`. If it
   has, move to the next older session and keep walking (self-terminating in practice —
   battery capacity bounds how many days of driving one charge covers, so this rarely
   walks past 1–2 sessions). Computed live from existing `charging_sessions` +
   `bydmate_trips` rows each request; no new table, no migration, no backfill, no
   recompute pipeline on session correction.
   - *Trade-off:* implicitly LIFO — assumes the *most recent* charge's energy is used
     first. Physically a battery mixes uniformly, so a small expensive top-up onto an
     otherwise-cheap battery will overstate cost for the days right after it (until
     that top-up's kWh amount is "used up" in the walk), and a top-up onto a
     already-near-full battery will understate the cheap energy still underneath it.
     Only true weighted-average (option 3) gets the mixing right — but option 5 is a
     much closer approximation to it than options 1 or 2, at no persistence cost.

**Industry comparison (2026-07-11 research):** no mainstream EV cost tool does
per-session ledger accounting for "what did today's driving cost."
- **Tesla's own trip-cost calculator:** `distance × vehicle efficiency (kWh/100km) ×
  one user-set price/kWh` — a single flat rate, no per-session tracking at all.
- **EV fleet cost-per-mile methodology** (the closest industry analogue to "cost per
  day/trip" reporting): `(kWh/100mi × price/kWh) ÷ 100`, with guidance to manually
  "blend in" a higher rate if public/DC-fast charging is used "regularly" — a coarse,
  human-adjusted blend, not an automated weighted ledger.
- **ABRP:** uses live per-station prices only for *forward* route planning; historical
  cost reporting elsewhere in the category uses the same flat blended rate.
- Nobody productizes option 3's accounting-grade precision — it's solving a problem
  users of these tools don't appear to have. That said, none of them have per-vehicle
  session history with real per-session prices sitting in a database either — they're
  built for one-off trip planning, not tracking a specific car's actual charge log. This
  app already has the data to do better than a flat rate for roughly the same cost as
  computing one.

**Recommendation (revised):** option 5, session walk-back. It reads as a plan/estimate,
not audited accuracy, matching the stated goal — but unlike a flat blended average
(the earlier recommendation here), it uses the actual price of the charge you're most
plausibly still driving on, so a recent fast-DC top-up shows up as more expensive
driving and a recent cheap home charge shows up as cheap driving, instead of smoothing
both into one number. Same "no schema change" property as options 1–2, closer to
option 3's accuracy without its migration/backfill/recompute cost. Show it as a
distinct, clearly labeled **estimated** field, not folded into the existing `Cost`
stat, so actual spend and imputed consumption cost stay visually distinguishable.
Fallback when the walk-back exhausts all session history (e.g. very first days of
account history, before any recorded charge): `defaultPricePerKwh` from the profile,
same fallback already used elsewhere in `history-day-summary-card.tsx`.

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
