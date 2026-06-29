## Agent workflow rule

**Always plan first, never build unasked.**
1. Research the problem.
2. Write the plan here under `## Pending plan` (options, trade-offs, recommendation).
3. Show a short summary and ask the user: "Should I build this?"
4. Wait for explicit go-ahead before writing any code or migrations.

---

## Pending plan

### 🟡 Partition `bydmate_telemetry_samples` by time (B done 2026-06-30, A pending)

**Status:** Plan **B (BRIN interim) — DONE.** Migration
`20260630130000_telemetry_samples_brin_device_time.sql` applied to prod: BRIN
index on `device_time` (72 kB vs 10–42 MB btrees); planner confirmed using it
for time-range scans (was seq scan). **Plan A (full partitioning) still pending.**

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
