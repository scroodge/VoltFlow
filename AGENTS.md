## Agent workflow rule

**Always plan first, never build unasked.**
1. Research the problem.
2. Write the plan here under `## Pending plan` (options, trade-offs, recommendation).
3. Show a short summary and ask the user: "Should I build this?"
4. Wait for explicit go-ahead before writing any code or migrations.

---

## Pending plan

### 🟢 BMS-measured charge energy + derived float charge power (BUILT 2026-06-30)

**Status:** Core **BUILT** (server-side, EvAcChargeTimer). Tests green (57/57 glob +
4/4 auto-session, `tsc --noEmit` clean). Uncommitted working tree.

**Built:**
- `charging-live.ts` `deriveLiveChargingState` — prefers BMS `telemetry.kwh_charged`
  (battery-side) for energy/cost, falls back to the SOC estimate; adds
  `chargedEnergySource: "bms"|"estimate"` to `DerivedChargingState`. New accessor
  `snapshotKwhCharged`. (Feeds live display + ~1 Hz persist via `resolveStateToPersist`.)
- `charging-session-reconcile-logic.ts` — `summarizeSessionTelemetry` now returns
  `maxKwhCharged` (max over the session window, robust to its ~10% intermittency);
  `buildReconciledSessionPatch` uses it as authoritative energy/cost so completed
  sessions are NOT reverted to SOC-math (SOC still drives the % field).
- `deriveChargePowerFromEnergyDeltaKw` (in `charging-live.ts`) — pure, tested helper:
  float charge power = Δkwh_charged ÷ Δt, with a ≥20 s window guard + counter-reset guard.
- Step 1 (ingest persist) was NOT needed — `kwh_charged` already rides the telemetry
  jsonb (verified: 18,258/190,740 `way` samples carry it).
- Tests: +4 in `charging-live.test.mjs`, +3 in `charging-session-reconcile.test.mjs`.

**⚠️ FINDING (2026-06-30) — BMS counter is cell-energy only, NOT suitable for cost:**

Live session validation on car `way` (45.1 kWh pack, AC charging at 4.6 kW per car display):

| Source | kWh / 36 min | vs grid truth |
|---|---|---|
| Car display (4.6 kW × 36 min) | 2.760 kWh | truth |
| **SOC × 45.1 kWh** (6% × 45.1) | **2.706 kWh** | **−2%** ✅ |
| di+ integral (4 kW × 36 min) | 2.400 kWh | −13% |
| BMS `kwh_charged` delta | 1.451 kWh | **−47%** ❌ |

`kwh_charged` = energy into battery **cells only**. ~1.7 kW goes to active battery
thermal management (cooling during charging); this draws from the OBC output but never
reaches the cells and is NOT captured by the BMS counter. Applying `÷efficiency` to the
BMS counter makes cost even more wrong (2.46 kW ÷ 0.9 = 2.73 kW vs truth 4.6 kW).

**Correct formula for cost/grid energy:** `SOC_delta% × user_battery_capacity_kwh / 100`
with **efficiency ≈ 100%**. BYD calibrates their SOC display against charger input (not
net cell energy), so the user's configured capacity already implies grid-side accounting.
Capacity is **per-user** (from `user_service_categories.battery_capacity_kwh` or
equivalent profile field) — never hardcode.

**Implications for built code:**
- `buildReconciledSessionPatch` using `maxKwhCharged` for energy/cost → **understates by
  ~47%**. Should revert to SOC×capacity for cost; BMS counter is display-only.
- `deriveChargePowerFromEnergyDeltaKw` → shows cell-side power (~2.5 kW) while car display
  shows 4.6 kW (grid-side). Misleading on the power display. Wired into
  `useFloatChargePowerKw` in `vehicle-live-view.tsx` + `charging-session-screen.tsx` →
  **revert those UI wires**; keep di+ integer for the power display.
- `kwh_charged` remains useful for: monitoring thermal management load, tracking actual
  cell energy vs grid energy, cell degradation research. Keep it in telemetry/display.
- `chargedEnergySource: "bms"|"estimate"` field — keep for debugging; but don't let "bms"
  path drive cost.

**Remaining / caveats:**
- **Intermittent source:** `kwh_charged` only arrives when autoservice is ON + charging.
  When absent → SOC estimate (unchanged behavior, and SOC×capacity IS the right formula).
- `storedProgressMismatch` (reconcile trigger) still SOC-based → harmless.

**Problem:** A charging session's `charged_energy_kwh` and cost are computed from a
triple estimate in [`charging-live.ts:147-153`](src/lib/charging-live.ts):
`(currentPercent − startPercent)/100 × battery_capacity_kwh ÷ efficiency`. Every input
is lossy: SOC is **integer %** (≈0.451 kWh steps on a 45.1 kWh pack), `battery_capacity_kwh`
is **hand-entered** (wrong for most users), efficiency is a **guessed constant** — but
with correct capacity and efficiency≈100% the formula is within 2% of truth.

**Key fact (verified on car `way`):** the BYD BMS keeps a **measured per-session energy
counter** (`FID_CHARGING_CAPACITY`, float — read live = **2.559 kWh**). The Android app
**already reads it and already sends it** as `telemetry.kwh_charged`
(`BYDMate-own TelemetrySnapshot.kt:93`). The cloud **receives it but only displays it**
([`vehicle-live-view.tsx:766`](src/components/vehicle/vehicle-live-view.tsx)) — it is
never used for the session total or cost. So the accurate number is already arriving;
the cloud just ignores it. (di+ untouched — keep-awake + actuation preserved.)

**Bonus — float charge power, finally:** instantaneous power is integer-only at the BYD
hardware layer (proven; see `BYDMate-own/docs/DIPLUS_DATA.md`), BUT differentiating the
float energy counter yields fractional **average** power:
`power_kw = Δkwh_charged / (Δt_seconds/3600)`. At ~30–60 s windows that's ~0.06 kW
resolution — far better than di+'s 1 kW integer (battery-side; apply efficiency for grid;
don't use windows <~20 s or the counter quantizes). This is charging-only (no clean
per-session energy counter exists for driving).

**Plan (server-side, EvAcChargeTimer):**
1. **Ingest:** persist `telemetry.kwh_charged` so the session logic can read it — add it
   to the live snapshot row (`bydmate_live_snapshots`, column or existing telemetry jsonb)
   in `src/app/api/bydmate/telemetry/route.ts` + `BydmateLiveSnapshotRow`.
2. **Energy:** in `deriveChargingState` (`charging-live.ts`), when a fresh `kwh_charged`
   is present prefer it as the battery-side energy (then the same efficiency→grid→cost
   chain), else fall back to the SOC×capacity estimate. Mirror in
   `charging-session-finalize.ts` / `charging-session-reconcile-logic.ts` for the
   persisted total.
3. **Float charge power (optional):** compute `chargePowerKw` from the Δ of the last two
   `kwh_charged` samples over Δt when both fresh; fall back to di+ integer `charge_power_kw`.

| | Approach | Pros | Cons |
|---|---|---|---|
| A | **Use BMS `kwh_charged` for energy/cost (+ derived float power)** | Directly measured kWh/cost; float charge power; di+ untouched; data already arrives | Ingest must carry `kwh_charged`; staleness guard; reconcile so total doesn't jump estimate→measured mid-session |
| B | Full nativestack port (Android di+→autoservice) | one data source | **rejected** — no new data, per-vehicle FID risk, di+ still required |
| C | Do nothing | zero effort | charge kWh/cost stay triple-estimated; power stays integer |

**Recommendation:** **A.** Open questions before building: (1) carry `kwh_charged` via a
new column vs telemetry jsonb; (2) staleness/sentinel guard + monotonic-within-session
check (counter resets on gun reconnect); (3) reconcile running total so switching
estimate→measured mid-session doesn't cause a visible jump; (4) min window for the
power derivative.

**→ Build A (server-side BMS energy + derived float charge power), or leave as C?**

---

### 🟡 Partition `bydmate_telemetry_samples` by time (B done 2026-06-30, A pending)

**Status:** Plan **B (BRIN interim) — DONE.** Migration
`20260630130000_telemetry_samples_brin_device_time.sql` applied to prod: BRIN
index on `device_time` (72 kB vs 10–42 MB btrees); planner confirmed using it
for time-range scans (was seq scan). **Plan A (full partitioning) still pending** —
reviewable draft at `docs/PLAN_A_PARTITION_DRAFT.sql` (annotated, NOT applied,
NOT in migrations/). Needs user go-ahead + pg_dump/host backup before applying.

---

#### Original plan (A vs B vs C):

**Problem:** `bydmate_telemetry_samples` is the high-volume, append-only ~1 Hz
time-series table (hit 500 MB+ before the diplus-blob drop). Retention is
`DELETE`-based via `bydmate_prune_telemetry_samples()` + pg_cron. Mass deletes
leave dead tuples → bloat → autovacuum pressure, and the only space reclamation
is a vacuum (not a truncate). The btree indexes on `(user_id, vehicle_id,
device_time)` are also large for time-ordered data.

**Current state (verified):**
- PK is `id uuid`. Postgres requires the partition key to be part of every
  unique constraint / PK → partitioning by `device_time` forces the PK to become
  composite `(id, device_time)` (or `(device_time, id)`).
- Unique index `bydmate_telemetry_samples_user_vehicle_device_unique` is on
  `(user_id, vehicle_id, device_time)` — already includes `device_time`, so it
  remains valid as a partitioned unique index. ✅
- Ingest inserts use `on conflict (user_id, vehicle_id, device_time) do nothing`
  for idempotency — must keep working.
- `diplus` jsonb blob already dropped; `diplus_*` typed columns remain.

**Options:**

| | Approach | Pros | Cons |
|---|---|---|---|
| A | **Declarative RANGE partitioning by `device_time`** (monthly) + BRIN on `device_time` | Retention = `DROP PARTITION` (instant, no bloat); smaller indexes; partition pruning speeds time-range reads | Requires new partitioned table + data migration + cutover; composite PK; pg_partman or a cron to pre-create partitions |
| B | **Keep heap table, add BRIN on `device_time`, switch retention to batched deletes** | No cutover; smaller time index; less lock risk | Still `DELETE`-based bloat; doesn't fix the core problem |
| C | **Do nothing** | Zero effort | Bloat/vacuum cost grows with userbase |

**Cutover plan for A (idempotent, self-hosted-safe — apply via `psql -f`):**
1. `create table bydmate_telemetry_samples_part (… , primary key (id, device_time)) partition by range (device_time);`
2. Recreate indexes (incl. partitioned unique on `(user_id, vehicle_id, device_time)`) + RLS policy on the new table.
3. Pre-create partitions covering existing data range + next few months (or install `pg_partman`).
4. `insert into …_part select * from bydmate_telemetry_samples;` (in batches if large).
5. In one transaction: `alter table … rename` swap, repoint the ingest RPC(s) and `bydmate_prune_telemetry_samples()` (now `drop partition` instead of `delete`).
6. Add a monthly pg_cron job to create the next partition.

**Trade-off note:** ingest RPC (`bydmate_ingest_telemetry`) and the prune
function both reference the table by name — renaming is transparent to them, but
the prune logic should be rewritten to drop whole partitions where possible
(premium/admin rows in the same time range complicate pure DROP — may need a
hybrid: DROP old partitions globally only past the longest retention tier, plus
per-user DELETE within retained partitions for free-tier users).

**Recommendation:** **A**, but it's the higher-effort option and the prune
rewrite is the subtle part (mixed retention tiers in one time partition). Worth
doing before the userbase grows; not urgent at current scale. **B** is a cheap
interim win (BRIN index) if we want lower risk now.

**→ Should I build A (full partitioning + prune rewrite), or B (BRIN-only interim)?**

---

### 🔵 Promote `vehicle_id` to a real FK (proposed 2026-06-29)

**Problem:** `vehicle_id` is a soft `text` key across telemetry, trips,
snapshots, commands, and notifications (36 occurrences). The link is
`cars.vehicle_alias` (text) → `*.vehicle_id` (text) by string equality, with
**no referential integrity**. A typo or alias change silently orphans data;
nothing constrains the vehicle dimension the way RLS constrains `user_id`.

**Options:**

| | Approach | Pros | Cons |
|---|---|---|---|
| A | **New `vehicles` table (uuid PK), FK from all telemetry/trip/command tables; keep `vehicle_alias` as the external device id on it** | True integrity; clean model; one place for per-vehicle metadata | Large migration; backfill mapping alias→uuid; every RPC that joins on `vehicle_id` must change; risk |
| B | **FK `vehicle_id (text) → cars.vehicle_alias` with a unique index on `vehicle_alias`** | Smaller change; adds integrity without new table | `vehicle_alias` is nullable + per-user; text FK is awkward; still no per-vehicle entity |
| C | **Do nothing, document the invariant** | Zero risk | Integrity stays app-enforced only |

**Recommendation:** **A** is the correct long-term model but it's a big,
multi-RPC migration touching the hottest write path (ingest). Given current
scale and that the invariant is app-enforced today, **C now / A later** is
defensible. Do **A** only when we're already opening up the telemetry tables for
another reason (e.g. the partitioning cutover above — natural moment to combine).

**→ Lower priority than partitioning. Build only if explicitly prioritized.**

---

### ✅ Settings — GPS permission prompt on every open (resolved 2026-06-29)

**Problem:** Every time Settings opens, `useEffect` in `settings-view.tsx:178` calls
`navigator.geolocation.getCurrentPosition()` unconditionally (because `newLocationLat/Lng`
start as empty strings on every mount). This triggers the OS GPS notification/prompt on
every visit.

**Options:**

| | Approach | Pros | Cons |
|---|---|---|---|
| A | **DB `profiles.last_gps_lat/lon`** *(already coded)* | Syncs across devices | Location in DB (privacy concern); coords stale after user moves; needs migration + DB write per GPS call; location is device-local anyway |
| B | **`localStorage`** | No migration; instant read; per-device (correct — GPS is device-specific); no privacy concern in DB | Cleared if user wipes storage; not cross-device (acceptable) |
| C | **Permissions API check** | Uses browser's own permission memory; no storage at all; semantically correct | `navigator.permissions` has limited iOS Safari support; OS location indicator still shows if granted |
| D | **Remove auto-GPS on mount entirely** | Simplest; zero storage; no prompt ever on open | Form not pre-filled automatically; user must tap "Use Current GPS" |

**Recommendation:** **D + B** — remove the mount-time `getCurrentPosition()` call entirely;
when the user explicitly taps "Use Current GPS" or "Auto GPS On", get position and save to
`localStorage`; on next open, pre-fill from `localStorage`. Zero migration, zero DB privacy
concern, zero prompt on mount.

Current coded approach (A — DB) can be reverted and replaced with B+D.

**Summary:** The DB approach works but stores device-local, potentially stale location data
in the database. `localStorage` is a better fit. The cleanest version removes auto-GPS-on-mount
entirely and only fetches when the user asks for it, saving the result in `localStorage` for
next time.

**→ Should I build the D+B approach (revert DB changes, use localStorage instead)?**

---

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Session startup

- Ask agentmemory for relevant context using concepts such as `voltflow-mate-charging-sessions`, `bydmate-telemetry-source-of-truth`, `charging-session-sync`, `mate-auto-start-stop`, `charging-session-reconcile`. If unavailable, continue from this file and docs, then save progress back once available.
- Agentmemory MCP is configured in `opencode.json` — runs `npx -y @agentmemory/mcp`, expects service at `http://localhost:3111`.

## Commands

```bash
npm run dev          # dev server
npm run build        # type-check + production build (excludes screenshots/)
npm run lint         # ESLint
npm run test         # Node built-in test runner: src/**/*.test.mjs
                     # Charging auto-session tests NOT in glob — run separately:
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/bydmate/charging-auto-session.test.mjs
                     # Individual test (any .test.mjs):
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/<module-path>.test.mjs

npm run db:migrations:status          # check pending migrations (local)
npm run db:migrations:up              # apply next pending migration (local)

# Self-hosted PROD (supabase.mykid.life): the `db:migrations:* -- --db-url-from-pooler`
# CLI commands do NOT work — the supabase CLI forces TLS but the Supavisor pooler has
# no TLS (errors: "tls error (server refused TLS connection)"). Apply migrations with
# psql directly. It's a Supavisor pooler: tenant `voltflow` → user `postgres.voltflow`,
# sslmode=disable, port 6543 (txn/DDL) or 5432 (session). There is NO
# supabase_migrations.schema_migrations table on self-hosted, so keep every migration
# `IF NOT EXISTS`-idempotent; the repo file is the only history.
PW=$(grep -E '^SUPABASE_POSTGRESS_PASSWORD=' .env.local | cut -d= -f2- | tr -d '"'"'"'"')
psql "postgresql://postgres.voltflow:$PW@supabase.mykid.life:6543/postgres?sslmode=disable" \
  -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql
```

## Architecture

- **Framework:** Next.js 16 App Router + React 19 + Tailwind CSS 4
- **Backend:** Supabase (Auth, Postgres, RLS, Realtime)
- **Deploy target:** Vercel (no CI workflows in `.github/`)
- **Entrypoints:** routes under `src/app/`; APIs under `src/app/api/`
- **Auth layout** wraps `(app)/` (authenticated), `(auth)/` (login/reset), `(marketing)/` (public)
- **Telemetry ingest:** `POST /api/bydmate/telemetry` (Next.js route at `src/app/api/bydmate/telemetry/route.ts`) writes `bydmate_telemetry_samples` + `bydmate_live_snapshots`, then runs auto charging sessions, reconcile, and charge notifications
- **Alt ingest path:** `supabase/functions/bydmate-telemetry/` is a simpler Deno Edge Function (same RPCs, minimal validation only)
- **PWA:** manifest at `src/app/manifest.ts`, SW at `public/sw.js`, prod-only registration
- **Other agent instructions:** `CLAUDE.md` delegates to this file; `SKILLS.md` has per-area file maps and safe-change workflow; `docs/CHARGING_SESSIONS.md` and `docs/TRIPS.md` are canonical for their domains

## Hard-won rules

### Trips (`bydmate_trips`)

- **Never edit an already-applied migration** — Supabase skips it on push. Create a new migration instead.
- `distance_km` is a **per-trip delta** from `trip_meter_baseline_km` (migration `20260615120000`); do not copy `current_trip_distance_km` as-is.
- Client `isJunkTrip` (`src/lib/bydmate/trip-filter.ts`) is **not** in sync with server discard rules — it only checks stationary/charging, not Rule B/C. Server is authoritative.
- Read `docs/TRIPS.md` before touching `bydmate_ingest_telemetry` or `bydmate_discard_trip_if_junk`.

### Charging sessions (`charging_sessions`)

| Event | Who | What it writes |
|---|---|---|
| Start / stop actions | User (PWA) | `charging_sessions` row |
| ~1 Hz progress | `ChargingSessionBackgroundSync` (in `MobileShell`) | `current_percent`, energy, cost |
| Auto start/stop | Mate ingest (`processBydmateAutoChargingSessions`) | Creates/closes rows, sets stop-time fields — never per-second SOC |
| Repair | `reconcileChargingSessionsForUser` | Fixes broken rows after ingest + on session list load |

Priority: **fresh live SOC (≤90s) > in-session telemetry > wall-clock math**. Never persist math-only completion while live SOC is fresh.

- **Auto-start** requires 4 consecutive charging samples (`charge_power_kw`, never `power_kw`) within last 3 min, vehicle parked (`speed_kmh ≤ 5`), not 100% balance tail.
- **Auto-stop** on 2 consecutive unplug samples or `speed_kmh > 5` (`CHARGING_DRIVE_SPEED_KMH` in `src/lib/charging-live.ts`).
- **Drive-away guard:** fresh movement during an open session → close as `stopped` with live-derived SOC/energy/cost.
- **Manual stop** (`src/actions/sessions.ts`): live → in-session telemetry → math. Never persist math-only 100% when telemetry shows unplug or drive-away below target.
- **Charts:** `/api/vehicle/charging-sessions/[sessionId]/samples` resolves `vehicle_id` from `cars.vehicle_alias` → live snapshot → telemetry. Do **not** default to `DEV_WAY_VEHICLE_ID` (`"way"`) in production code.
- If `current_percent` is stale in Postgres but telemetry samples are current, the PWA was likely closed — not an ingest bug.

### Migrations

- Apply one at a time. **Local:** `npm run db:migrations:up` (script `scripts/supabase-migrate-one.mjs`). **Self-hosted prod:** the CLI can't connect (forces TLS vs the no-TLS Supavisor pooler) — apply with `psql -f` instead (see the self-hosted block under Commands). Keep every migration `IF NOT EXISTS`-idempotent; self-hosted has no `schema_migrations` tracking table, so the repo file is the only record.
- Never delete old migration files; keep as active history until a deliberate squash.
- See `supabase/MIGRATIONS_AUDIT.md` for the full chain and pooler-based apply commands.

### Test quirks

- Tests use Node's built-in test runner with `--experimental-strip-types` (no Vitest/Jest).
- `charging-auto-session.test.mjs` is **excluded** from the `npm run test` glob — must be run explicitly (see Commands).
- Write `.test.mjs` files alongside the module under test in `src/lib/`.

### Key constraints

- `SUPABASE_SERVICE_ROLE_KEY` is server-only; client uses anon key with RLS.
- All user data scoped by `auth.uid()` — never bypass RLS in client code.
- `screenshots/` is a separate Next.js project excluded from root `tsconfig.json` (App Store assets).
- Pre-commit hook bumps patch version — `.git/hooks/pre-commit` (local, not committed).
