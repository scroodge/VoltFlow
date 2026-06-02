# Supabase Migrations Audit

Date: 2026-05-30

## Applied 2026-06-02 (charging sessions)

| Migration | Purpose |
| --- | --- |
| `20260602103500_fix_false_completed_charging_sessions.sql` | One-time backfill: `completed` at target but in-session telemetry `max(soc) < target` and `speed_kmh > 5` → `stopped`, percent/energy/cost from last telemetry SOC |
| `20260602120000_bydmate_auto_charging_session_state.sql` | Per-vehicle counters for ingest auto start/stop (`processBydmateAutoChargingSessions`) |

**App deploy:** Migrations alone do not enable auto start/stop. Production must run the API build that calls `processBydmateAutoChargingSessions` in `POST /api/bydmate/telemetry`. Verify with ingest response `auto_charging_sessions` and rows in `bydmate_auto_charging_session_state`.

Execution notes (both migrations):

- `--target=linked` failed in temporary workdir mode (`Cannot find project ref`).
- Applied successfully via pooler URL:

```sh
npm run db:migrations:up -- --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD --yes
```

- Verified no pending migrations:

```sh
npm run db:migrations:plan -- --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD
```

## Applied 2026-05-30 (database architecture review)

These migrations are applied to the linked production project (`fgazcjtxbkiuimdoyelh`):

| Migration | Purpose |
| --- | --- |
| `20260528120000_add_cars_vehicle_alias.sql` | Optional `cars.vehicle_alias` for display vs telemetry `vehicle_id` |
| `20260530120000_telemetry_retention_and_live_realtime.sql` | 90d/3y retention function, pg_cron schedule, Realtime on `bydmate_live_snapshots` |
| `20260530121000_bydmate_energy_rollups_and_trip_columns.sql` | Trip energy columns; hourly regen/traction sums; SQL helpers |
| `20260530122000_bydmate_ingest_energy_hooks.sql` | Ingest RPC updates hourly energy + finalizes trip energy on close |
| `20260530123000_cars_home_charger_geofence.sql` | `home_charger_lat/lon/radius_m` on `cars` |
| `20260530124000_bydmate_route_labels.sql` | User route names and park flags for route insights |

**Note:** Remote migration `20260526000100` (`marketplace_persistence`) existed only on the
linked DB, not in this repo. It was marked `reverted` in history so the CLI could
apply the above chain; schema from that migration remains in the DB.

**Apply command** (linked project, pooler URL):

```sh
npm run db:migrations:up -- --target=linked --yes --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD
```

Repeat until `npm run db:migrations -- plan` reports no pending migrations.

## Current shape

The migration chain is mostly valid, but it contains several historical fixup migrations that repeatedly redefine the same functions. These files are not safe to delete from an already-linked Supabase project unless the remote migration history is also repaired or the project is rebuilt from a squashed baseline.

The main churn is in VoltFlow Mate telemetry:

- `public.bydmate_ingest_telemetry(...)` is redefined in `20260519120000`, `20260521120000`, `20260522100000`, `20260525153000`, `20260525164000`, `20260525172000`, and `20260526101500`.
- `public.bydmate_ingest_telemetry_batch(...)` is redefined in `20260519140000`, `20260521120000`, `20260522100000`, `20260525173500`, and `20260525175000`.
- `public.bydmate_apply_diplus_columns(...)` is redefined in `20260521120000` and `20260522100000`.
- `public.match_knowledge_items(...)` is redefined in `20260518120000`, `20260519101000`, and `20260519103000`.

## Redundant candidates for a future squash

Do not remove these directly from the active migration folder while they may exist in Supabase migration history. Treat them as candidates for a squashed `init` baseline or an archived history branch.

- `20260512150000_bydmate_telemetry.sql` and `20260512162000_fix_bydmate_telemetry_schema.sql`: introduce the legacy `bydmate_telemetry_points` model. That table is backfilled into v2 and later dropped by `20260525153000_optimize_bydmate_telemetry.sql`.
- `20260519140000_bydmate_telemetry_batch_ingest.sql`: superseded by later batch ingest implementations, with the latest batch body in `20260525175000_fast_skip_stale_bydmate_batch.sql`.
- Function-body portions of `20260521120000_bydmate_diplus_extended_payload.sql` and `20260522100000_bydmate_cell_voltage_priority.sql`: their schema additions are still meaningful, but their ingest function bodies are superseded.
- `20260525173500_skip_stale_bydmate_batch_ingest.sql`: superseded by `20260525175000_fast_skip_stale_bydmate_batch.sql`.
- The pair `20260525172000_allow_repeated_bydmate_device_time_samples.sql` and `20260525174500_restore_bydmate_sample_idempotency.sql` records a reverted design decision. The final state keeps unique `(user_id, vehicle_id, device_time)` idempotency, so in a squash this should be represented once.
- Earlier `match_knowledge_items` definitions are superseded by `20260519103000_knowledge_search_source_types.sql`.

## Keep as active history

Keep all migration files in `supabase/migrations` until there is a deliberate squash/reset plan. The current active chain is the source of truth for existing environments.

If a clean baseline is needed later, prefer:

1. Dump current schema from the known-good database.
2. Create a single squashed migration for schema and intentional seed data.
3. Archive old migrations outside `supabase/migrations`.
4. Use `supabase migration repair` only after verifying the target database schema matches the squashed baseline.

## One-at-a-time control

Use the repository wrapper around Supabase CLI:

```sh
npm run db:migrations -- status --target=local
npm run db:migrations -- plan --target=local
npm run db:migrations -- up --target=local
npm run db:migrations -- down --target=local
```

For the linked Supabase project:

```sh
npm run db:migrations -- status --target=linked
npm run db:migrations -- plan --target=linked
npm run db:migrations -- up --target=linked
npm run db:migrations -- down --target=linked
```

If the CLI is not logged in, use the checked-in pooler URL plus the local
database password env var:

```sh
npm run db:migrations -- status --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD
npm run db:migrations -- plan --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD
npm run db:migrations -- up --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD
```

`up` applies exactly the next pending migration by creating a temporary Supabase workdir that contains only migrations up to that version, then running `supabase migration up`. `down` delegates to `supabase migration down --last 1`.
