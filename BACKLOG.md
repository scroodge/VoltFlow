# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

---

## 🟡 Real article popularity (view counter) for the knowledge base

Follow-up to the KB navigation work (see CHANGELOG 2026-07-13). "Популярные статьи" was
removed because no popularity signal existed; home now shows honest "Недавно обновленные".
This adds the missing signal so "Популярные" can come back as a true statement.

### Data ownership — needs confirmation before building (per the AGENTS.md change gate)

Two different things, two different homes:

- **The counts themselves are app-owned aggregate content metrics → Postgres.** They are
  not per-user preference data, so the "prefer client-side storage" default does not apply.
- **"Have I already counted this article in this session?" is per-user → `localStorage`.**
  Used purely to stop a refresh from inflating the count. Never sent to the DB.

**Please confirm both before I build.**

### The trap that shapes the design

`knowledge_articles` has a `BEFORE UPDATE` trigger, `set_knowledge_articles_updated_at`,
which sets `updated_at = now()` (migration `20260516120000_knowledge_cms.sql:96`). So a
`view_count` column on that table, incremented with an `UPDATE`, would **bump `updated_at`
on every single view** — silently turning the "Недавно обновленные" list into "most
recently *viewed*". Any design that writes to `knowledge_articles` has to defeat that
trigger. The cleanest answer is not to write to that table at all.

Second constraint: the KB is **public** (`"Everyone can read published articles"` grants
`select` to `anon`). There is no `anon` write policy, and adding one is not something to do
casually — RLS cannot restrict *which column* an update touches, so an `anon UPDATE` policy
on `knowledge_articles` would let anyone rewrite article bodies. A `SECURITY DEFINER` RPC
that only touches the counter is the safe way to let anonymous readers increment.

### Options — where the count lives

1. **Separate `knowledge_article_views` counter table (recommended).**
   `article_id uuid primary key references knowledge_articles(id) on delete cascade`,
   `view_count bigint not null default 0`, `last_viewed_at timestamptz`. Incremented by a
   `SECURITY DEFINER` RPC (`increment_knowledge_article_view(p_slug text)`) that upserts.
   `knowledge_articles` is never written to, so the `updated_at` trigger — and the recency
   list — stay correct by construction. One extra join (or a second small query) to read
   counts. No RLS hole: `anon` gets `execute` on the RPC only.
2. **`view_count` column on `knowledge_articles`.** Fewer moving parts to read, but it must
   defeat the `updated_at` trigger — either by rewriting the trigger to skip when only
   `view_count` changed, or by having the RPC restore the old `updated_at`. Both are the
   kind of subtlety that breaks quietly a year later, and it puts a hot write path on the
   content table.
3. **Event table, one row per view** (`article_id`, `viewed_at`, coarse source). Enables
   real trending ("популярное за месяц") and later analytics. But it grows without bound and
   needs its own retention/prune job — and this project is actively working *down* Supabase
   egress/storage and is on Vercel's free tier. Wrong default at current scale; option 1
   can be upgraded to this later if trending is ever wanted.

### Options — how the view is recorded

- **a. Client POST after render (recommended).** The article page fires a one-shot
  `POST /api/knowledge/articles/[slug]/view` from the client, guarded by a
  `localStorage` set of already-counted slugs (per session/day). The route uses the service
  role to call the RPC. Survives Next.js caching, does not count prefetches, and bots that
  do not run JS are excluded for free.
- **b. Increment during the server render.** One line, but wrong: Next prefetch and
  crawlers would inflate it, it cannot dedupe a refresh, and it puts a DB write in the
  render path of a cached page.

### Using it

Bring back a **"Популярные"** section on home, sorted by `view_count` desc — but only once
there is data: with every count at 0 the list is meaningless. Guard it — show "Популярные"
only when the top article has, say, ≥ 5 views, otherwise keep "Недавно обновленные". Never
re-introduce a label the data cannot back.

**Recommendation:** option **1 + a**. One idempotent migration (`IF NOT EXISTS`, per the
self-hosted rules), one RPC, one API route, one small client hook, and a guarded home
section. No change to `knowledge_articles`, so nothing I shipped today regresses.

Proposed 2026-07-13; awaiting go-ahead.

---

## 🟡 Separate car model from generation and choose model-specific dashboard art

The `cars` table currently stores only `model_generation` (`gen1_2024` or
`gen2_2025`), which is insufficient for users with Yuan Plus, Dolphin, Seal, or
another vehicle. The dashboard image mapping therefore cannot safely distinguish a
Yuan UP from another model.

**Options:**

1. Add a `model_key` column to `cars` with a constrained app-supported enum, default
   existing rows to `yuan_up`, expose the model selector in the car form, and map
   dashboard art by `model_key` while keeping generation separate — explicit,
   backwards-compatible, and safe for future model images.
2. Infer the model from the user-entered nickname — no migration, but unreliable and
   would show incorrect artwork for names like “Family car”.
3. Keep Yuan UP art for every car — no code or schema work, but misleading for every
   non-Yuan-UP vehicle.

**Recommendation:** option 1. Add an idempotent migration for `cars.model_key` with
   `yuan_up` as the existing-row default, define the allowed model keys in shared
   TypeScript, add localized model labels and a required Settings/car-form selector,
   and use a generic car icon when a model has no image. Keep `model_generation`
   independent because generation applies within a model. Existing RLS remains
   user-scoped; verify the migration, create/update flows, dashboard fallback, and
   localized settings labels before applying it to production.

Proposed 2026-07-12; awaiting go-ahead.

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
