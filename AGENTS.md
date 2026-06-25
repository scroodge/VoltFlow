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
npm run db:migrations:status -- --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD  # self-hosted
npm run db:migrations:up              # apply next pending migration (local)
npm run db:migrations:up -- --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD      # self-hosted
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

- Apply one at a time via `npm run db:migrations:up`. Script: `scripts/supabase-migrate-one.mjs`.
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
