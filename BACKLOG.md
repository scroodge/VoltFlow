# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

---

## Math Distance: rolling ~50 km efficiency window (vehicle page)

### Scope

**Only the "Math Distance" estimate** (`mathRangeLabel` = `kmPerPercentSoc × SOC`,
`src/components/vehicle/vehicle-live-view.tsx:400`). The separate **"AI Distance"**
estimate (`useVehicleRangeEstimate`) is untouched. The change lives entirely in
`resolveKmPerPercentSoc` (`src/lib/bydmate/hero-drive-metrics.ts:118`).

### Problem

Today `kmPerPercentSoc` is keyed off the **single latest trip**:

1. Primary: `tripDistance / socDelta` (needs `socDelta ≥ 1%`).
2. Fallback: `batteryCapacityKwh / consumption_kwh_100km` (nameplate capacity, single
   trip's consumption).

The latest trip is frequently a junk micro-trip (0 km / 0 % drop), which knocks the
primary path out and drops to raw live consumption. Verified live: the most recent
`way` trip is a 31 s, 0 km, 39→39 % trip, so Math Distance currently runs on the
fallback.

### Two variants considered

- **A — user's proposal (capacity ÷ 50 km consumption):**
  `((capacity/100) / (kWh_last50km/50)) × SOC`. Algebraically this is the *existing
  fallback* (`capacity/consumption`) with consumption measured over a rolling ~50 km
  instead of one trip. `capacity` = the **user-set** `cars.battery_capacity_kwh`
  (not live BMS SOH).
- **B — windowed-percent (recommended):** `Σdistance(last ~50 km) / ΣsocDelta(last ~50 km) × SOC`.
  Same 50 km smoothing, but stays in percent-space, so it needs no capacity number and
  auto-tracks battery degradation.

### Data ownership

No new persisted data. Both variants read existing app-owned trip rows + the user-owned
`cars.battery_capacity_kwh` setting. No schema change, no localStorage change.

### Measured on real `way` data (SOC 69 %, SOH 99 %, capacity 45.1 kWh)

Last ~50 km = 9 trips: Σdist ≈ 52.4 km, Σ SOC-drop = 18 %, Σ energy ≈ 8.13 kWh,
distance-weighted consumption ≈ 15.5 kWh/100 km.

| Formula | km/% | Math Distance @ 69 % |
|---|---|---|
| Today (single-trip fallback, cur. cons 15.92) | 2.83 | ≈ 196 km |
| A — capacity ÷ 50 km consumption | 2.91 | ≈ 201 km |
| B — windowed-percent | 2.91 | ≈ 201 km |

A and B are identical at 99 % SOH (`Σenergy/ΣSOC` = 0.452 ≈ `capacity/100` = 0.451).
They diverge only as SOH falls: B self-corrects; A stays optimistic until the user edits
the capacity setting.

### Recommendation

Adopt **B (windowed-percent)** as the primary, keep **A (capacity ÷ rolling consumption)**
as the last-resort fallback when no usable `socDelta` exists in the window. Net win:
kills the junk-micro-trip fragility and never depends on a stale capacity setting.

### Open questions before build

- **Window definition:** walk trips back until cumulative distance ≥ ~50 km (drop
  charging gaps? cap age, e.g. ignore trips older than N days?).
- **50 km energy source (variant A path):** distance-weighted `avg_consumption_kwh_100km`
  vs. `traction_energy_kwh − regen_energy_kwh`; they can disagree — pick and document one.
- **Small-data guard:** if the window has <X km or ΣsocDelta <1 %, fall back to today's
  behavior rather than divide by noise.

---

## Telegram community marketplace for `@Voltflowscr_bot`

### Goal

Turn relevant posts from the BYD Telegram group into searchable, temporary
community listings without mixing them into the curated VoltFlow knowledge base:

- `Продам` / `есть в наличии` → seller offer;
- `Куплю` / `ищу` / `нужен` → buyer request;
- technical questions → existing knowledge-base search;
- unrelated or unsafe messages → ignored or moderation queue.

### Current repo facts

- `@Voltflowscr_bot` already has a webhook path at `/api/telegram/webhook`.
- `bot.voltflow.life` already proxies Telegram auth, link, and webhook traffic because
  Vercel may serve a Security Checkpoint before Next.js runs.
- The webhook currently responds only to `/start`, `/app`, and empty messages.
- The knowledge base already has OpenAI embeddings, pgvector/HNSW search, source-type
  filtering, generation filtering, and confidence rules.
- The repository explicitly describes Telegram group import as a future phase.

### Options and recommendation

#### Option A — Extend the existing bot edge and Next.js pipeline (recommended)

Telegram delivers updates to `bot.voltflow.life`; the Python edge verifies the Telegram
secret and forwards group-message events to a private Next.js ingestion endpoint. The
Next.js endpoint classifies, normalizes, moderates, stores, embeds, and expires listings.

Pros: reuses the existing bot, proxy, deployment, secrets, and OpenAI/vector search;
keeps business logic in the main codebase; easiest to test with the existing bot.

Trade-off: the bot must be added to the test group, made an administrator or given the
needed message visibility, and Telegram privacy settings must allow the intended group
messages to reach it.

#### Option B — Separate Python marketplace worker on `bot.voltflow.life`

The Python edge stores and classifies group messages itself, then syncs records to
Supabase. This isolates Telegram traffic but duplicates validation, retries, OpenAI,
and database logic. It is not recommended for the first version.

#### Option C — Import only manually forwarded messages

An admin forwards selected messages to the bot, which turns them into listings. This is
the safest moderation path but does not provide automatic group matching.

Build Option A in stages: observe and classify first, publish only admin-approved
listings second, then add expiry and matching, and finally optional notifications.

### Approved implementation increment: Ollama context verification

The user approved building the first increment one function at a time. OpenAI
embeddings remain unchanged (`text-embedding-3-small`, `vector(1536)`). Ollama is
used only for Telegram-message context verification and structured extraction:

- configurable OpenAI-compatible client using `LLM_BASE_URL`, `LLM_MODEL`,
  `LLM_API_KEY`, and `LLM_MAX_TOKENS`;
- strict JSON result for intent, confidence, title, item type, city, generation,
  price, and moderation decision;
- deterministic checks remain the first safety layer;
- ambiguous or failed verification becomes a draft/review result, never automatic
  publication;
- unit-test the verifier before wiring it into Telegram ingestion;
- preserve existing `/start`, `/app`, and Mini App behavior.

Ownership: verification output is app-owned operational data in Postgres when it is
later attached to a Telegram event; no user preference or localStorage data is
introduced by this increment.

### Proposed data model

Create an app-owned Postgres table `community_listings`:

| Field | Purpose |
|---|---|
| `id` | Listing identity |
| `owner_user_id`, `telegram_user_id` | Author ownership and attribution |
| `listing_type` | `sell` or `wanted` |
| `title`, `description` | Normalized public text |
| `item_type` | `accessory`, `spare_part`, `service`, `car`, or `other` |
| `category`, `model_generations`, `city` | Search and hard filters |
| `price`, `currency` | Optional price |
| `contact_link` | Telegram/message/contact destination |
| `source_chat_id`, `source_message_id` | Deduplication and source link |
| `status` | `draft`, `published`, `sold`, `expired`, `removed` |
| `expires_at` | Automatic listing expiry |
| `embedding` | Semantic matching vector |

The normalized listing is user-owned content in Postgres and must be editable and
deletable by its author. The original Telegram update should not become permanent
knowledge content. Store only the minimum source identifiers needed for attribution,
moderation, deduplication, and a Telegram deep link; keep raw message payloads out of
the public table or retain them only briefly in a restricted moderation table.

### Search and matching

- Add source type `market_listing` to the existing vector-search contract.
- Keep curated knowledge and marketplace results as separate result groups.
- Technical question → knowledge; buy/search intent → wanted requests and seller offers;
  broad queries → both with clear labels.
- Match buyer requests to active seller offers using embedding similarity plus hard
  filters for item type, generation, city, status, and expiry.
- Never match or publish expired, sold, removed, or unmoderated records.

### Moderation, privacy, and expiry

- First release stores all detected posts as `draft`.
- Admin can approve, edit, reject, mark sold, or remove a listing.
- Use deterministic intent cues first (`продам`, `куплю`, `ищу`, `нужен`, prices,
  contact handles); use an optional structured model classifier only for ambiguous text.
- Do not expose phone numbers or personal metadata beyond what the author chose to
  publish; provide a delete/report path.
- Deduplicate edits and repeated forwards by chat/message identity.
- Expire listings after 30 days initially, with a renewal action.
- Delete the derived embedding when the listing is deleted.

### Test deployment

- Use `@Voltflowscr_bot` and the existing `bot.voltflow.life` edge service.
- Add the bot to a private test group and configure the webhook with the current
  secret-token check.
- Start with an observe-only flag so no public listing is created accidentally.
- Test edits, replies, media/captions, forwards, deleted messages, duplicate updates,
  `/start`, and group privacy behavior before enabling publishing.

### Data ownership decision required before build

- **Normalized listing:** user-owned, Postgres, author can edit/delete it.
- **Moderation/source metadata:** app-owned operational data, restricted Postgres,
  minimum retention needed for audit and deduplication.
- **Raw Telegram message text:** recommendation is not to retain it permanently;
  keep only a short-lived restricted copy if moderation requires it.
- **Embeddings:** app-owned derived search data, deleted with the listing.

### Acceptance criteria

- A test-group `Продам` post becomes a draft seller listing with source link.
- A test-group `Ищу` post becomes a draft buyer request.
- Technical questions route to curated knowledge search and do not become listings.
- Admin approval creates the public listing and its embedding.
- Search returns curated knowledge and active community offers in clearly separated sections.
- Matching respects generation, city, status, and expiry filters.
- Author deletion removes the listing and its embedding.
- No raw group message is publicly exposed by default.

---

## 🟠 Domain migration → voltflow.life — leftovers (optional, not blocking)

Phases 0–3 **shipped** (canonical domain, frontend URLs, backend infra, and the Mate
one-shot settings migration built + verified on car `way`) — see [CHANGELOG.md](CHANGELOG.md).
The two Mate commits (`7b37366` vehicle_id fix, `e2cd59b` domain migration) are **local,
unpushed** — a formal Mate release still follows the `/release-apk` skill (version bump +
post-install telemetry verification).

Remaining items are optional and none block anything:

- **Serve `/api/bydmate/*` directly on the old host.** Today every telemetry sample is a
  `308` + a re-issued POST. Flipping `volt-flow-beige.vercel.app` to *Connect to an
  environment → Production* and moving the redirect into `src/proxy.ts` with a path
  exemption would halve the request count. Efficiency, not correctness.
- **Vercel Attack Challenge Mode is intermittently ON** (`x-vercel-mitigated: challenge`),
  which challenges every non-browser client. It is the reason Telegram traffic detours via
  `bot.voltflow.life`. A WAF bypass for `/api/bydmate/*` would be healthier than routing
  around it.
- **Push subscriptions are origin-scoped.** A user who reinstalls the PWA from the new
  origin gets a *second* subscription → possible duplicate charge notifications until the
  old one expires. Worth a dedupe pass.
- **No `sitemap.ts` / `robots.ts`** — the marketing + knowledge pages have no canonical host
  declared for SEO.

---

## 🟡 Knowledge base content gaps (two missing articles)

The 12-query relevance eval (`npm run search:eval`) passes 12/12 — but two of those pass by
*correctly admitting we have no answer*:

- **«как заряжать зимой»** — the corpus has no winter-charging article. The closest match is
  *Зимняя омывающая жидкость* (winter washer fluid, 0.417), which is why search used to hand
  it over as an answer.
- **«чем отличается AC от DC»** — no AC-vs-DC explainer exists.

Both are questions a real BYD owner will certainly ask. The search side is now handled (it
says "Точного ответа не нашлось" instead of bluffing), so **this is a content task, not a
code task**: writing the two articles turns both cases from "honest miss" into "hit".

When they exist, flip their `expect` in `scripts/knowledge-search-eval.mjs` from `null` to
the new titles — the eval will then hold them to the same standard as everything else.

Optional, and deliberately deferred: **hybrid search** (vector + Postgres full-text, RRF
fusion). It is the textbook cure for "matched one adjective, ignored the topic". But at 19
documents with a 10/12 top-1 hit rate, the measurement says retrieval is not the bottleneck
— content is. Revisit if the corpus passes ~100 items or the eval regresses.

Proposed 2026-07-14; content work, no go-ahead needed from an engineering standpoint.

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
