-- Add mate_version column to bydmate_live_snapshots.
-- Populated automatically from raw_payload->>'mate_version' via trigger so we
-- don't have to touch the large bydmate_ingest_telemetry function.

alter table public.bydmate_live_snapshots
  add column if not exists mate_version text;

-- Trigger function: extract mate_version from raw_payload on every upsert.
create or replace function public.bydmate_live_snapshots_set_mate_version()
returns trigger language plpgsql
as $$
begin
  new.mate_version := nullif(trim(new.raw_payload->>'mate_version'), '');
  return new;
end; $$;

-- Drop before creating so re-running the migration is idempotent.
drop trigger if exists trg_bydmate_live_snapshots_mate_version
  on public.bydmate_live_snapshots;

create trigger trg_bydmate_live_snapshots_mate_version
before insert or update on public.bydmate_live_snapshots
for each row execute function public.bydmate_live_snapshots_set_mate_version();
