-- Viewer-gated fast live status.
--
-- Problem: the PWA's status (drive / charge / park, SOC, charge power) is only as fresh
-- as Mate's *delivery* cadence, which is batched on purpose — 60 s for charging-bulk and
-- parked, 15 s for driving. That is the cloud-offload design and is correct when nobody
-- is looking; it is wrong when the owner has the app open and expects 2-5 s.
--
-- Rather than push `live_only` frequently for every car all the time (~5-20x the ingest
-- invocations, eroding cloud-offload phases 0-3), the car only switches to a fast
-- ~3 s `live_only` cadence while someone is actually watching.
--
-- These two columns are that signal. The PWA stamps `live_fast_until` a short way into
-- the future while its live view is mounted and visible; the car learns about it on its
-- existing ~6 s `/api/bydmate/commands` poll, which already reads this profile row via
-- `resolveBydmateApiKeyProfile` — so the hot path costs **zero extra reads**.
--
-- Ownership: app-owned ephemeral state, not a user preference. It has no meaning past its
-- expiry, is never shown to the user, and is safe to lose (the car simply falls back to
-- the normal batch cadence). It lives in Postgres only because the *server* must answer
-- the car's poll with it.
--
-- Why on `profiles` and not a new table: `profiles` is already fetched on every command
-- poll, and — verified before choosing this — it carries no BEFORE UPDATE trigger, so a
-- viewer heartbeat cannot pollute an `updated_at`-style column the way a `view_count` on
-- `knowledge_articles` would have (see AGENTS.md → Knowledge base). `live_fast_vehicle_id`
-- keeps the signal per-vehicle for multi-car accounts: watching car A must not speed up
-- car B.
--
-- Idempotent: self-hosted prod has no `supabase_migrations.schema_migrations`, so this
-- file is the only history and must be safe to re-run.

alter table public.profiles
  add column if not exists live_fast_until timestamptz,
  add column if not exists live_fast_vehicle_id text;

comment on column public.profiles.live_fast_until is
  'Ephemeral, app-owned: while in the future, Mate pushes live_only status at a fast (~3s) cadence for live_fast_vehicle_id. Set by the PWA live view; expires on its own. Safe to lose.';

comment on column public.profiles.live_fast_vehicle_id is
  'Vehicle alias the live_fast_until window applies to, so a multi-car account only speeds up the car being watched.';
