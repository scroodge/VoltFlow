# Hosting & cost plan — escaping Vercel Fluid CPU + Supabase egress limits

Status: ✅ completed 2026-06-25. Supabase Cloud decommissioned.
Context: hit Vercel Fluid Active-CPU cap **and** Supabase **egress** cap. Userbase: dozens–hundreds. Region: `eu-west-1`.

## Root cause (read this before migrating)

Both limits come from the same pattern: **~1 Hz work per active vehicle.**

- **Egress (Supabase):** the client polled `charging_sessions` with `select("*")
  limit(100)` once per second per charging user
  (`src/components/charging/charging-session-background-sync.tsx` →
  `src/hooks/use-sessions-query.ts`). Hundreds of users × 100 full rows/sec = the bill.
- **Active CPU (Vercel):** `POST /api/bydmate/telemetry` ran ingest + auto-session +
  **reconcile on every sample**, plus the verify re-read of `raw_payload`/`diplus`.

> Migrating hosts without fixing this just moves the ceiling. A VPS hides the meter;
> it does not remove the load. Do the efficiency work first — it may keep us on
> cheap/managed tiers entirely.

## Phase 0 — efficiency fixes (in-repo, no migration needed)

**Full plan: `docs/PHASE_0_EFFICIENCY.md`.** Summary: slow the session poll (done),
gate reconcile (done), batch APK telemetry uploads (biggest win, Android side), trim
the `raw_payload` verify re-read, and add a telemetry-sample prune cron.

Re-measure after Phase 0. If under limits → stop here, no migration needed.

## Phase 1 — if still over limits: self-host the **full Supabase stack** on a VPS

Do **not** drop to bare Postgres — the app depends on Supabase Auth + RLS
(`auth.uid()`) + Realtime everywhere. Self-hosting the whole stack keeps those APIs
identical, so app code changes are limited to env vars.

**Box (Contabo VPS):**
- Existing Contabo VPS used instead of Hetzner. 6 vCPU / 16 GB RAM.
- Supabase stack via Docker Compose, nginx reverse proxy at own domain.
- Grafana + Prometheus monitoring stack.

**Stack:** Supabase self-hosted via Docker Compose
(`https://supabase.com/docs/guides/self-hosting/docker`). Components: Postgres, GoTrue
(Auth), PostgREST, Realtime, Storage (if used), Kong gateway.

**App env changes only:**
- `NEXT_PUBLIC_SUPABASE_URL` → your domain (e.g. `https://api.<domain>`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` → keys from the
  self-host `.env` (JWT secret you generate)
- Keep Next.js on Vercel (fine after Phase 0) **or** run it on the same VPS to consolidate.

**Actual migration (completed 2026-06-25):**
1. Supabase Docker stack deployed at `/opt/supabase/` on Contabo (12 containers, Kong on :8000).
2. nginx reverse proxy + LetsEncrypt TLS at own domain.
3. Database dumped via Supabase CLI (`supabase db dump --linked`) and restored to self-hosted Postgres.
   28 auth users, 70 charging sessions, 389k telemetry samples migrated. Sequences updated.
4. 48 Storage objects migrated across 4 buckets (`knowledge-*`, `cluster-backgrounds`).
5. Google OAuth configured in self-hosted `.env`, redirect URI updated in Google Cloud Console.
6. Preview deployment tested on Vercel, then production env vars promoted and `main` redeployed.
7. Nightly backup cron: `0 3 * * * /opt/supabase-dump/backup.sh` → `/backups/supabase/`, 30-day retention.
8. Grafana + Prometheus monitoring stack at `/opt/monitoring/`:
   - Postgres metrics (postgres_exporter)
   - Kong request rate & connections
   - Per-container CPU/memory (cAdvisor)
   - System CPU/memory/disk (node_exporter)
   - Docker logs (Loki + Promtail)
   - Dashboard: "Supabase Self-Hosted" at Grafana URL (admin/your-password)

**What you now own (budget for it):**
- Automated backups: nightly `pg_dump` → object storage (Hetzner Storage Box / S3),
  with a tested restore. **No backups = data loss waiting to happen.**
- OS + Docker image patching, TLS renewal (Caddy auto-renews), disk/CPU monitoring + alerts.
- Uptime: single box = single point of failure. For hundreds of paying-ish users,
  consider a managed Postgres provider as a middle ground (see Phase 2).

## Phase 2 — alternatives if ops burden is unwelcome

- **Keep managed, just right-sized:** Supabase Pro ($25/mo) raises egress allowance a
  lot; combined with Phase 0 you may simply fit. Lowest effort, no ops.
- **Split:** managed Supabase for Auth/DB/Realtime (reliability where it matters) +
  cheap VPS worker for the heavy telemetry ingest (moves CPU off Vercel, keeps egress
  intra-region/cheap). Port `processBydmateAutoChargingSessions` / reconcile to the worker.
- **Managed Postgres + self-host the rest:** e.g. Neon/RDS for the DB (backups handled)
  with GoTrue/Realtime on the VPS. Removes the scariest ops item (DB backups/PITR).

## Recommendation

1. Ship Phase 0 (esp. APK batching) and re-measure. High chance this resolves both caps.
2. If growth continues, Phase 1 (full self-host on Hetzner) is the cheapest flat-cost
   option and removes egress metering — provided you commit to backups + monitoring.
3. If you don't want to own DB backups, prefer Phase 2's managed-Postgres split.
