## Change gate

**Always plan first; never modify tracked project files unasked.** For a proposed
change (code, migrations, behavior, or project documentation):

1. Research the problem and the owning source/doc.
2. Write options, trade-offs, and a recommendation in [BACKLOG.md](BACKLOG.md).
3. Show a short summary and ask: **“Should I build this?”**
4. Wait for explicit go-ahead before editing code, migrations, or project docs.

For any user-facing data model (tariffs, GPS coords, preferences), the plan must state
**who owns the data** (user-owned vs app-owned) and **where it lives** (Postgres vs
localStorage) and get those two choices confirmed before building — per-user
preference data defaults to client-side storage. Past rework: app-owned provider
tariffs and DB-stored GPS coords both had to be rebuilt the other way.

Read-only investigation and review do not need a backlog entry, but must not change
files. Once approved work ships, move its plan from `BACKLOG.md` to
[CHANGELOG.md](CHANGELOG.md).

---

## Plans & status

- **Proposed, not built** → [BACKLOG.md](BACKLOG.md) (build only on explicit go-ahead).
- **Shipped work log** → [CHANGELOG.md](CHANGELOG.md).
- **How the system works** → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (start here).

## Documentation precedence

Use the narrowest authoritative source for the area being changed:

1. This file for agent workflow, security, migrations, test quirks, and durable
   project invariants.
2. The named canonical domain doc for detailed behavior: `docs/CHARGING_SESSIONS.md`,
   `docs/TRIPS.md`, `supabase/TELEMETRY.md`, `supabase/BYDMATE_APK_API.md`, or the
   relevant doc linked from `docs/ARCHITECTURE.md`.
3. Source code and its focused tests for behavior not documented or suspected to have
   drifted.
4. `SKILLS.md` only for owner-file maps, verification commands, and safe workflow;
   it does not override a canonical domain doc.

If sources conflict, stop and reconcile them in the same approved documentation change
instead of choosing a convenient copy.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Session startup

- Ask agentmemory for relevant context using concepts such as `voltflow-mate-charging-sessions`, `bydmate-telemetry-source-of-truth`, `charging-session-sync`, `mate-auto-start-stop`, `charging-session-reconcile`. If unavailable, continue from this file and docs; do not block on it. After material approved work, save only a concise, verified outcome when memory is available.
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

# Self-hosted PROD: the `db:migrations:* -- --db-url-from-pooler` CLI commands do NOT
# work — the supabase CLI forces TLS but the Supavisor pooler has no TLS. Apply
# migrations with psql directly against the pooler (sslmode=disable). There is NO
# supabase_migrations.schema_migrations table on self-hosted, so keep every migration
# `IF NOT EXISTS`-idempotent; the repo file is the only history.
#
# The exact host / pooler user / port / connection recipe is in the LOCAL-ONLY file
# docs/OPS_LOCAL.md (kept out of this public repo). General form:
psql "$SUPABASE_POOLER_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql
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
- **Other agent instructions:** `CLAUDE.md` delegates to this file; `docs/ARCHITECTURE.md` is the system overview + doc map (start there); `SKILLS.md` has owner-file maps and verification guidance; `docs/CHARGING_SESSIONS.md` and `docs/TRIPS.md` are canonical for their domains

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

- **Auto-start** requires 4 consecutive charging samples within last 3 min, vehicle parked (`speed_kmh ≤ 5`), and not a 100% balance tail. Prefer `charge_power_kw` (never traction `power_kw`); the `is_charging` fallback is invalid when Di+ explicitly reports gun state `1` (unplugged).
- **Parked telemetry is ~1 sample/minute, not 1 Hz** (driving is ~1 Hz), so those 4 confirmation samples span ~4 real minutes — on a DC charger that is ~10% SOC. Sessions are therefore **backdated**: `start_percent` comes from the last pre-charge (idle) SOC when it is fresh (≤30 min) and not above the streak's first charging SOC, else from the streak's first charging sample; `started_at` is always the streak's first charging sample. Never take `start_percent` from the confirming sample. See `docs/CHARGING_SESSIONS.md` → Backdating.
- **Auto-stop** on 2 consecutive unplug samples or `speed_kmh > 5` (`CHARGING_DRIVE_SPEED_KMH` in `src/lib/charging-live.ts`).
- **Drive-away guard:** fresh movement during an open session → close as `stopped` with live-derived SOC/energy/cost.
- **Manual stop** (`src/actions/sessions.ts`): live → in-session telemetry → math. Never persist math-only 100% when telemetry shows unplug or drive-away below target.
- **Charts:** `/api/vehicle/charging-sessions/[sessionId]/samples` resolves `vehicle_id` from `cars.vehicle_alias` → live snapshot → telemetry. Do **not** default to `DEV_WAY_VEHICLE_ID` (`"way"`) in production code.
- If `current_percent` is stale in Postgres but telemetry samples are current, the PWA was likely closed — not an ingest bug.
- **Energy/cost = `SOC_delta% × battery_capacity_kwh ÷ 100 ÷ efficiency`** (capacity per-car, never hardcoded). SOC-derived energy is **battery-side**; providers meter **grid-side**, so efficiency is **per-tariff, not per-car** (`efficiencyPercentForTariff`): **AC ≈98%** (`cars.default_efficiency_percent`), **fast DC ≈90%** (`cars.fast_dc_efficiency_percent`) — measured, not guessed. Never assume 100%: that under-reported every DC charge by ~9%. The BMS counter `kwh_charged` is **cell-only** (~47% low) — never use it for cost or the power display; diagnostics only. See `docs/CHARGING_SESSIONS.md`.

### Migrations

- Apply one at a time. **Local:** `npm run db:migrations:up` (script `scripts/supabase-migrate-one.mjs`). **Self-hosted prod:** the CLI can't connect (forces TLS vs the no-TLS Supavisor pooler) — apply with `psql -f` instead (see the self-hosted block under Commands). Keep every migration `IF NOT EXISTS`-idempotent; self-hosted has no `schema_migrations` tracking table, so the repo file is the only record.
- Never delete old migration files; keep as active history until a deliberate squash.
- See `supabase/MIGRATIONS_AUDIT.md` for the full chain and pooler-based apply commands.

### Knowledge base & semantic search

- **Any function using pgvector operators must pin `search_path`.** The `vector` type lives in the `extensions` schema, so `<=>` resolves only when `extensions` is on the path. The API roles (`anon`, `authenticated`, `service_role`) have **no** `search_path` set, so PostgREST never gets it and every call 500s with `42883: operator does not exist: extensions.vector <=> extensions.vector`. Declare `set search_path = public, extensions` on the function. This is a **self-hosted-only** failure — psql (whose default path includes `extensions`) and Supabase Cloud both hide it, so it passes review and dies in prod. It cost a total, silent search outage; see migration `20260714090000`.
- **Measure retrieval before tuning it.** `npm run search:eval` (`scripts/knowledge-search-eval.mjs`) runs 12 real queries against a running dev server and asserts the expected top hit; two cases are content gaps that pass by *correctly refusing to answer*. A "search is bad" report turned out to be **10/12 correct** plus two missing articles — and naively raising `match_threshold` would have dropped a right answer, because the scores overlap (correct hit `0.423` vs wrong hit `0.417`). Presentation confidence lives in `src/lib/knowledge-search-confidence.ts`; keep its constants in sync with the eval script.
- **Article view counts must not live on `knowledge_articles`.** That table has a `BEFORE UPDATE` trigger (`set_knowledge_articles_updated_at`) stamping `updated_at = now()`, so a `view_count` column there would bump `updated_at` on every page view and turn "recently updated" into "recently viewed". Counts live in `knowledge_article_views`, written only through the `increment_knowledge_article_view` `SECURITY DEFINER` RPC — the KB is public, and RLS cannot restrict *which column* an `UPDATE` touches, so `anon` must never hold write privileges on the content tables.

### Test quirks

- Tests use Node's built-in test runner with `--experimental-strip-types` (no Vitest/Jest).
- `charging-auto-session.test.mjs` is **excluded** from the `npm run test` glob — must be run explicitly (see Commands).
- Write `.test.mjs` files alongside the module under test in `src/lib/`.

### Key constraints

- `SUPABASE_SERVICE_ROLE_KEY` is server-only; client uses anon key with RLS.
- All user data scoped by `auth.uid()` — never bypass RLS in client code.
- `screenshots/` is a separate Next.js project excluded from root `tsconfig.json` (App Store assets).
- Pre-commit hook bumps patch version — `.git/hooks/pre-commit` (local, not committed).


# Log papercuts

When you encounter small friction while working—a failed tool call, confusing
setup, flaky command, stale cache, misleading error, missing helper, or
non-obvious gotcha—record it in `PAPERCUTS.md`.

Create the file if it does not exist. Append one entry in this format:

## YYYY-MM-DD HH:MM — <model>

<What you were doing> → <what got in the way>. Include a possible cause or fix
when useful.

Log papercuts proactively when they occur, but do not interrupt the main task.
Do not add duplicate entries. Papercuts are minor workflow friction, distinct
from completed-work logs and real bugs or tracked issues. 

<!-- BEGIN sqz-agents-guidance (auto-installed by sqz init; remove this block to disable) -->

## sqz — Token-Optimized CLI Output

When running shell commands whose output may be long (directory listings,
git log/diff, test runners, build logs, `docker ps`, `kubectl get`, etc.),
pipe the output through `sqz compress` to reduce token consumption.

`sqz` is a stdin-to-stdout compressor, not a command wrapper. The correct
usage is to pipe the command's output into `sqz compress`:

```bash
# Instead of:     Use:
git status        git status 2>&1 | /usr/local/bin/sqz compress
cargo test        cargo test 2>&1 | /usr/local/bin/sqz compress
git log -10       git log -10 2>&1 | /usr/local/bin/sqz compress
docker ps         docker ps 2>&1 | /usr/local/bin/sqz compress
ls -la            ls -la 2>&1 | /usr/local/bin/sqz compress
```

The `2>&1` captures stderr too, which is useful for commands like `cargo
test` where diagnostics go to stderr. `sqz compress` filters and compresses
the combined output while preserving filenames, paths, and identifiers.
It typically saves 60-90% tokens on verbose commands.

Do NOT pipe output for:
- Interactive commands (`vim`, `ssh`, `python`, REPLs)
- Compound commands with shell operators (`cmd && other`, `cmd > file.txt`,
  `cmd; other`) — run those directly
- Short commands whose output is already a few lines

If `sqz` is not on PATH, run commands normally.

The `sqz-mcp` MCP server is also available — Codex reads it from
`~/.codex/config.toml` under `[mcp_servers.sqz]`. It exposes three
tools: `compress` (the default pipeline), `passthrough` (return text
unchanged — the escape hatch below), and `expand` (resolve a
`§ref:HASH§` token back to the original bytes).

## Escape hatch — when sqz output confuses you

If you see a `§ref:HASH§` token and can't parse it, or compressed
output is leading you to make lots of small retries instead of one
big request, use one of these:

- **`/usr/local/bin/sqz expand <prefix>`** — resolve a dedup ref back to the
  original bytes. Accepts bare hex (`sqz expand a1b2c3d4`) or the full
  token pasted verbatim (`sqz expand §ref:a1b2c3d4§`).
- **`SQZ_NO_DEDUP=1`** — set this env var for one command to disable
  dedup: `SQZ_NO_DEDUP=1 git status 2>&1 | sqz compress`. You'll get
  the full compressed output with no `§ref:…§` tokens.
- **`--no-cache`** — same opt-out as a CLI flag:
  `git status 2>&1 | sqz compress --no-cache`.

If you're using the MCP server, the `passthrough` tool returns raw
text and the `expand` tool resolves refs — call them when you need
data sqz hasn't touched.

<!-- END sqz-agents-guidance -->
