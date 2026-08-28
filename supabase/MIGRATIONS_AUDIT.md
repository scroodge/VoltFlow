# Supabase migrations audit

## 20260826172117 — auxiliary voltage daily analytics

- Adds immutable, security-invoker `bydmate_is_parked_unplugged(jsonb, text)` and grants execution only to authenticated/service roles.
- Rewrites `bydmate_phantom_drain_daily` to call the extracted predicate without changing its four-hour aggregation behavior.
- Adds stable, security-invoker `bydmate_aux_voltage_daily` with user/vehicle/range scoping, 6–18 V revalidation, daily bands, and two-hour resting medians.
- Adds the partial raw-sample auxiliary-voltage analytics index.
- Adds no table, RLS policy, hourly-rollup column, or privileged `SECURITY DEFINER` path.

## 20260826194941 — full-window day telemetry buckets

- Adds stable, security-invoker `bydmate_telemetry_day_buckets` with user/vehicle/time scoping.
- Caps output structurally at three envelope points across each of at most 800 fixed time buckets.
- Revalidates complete response coverage in the application using repeated source count/first/last metadata.
- Grants execution only to authenticated/service roles; adds no privileged or table-writing path.

## 20260817090000 — bydmate_devices app version (applied 2026-08-27)

- Adds `app_version text`, `version_code integer`, `app_version_seen_at timestamptz` to
  `public.bydmate_devices`, plus their column comments. Additive and idempotent
  (`add column if not exists`); no data, RLS or privileged path change.
- **Was written 2026-08-17 but never reached production.** Confirmed before applying:
  `bydmate_devices` had only `id, user_id, kind, api_key_hash, api_key_fingerprint,
  created_at`. `src/lib/voltflowmate/link-code.ts` writes all three columns on redeem, so
  every Dashboard pairing attempt failed with *"Could not find the 'app_version' column of
  'bydmate_devices' in the schema cache"*. Verified after applying: 9 columns present.
- Followed by `notify pgrst, 'reload schema'` — the failure surfaced as a schema-cache
  error, so PostgREST needs the reload even once the column exists.

### Why it sat unapplied, and how it was applied

- `supabase/migrations/` contained **two** files at version `20260826190000`
  (`car_aux_battery_chemistry.sql` and `fix_autoservice_soc_column_comment.sql`), from
  parallel branches meeting at merge `4f51be4`. The planner hard-errors on a duplicate
  version and refuses to plan anything, so no migration could be pushed at all. The newer,
  comments-only, self-declared-idempotent file was renumbered to `20260826190100`,
  following the precedent of `20260714130000` → `20260714130100`.
- The CLI paths do not work against the current database and were not used:
  `--target=linked` still points at `db.fgazcjtxbkiuimdoyelh.supabase.co`, which no longer
  resolves since the move to self-hosted; and `--db-url-from-pooler` fails because the
  Supabase CLI forces TLS while Supavisor on `:6543` is plain TCP (the pooler URL already
  carries `sslmode=disable`).
- There is no `supabase_migrations.schema_migrations` table on this database — it has never
  been under the CLI ledger — so migrations here are applied by hand and recorded in this
  file. Applied with
  `psql "$(cat supabase/.temp/pooler-url)" -v ON_ERROR_STOP=1 -1 -f <migration>`.
