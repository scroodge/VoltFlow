# Changelog — shipped initiatives & notable fixes

A running log of completed work that was previously tracked as "plans". Newest first.
For unbuilt proposals see [BACKLOG.md](BACKLOG.md); for current behavior see the
[docs/](docs/ARCHITECTURE.md) reference set.

> Dates are when the work landed in the working tree. "Built" here means code +
> tests + (where applicable) migrations applied to prod, as recorded at the time.

---

## 2026-07-24

### Repository audit remediation

- Assigned unique versions to all tracked Supabase migrations and made the migration
  runner fail clearly if a future duplicate version is introduced.
- Added streamed request-body limits for BYDMate telemetry, trip summaries, and command
  acknowledgements; chunked requests can no longer bypass the configured caps.
- Removed the production fallback to the development `way` vehicle id and require an
  explicit vehicle for vehicle-scoped APIs.
- Kept remote vehicle commands disabled, but restored authenticated fast-status grants as
  an independent control; restricted fast-status heartbeats to dashboard, vehicle, and
  charging views.
- Bounded exports to one year and 10,000 rows per section, marked truncated exports, and
  extracted the shared Telegram external-link/share component.
- Removed unused direct dependencies and a tracked Python bytecode artifact.
- Verification: `npx tsc --noEmit`, `npm run test` (154/154), the excluded charging
  auto-session suite, and `git diff --check` passed. `npm run lint` still reports
  pre-existing repository errors unrelated to these changes.

## 2026-07-23

### Repository security, performance, and architecture remediation

- Hardened `telegram_live_messages` with idempotent RLS and service-role-only access;
  the Telegram webhook now fails closed when its secret is not configured.
- Authenticated and bounded BYDMate command acknowledgements before parsing, and switched
  server actions to the request-bound Supabase client.
- Replaced admin per-user query fan-outs with grouped RPCs, constrained SOH fallback to
  missing-function errors, and shared the concurrency mapper used by reindexing and SOH.
- Made the Supabase telemetry Edge Function proxy the canonical Next.js ingest route and
  removed confirmed repository-local dead modules.
- Verification: focused telemetry/proxy tests (8/8), `npx tsc --noEmit`, and
  `git diff --check` passed. Migrations `20260723120000` and `20260723121000` were
  applied sequentially to self-hosted production and their RLS/RPC grants were verified.

### Temporarily disabled BYDMate remote commands

- `GET /api/bydmate/commands` now returns an empty command list and
  `live_fast_seconds: 0` while the temporary operational kill switch is enabled.
- Existing queued `vehicle_commands` remain user-owned Postgres data and are not marked
  `sent`; the acknowledgement endpoint remains protocol-compatible.
- This stops command delivery and fast-status grants without causing old Mate clients to
  retry an HTTP error. Poll traffic from stale APKs/daemons will continue until those
  clients are stopped or updated.
- No migration or user-facing data model changed.

### Documentation truth cleanup and historical charging-policy fix

- Brought `ARCHITECTURE.ru.md` up to the English architecture reference: state-aware collection,
  tiered raw-data retention, and the expiring visible-view fast-status window are now described
  in both languages.
- Clarified that Mate sends `live_only` snapshots on a configured roughly three-second cadence
  after observing a fast-status grant. This describes delivery behavior, not a guaranteed
  end-to-end latency; normal background delivery remains batched.
- Corrected retention documentation, including the schema reference: Standard raw telemetry and
  route tracks are kept for 30 days, hourly aggregates for three years, and Extended access
  retains those records while the account is active.
- Replaced the charging-session history reader's local power check with
  `isTelemetryHistoryCharging`. It uses only charge-specific telemetry, rejects an explicit Di+
  unplug state, and never treats traction `power_kw` as charging.
- Added focused regression coverage for driving traction power and stale unplugged samples in a
  charging-session history window. No migration, API contract, preference, or storage location
  changed; telemetry remains user-owned in Postgres.
- Verified with the focused telemetry-history and telemetry-charging tests (24/24).

### Fixed false live charging status from stale Mate power

- **Root cause:** `isTelemetryCharging()` accepted `charge_power_kw=1` before
  checking Di+ `charge_gun_state=1`, so a parked/unplugged `way` could appear to be
  charging even with no open `charging_sessions` row.
- **Fix:** explicit gun state `1` now takes precedence in the shared live-status
  classifier. Auto-session detection remains separately guarded.
- **Regression coverage:** added the production-shaped case
  (`is_charging=true`, `charge_power_kw=1`, gun state `1`) and verified it returns
  not-charging.
- **Verification:** focused telemetry tests (16/16), `npm run test` (154/154), and
  the excluded charging-auto-session test (7/7) pass. `npm run build` was attempted
  but remained blocked by an existing `.next/lock` held by another build process.
- No schema/migration or production-data change.

### Configured engineering-skill workspace conventions

- Defined GitHub Issues as the repository's issue tracker and kept PRs out of the triage
  request surface.
- Recorded the five default triage labels used by the installed `triage` skill.
- Declared a single-context domain-document layout and its consumer rules, while keeping
  `CONTEXT.md` and ADRs lazy-created only when a real decision requires them.
- Added the `## Agent skills` index to `CLAUDE.md`, linking the configuration under
  `docs/agents/`.
- No user-facing data model, application behavior, migration, or external tracker state
  changed.

## 2026-07-22

### Fixed a false auto-charging session caused by stale `charge_power_kw` overriding an explicit unplug

- **Root cause:** `isMateAutoSessionCharging()` (`src/lib/bydmate/telemetry-charging.ts`)
  checked `charge_power_kw > 0.1 kW` before checking Di+ gun state, so a leftover stale
  nonzero `charge_power_kw` reading (persisting after a real charge had already ended)
  bypassed the "gun explicitly unplugged" safety check meant to catch exactly that stale
  case.
- **Found by investigating a real report:** car `way`, 2026-07-22. A legitimate AC charge
  (75%→77%) ended at 14:10; the car was then driven to 66% and parked/unplugged at
  ~15:03. Di+ correctly reported `charge_gun_state: 1` (unplugged), but `is_charging`
  and `charge_power_kw` kept reporting stale values (`true` / `1`) on every parked
  heartbeat — falsely opening and then keeping open a session from 15:04:53 until the
  drive-away guard force-closed it at 15:52:32 (the car started moving again; the stale
  reading never self-corrected).
- **Fix:** moved the explicit-gun-state-unplugged check ahead of the `charge_power_kw`
  check in `isMateAutoSessionCharging()`, so an explicit unplug always wins regardless of
  what `charge_power_kw`/`is_charging` report.
- **Regression test added** to `telemetry-charging.test.mjs` reproducing car `way`'s
  actual glitch sample (`is_charging: true, charge_power_kw: 1, gun_state: 1`, parked) →
  asserts not-charging. Full suite verified: `telemetry-charging.test.mjs` (15/15),
  `charging-auto-session.test.mjs` (7/7, excluded from the default `npm run test` glob),
  and `npm run test` (154/154).
- No schema/migration change; no production data cleanup — the historical false session
  (`977bb92e-…`) was left as-is.

## 2026-07-21

### VPS ops: retired dead tenants on the Supabase host

- **Removed the `immich` nginx vhost** (backed up to `/root/immich-vhost.backup.2026-07-21`). It
  served only the expired `mykid.ddns.net` cert and proxied `/ai/` to `127.0.0.1:8000` — the port
  now owned by `supabase-kong` — and `/` to the long-dead immich backend on `:2283`.
  `nginx -t` clean, reloaded; `supabase.voltflow.life` and `supabase.mykid.life` both still serve
  (HTTP 401 from PostgREST, i.e. alive).
- **Deleted the expired `mykid.ddns.net` certificate** (expired 2026-05-12). It was the sole cause
  of `certbot.service` being permanently red. `certbot renew --dry-run` now reports
  **"all simulated renewals succeeded"** across all 5 remaining certs.
- **Disabled `caddy.service`** — enabled-but-failed with no journal history; nginx is the real
  proxy, and a second one could contend for :80/:443 on reboot.
- **Cleared stale failed states** for `ai-gateway`, `caddy`, `certbot`. The only unit still failed
  is `systemd-networkd-wait-online.service`, a benign boot-time unit.
- **Pruned Docker**: 5.75 GB of unused images + 1.33 GB build cache. Disk 63 GB → **55 GB used
  (15% of 387 GB)**. Note this removed the immich images; restoring immich would need
  `docker compose pull` against the retained `/opt/immich/docker-compose.yml`.
- CPU idle steady at **~66%**.

**Deliberately NOT deleted:**

- **`/opt/immich` (21 GB) — kept.** The backlog proposed deleting it on `du` output alone. On
  inspection it is **not** an app directory: `library/` holds **4,445 media files** (jpg/png/heic/
  mp4/mov) dated Feb 16–Jun 24 2026 plus `backups/`, `upload/`, `thumbs/`, `encoded-video/`, and a
  268 MB Postgres directory. Deleting it would have destroyed a live photo library. Only the
  containers were gone; the data was always there.
- **`/opt/ai-gateway` (2.7 GB) — kept** at the owner's request for possible future use. The service
  remains `disabled`.
- **`chat_agent_bot` / `chat_agent_postgres` — kept**, pending a decision. See BACKLOG.

### VPS ops: disabled the `ai-gateway` crash loop burning a CPU core on the Supabase host

- **Disabled `ai-gateway.service`** (`systemctl disable --now`) on the Contabo VPS that hosts
  production Supabase. It had been crash-looping since roughly boot with a systemd **restart
  counter of 350,805**.
- **Root cause:** `/opt/ai-gateway` is owned by UID `501`/group `staff` (a macOS owner — the tree
  was copied from a Mac and never re-owned) while the unit runs as `www-data`, so
  `deepface`'s `os.makedirs('/opt/ai-gateway/.deepface')` raised `PermissionError` at import time.
  With `Restart=on-failure`, `RestartSec=5` and no start limit, it retried forever, **importing
  TensorFlow (~9.3 s CPU) on every attempt** — roughly 907 CPU-hours burned in total.
- **Latent risk removed:** the unit was configured to bind `0.0.0.0:8000`, the port already owned
  by `supabase-kong`. It always died at the deepface import before binding, but on a reboot where
  it won the race it would have taken down the entire Supabase API gateway.
- **Measured recovery** (2 minutes after stop): load average **3.05–3.28 → 1.98** (still decaying),
  CPU idle **9.4% → 76.0%**, user CPU **54.7% → 6.0%**. `supabase-kong` and all Supabase
  containers stayed healthy. No VoltFlow service depended on the gateway — it had not served a
  request in ~61 days.
- **Not applied:** the proposed `StartLimitBurst` guard is moot while the unit is disabled. The
  ownership fix was not attempted since the service was not wanted.
- **Follow-up, not done:** the host runs Grafana, Prometheus and uptime-kuma yet none alert on a
  climbing systemd restart counter, which is why this ran undetected for ~61 days.
- Separately observed and **left alone**: 440 zombie `curl` processes parented to
  `python start_local.py` in the unrelated `f1-news-bot-f1-news-main-1` container. Zombies consume
  no CPU or memory and 736 PIDs against a `pid_max` of 4,194,304 poses no exhaustion risk — it is
  a latent bug in that project, not a VoltFlow issue and not the cause of the load.
- Repository files were not changed; this was VPS ops only.

---

## 2026-07-20

### Security hardening: PWA, GPS privacy, paired Mate credentials, and website defenses

- Applied production migrations `20260720150000_security_gps_retention_and_mate_key_hash.sql`
  and `20260720153000_revoke_telemetry_purge_public_execute.sql`. Exact stale live GPS is
  removed after 24 hours while non-location live status remains available. Premium/Admin raw
  telemetry, hourly records, and original route points are retained without a time limit.
- Removed authenticated HTML from the service-worker cache, cleared private browser storage on
  sign-out/account deletion, and stopped persisting browser GPS. Saved tariff locations remain
  the explicit, user-owned Postgres/RLS record. Settings now provides a recent-data export.
- Replaced plaintext Mate-key issuance with peppered hashes and short-lived pairing-code rotation.
  Existing credentials are upgraded on proven use; Settings and profile mappings no longer expose
  raw keys. The production `BYDMATE_API_KEY_PEPPER` is sensitive in Vercel and present in the
  self-hosted Edge Functions container.
- Added HSTS, referrer, content-type, permissions, CSP report-only, and Telegram-compatible
  frame protections. Both ingest paths authenticate before parsing, bound declared request sizes,
  and whitelist persisted payload fields.
- Corrected all privacy-policy languages to state the Premium retention behavior, upgraded Next
  to 16.2.10, and moved the Shadcn CLI out of production dependencies.
- Verified directly in production: profile hash columns exist, the purge clears stale locations,
  Premium tracks are preserved, the Edge Function container is healthy, and only `service_role`
  has execute access to the retention-purge function.

### GoTrue Auth incident diagnostics and alert hardening

- Investigated recurring GoTrue `GET /user` 500s on 18 and 20 July. The failures were
  transient local Auth-to-Postgres connection handshakes (SASL read timeout, canceled
  DB receive, and canceled TCP dial), not database saturation: the retained incidents
  had 27–31 of 100 Postgres connections, host CPU below 14%, load below 1, and zero Auth
  or Postgres container restarts.
- Kept the existing sensitive `sb-auth-5xx` Telegram warning. Added
  `sb-auth-5xx-sustained` as a **critical** Telegram alert for five or more Auth 5xx
  responses in ten minutes, sustained for two minutes.
- Added the **Auth incident correlation** panel to the self-hosted Supabase dashboard:
  Auth 5xx count, Postgres connection percentage, host CPU, and Auth/DB restart count
  share the same time range.
- Backed up the live Grafana provisioning files under
  `/opt/monitoring/backups/20260720-auth-incident/`, reloaded only Grafana, and verified
  successful alert/dashboard provisioning plus Grafana HTTP 200. Supabase Auth and
  Postgres were not restarted and remained healthy.
- Added the private [Auth 5xx triage runbook](docs/OPS_LOCAL.md) with the exact
  read-only Contabo commands. No user-facing data model, preference, Postgres table, or
  application code changed.

### Vehicle navigation responsiveness

- `/vehicle` now streams a Vehicle-specific loading shell immediately while the existing
  server-side `isCurrentUserAdmin()` lookup resolves behind its own Suspense boundary. The
  verified result then renders the admin-only control panel; no authorization path was loosened.
- The viewer-gated fast-status heartbeat has one owner in `MobileShell`. Screens may share the
  live query without each issuing another 8-second profile update, eliminating the duplicate
  heartbeat that occurred on Vehicle.
- No user data model, preference, or storage location changed: the existing expiring
  `profiles.live_fast_until` / `live_fast_vehicle_id` state remains app-owned in Postgres.

### Cloud offload Phase 4 follow-up: take the stray check and stub insert off the hot path

`20260720150000_bydmate_client_trip_hot_path.sql`, applied to prod 2026-07-20, same day as the
migration it corrects.

- **The as-shipped Phase 4 branch saved less per sample than intended.** Every `client_trip`
  sample ran an extra `SELECT` over the vehicle's open trips (the stray-close loop) *and* an
  `insert … on conflict (id) do nothing` PK probe, on top of the `SELECT … FOR UPDATE` that
  already runs above the branch. Net effect: one trip `UPDATE` traded for one `SELECT` plus one
  no-op `INSERT` — a real but modest win, not the "skips trip create/extend" the plan implied.
  The large win was always per *trip* (`bydmate_finalize_trip_energy`'s full-window scan) and was
  never affected.
- **Fix:** guard both on `v_trip.id is distinct from v_client_trip_id`. `bydmate_trips_open_unique`
  permits one open trip per user+vehicle, so when the `FOR UPDATE` select already found *this*
  trip there can be no stray and the row must exist. Steady state is now `FOR UPDATE` select +
  track point insert + count update; only a trip's first sample (or one arriving after the trip
  closed) takes the full path.
- Guards on `v_trip.id`, not plpgsql's `FOUND` — `FOUND` is reset by every intervening
  `INSERT`/`UPDATE`/`SELECT INTO`, and ~50 lines separate the select from the branch.
- Verified with the same rolled-back prod transaction plus three new assertions covering both
  sides of the guard (first sample with a stray present, steady-state sample, sample after close).
  All 11 checks passed; post-apply the fleet stayed sub-30 s fresh including a car on 0.4.8.

### Cloud offload Phase 4 (cloud side): APK-owned trips

Server half of Phase 4 in `BYDMate-own/docs/CLOUD_OFFLOAD_PLAN.md`. The APK half shipped
in v0.4.9 and had been inert; driving is 73.2% of all samples, so the per-sample trip
create/extend was the largest remaining lever after Phase 3.

- **Migration `20260720140000_bydmate_client_trip_rollup.sql`** — applied to self-hosted prod
  2026-07-20. Adds `bydmate_trips.client_trip`; redefines the 9-arg `bydmate_ingest_telemetry`
  with a `v_client_trip` branch that stubs the trip row and writes the track point but skips
  the server's create/extend, weighted means and `trip_meter_baseline_km` arithmetic; adds
  `bydmate_apply_client_trip`.
- **`bydmate_finalize_trip_energy` is now skipped for client-owned trips.** It re-integrates
  regen/traction by scanning `bydmate_telemetry_samples` across the whole trip window, which
  both wasted the scan and overwrote the client's own figures with a second estimate that the
  next cumulative block would flip back.
- **The RPC is UPDATE-only, deliberately.** Row creation belongs to the ingest stub. As an
  upsert, a block arriving after `bydmate_discard_trip_if_junk` had *deleted* a junk trip would
  resurrect it as a newly-open row and re-collide with `bydmate_trips_open_unique`.
- **Stray-trip close is mandatory, not defensive.** `bydmate_trips_open_unique` is a partial
  index, so `on conflict (id) do nothing` would not absorb a violation from a different open
  trip — the stub insert would raise and fail the whole ingest.
- **The 5-minute gap close no longer applies to client-owned trips** (the client owns that
  lifecycle via its gear-P/charging markers and 20-minute next-boot finalizer). It remains the
  fallback for every server-owned trip, including via the daemon's untagged post-car-off samples.
- `ingest-payload.ts` gained `client_trip` / `trip_id` and `tripBlockSchema`; `route.ts` applies
  blocks best-effort after the samples land and reports `trip_rollup_applied`.
- **Verified before the real apply** by running the migration plus eight assertions inside a
  transaction against prod and rolling back: stub creation, stray close, block apply, stale-block
  rejection, equal-count idempotency, no junk-trip resurrection, no reopen-after-close, and an
  old-APK sample still taking the original server path. Post-apply, five cars stayed sub-minute
  fresh including two on old APKs (0.4.7, 0.4.8).

### Documentation correction: telemetry, notifications, API, and schema

- Reconciled the canonical architecture, telemetry, and Mate API references with the shipped
  viewer-gated fast-status path: short-lived per-vehicle grants, command-poll
  `live_fast_seconds`, and history-free `live_only` snapshots.
- Corrected the paired-client identity rule, command acknowledgement contract, and command-status
  enum (`pending / sent / done / failed / rejected`).
- Renamed the paired-client contract from `BYDMATE_APK_API.md` to
  `VOLTFLOW_MATE_API.md` and updated every repository reference to use **VoltFlow Mate API**.
- Expanded the notification reference to cover both the existing Telegram widget and Android's
  tag-replaced live-status web push, including the Postgres ownership of the user preference and
  app-owned throttle state.
- Brought the schema reference in line with the shipped live-status, end-of-charge cell-delta,
  and provider-corrected efficiency-observation fields. Corrected `vehicle_connected_at` to its
  first-accepted-telemetry/onboarding meaning.
- Made the charging-session reference name the implemented auto-start/stop and backdating rules,
  and corrected its focused test instructions. Documentation verification was limited to source
  comparison and local Markdown checks; no app build, lint, tests, migrations, or deployment ran.

### Viewer-gated fast live status (2-5 s instead of 30-60 s)

- **Problem.** The PWA's status is only as fresh as Mate's *delivery* cadence, which is
  batched on purpose (60 s charging-bulk and parked, 15 s driving) — correct when nobody is
  looking, wrong when the owner has the app open. The v0.4.9 transition ping was too narrow:
  it covered only moving/charging edges, only from the app, and had **no logging**, which is
  why a manual plug/unplug test could not be judged either way.
- **Design (owner chose option B over an always-on 3 s heartbeat).** The car pushes fast only
  while someone is watching, so cloud-offload phases 0-3 keep their savings. The PWA live view
  heartbeats every 8 s (`requestLiveFastStatus`, `src/actions/live-status.ts`) stamping
  `profiles.live_fast_until` (+20 s) and `live_fast_vehicle_id`; `GET /api/bydmate/commands`
  returns the remaining seconds as `live_fast_seconds`, and Mate pushes a `live_only` snapshot
  every 3 s while it lasts. The window is **only ever extended, never cleared** — expiry is
  what stops it, so a crashed tab or dead network cannot strand a car in fast mode.
- **Zero added cost on the hot path.** The flag lives on `profiles` because
  `resolveBydmateApiKeyProfile` already reads that row on every ~6 s command poll. Verified
  first that `profiles` carries no `BEFORE UPDATE` trigger, so this does not repeat the
  `knowledge_articles`/`view_count` `updated_at` trap. `live_fast_vehicle_id` keeps it
  per-vehicle so watching car A never speeds up car B.
- `BYDMATE_LIVE_REFETCH_DEBOUNCE_MS` cut 5 s → 1 s; it was a hard floor under the 2-5 s target.
- Migration `20260720130000_live_view_fast_status.sql` (idempotent, two nullable columns) —
  **applied to self-hosted prod and verified**.
- **Verified live in prod**, not just in tests: during a granted window the `way` live snapshot
  ran 5-9 s old carrying `live_only=true`; after expiry it fell back to 24-68 s and normal
  batched samples — proving both the speed-up and the auto-lapse. Real PWA sessions were
  observed stamping the column for three separate vehicles, confirming the deployed bundle
  runs the heartbeat.
- APK side is BYDMate-own v0.4.10 (`LIVE_FAST_PING_INTERVAL_MS`, poller wiring, and the daemon
  equivalent). `npx tsc --noEmit` clean; BYDMate-own suite **506/506**, including 8 new
  `CommandDaemonTest` cases.
- **Measured on the car, both senders:**

  | Path | Before | After |
  | --- | --- | --- |
  | Car on (app) | 15-60 s | live snapshot 5-9 s old during a grant |
  | Car off (daemon) | ~60 s, up to ~3 min across an app→daemon handover | **~3 s** |

  The car-off path took three passes, and the push interval was never the binding constraint:
  8-9 s at first, ~5 s after the wake rate was raised, and **~3 s** (24 consecutive pushes,
  2-4 s apart) only once both real causes were fixed — the command poll moved to its own
  thread so its round trip left the status period, and the sleep switched from fixed-delay to
  fixed-rate (`pacedSleepMs` subtracts the elapsed work, since sleeping 3 s *after* 2 s of
  work yields a 5 s period). Both paths are now inside the 2-5 s target.

  Because commands no longer sit in the status loop's critical path, the command poll was
  **returned to its relaxed 6 s** even while the live view is open — grants outlive a poll, so
  the earlier 3 s polling cost bought nothing.
- The 60 s history rhythm was confirmed to survive fast mode in the live trace (plain,
  non-`live_only` pushes 64 s apart while status pushed every ~5 s between them).

### Diagnosis: why a 30-second plug/unplug test shows no status change

Not a bug. Auto-stop requires **two consecutive** unplug samples, but the instant the car
reads as unplugged the cadence drops from the 10 s charging rate to the 30 s parked heartbeat.
A ~30 s unplug therefore yields exactly **one** unplug sample before the replug, the session
correctly stays `charging`, and the PWA — which drives its charging display off that open
session — has nothing to change. A valid manual test must leave the charger out for 60-90 s.

## 2026-07-19

### Smart Charge "Loose Mode": provider-corrected sessions + learned efficiency

- Finished sessions (`completed`/`stopped`) can now be corrected with the provider's
  billed kWh and total amount paid (`EnergyCorrectionCard` on the history session detail
  page → `correctChargingSessionEnergy` in `src/actions/session-corrections.ts`). Only
  energy/cost/price are editable — SOC and timestamps stay telemetry-derived, since they
  define the session's analysis window.
- The correction sets `energy_overridden = true` (this is the flag's first runtime
  writer — it previously existed only as a repair-migration marker) plus a new
  `energy_corrected_at` timestamp, and inverts the session energy formula
  (`measuredEfficiencyForSession` in `src/lib/charging-efficiency-learning.ts`) to log a
  measured-efficiency observation into the new `charging_efficiency_observations` table,
  snapshotting the session's telemetry-window average battery temp, outside temp, and
  charge power at correction time (telemetry is purged by retention, so it can't be
  recomputed later).
- Observations aggregate per car + efficiency group (AC covers `home`/`commercial_ac` →
  `cars.default_efficiency_percent`; `fast_dc` → `cars.fast_dc_efficiency_percent`).
  `suggestEfficiency` surfaces the median of the most recent 10 observations once there
  are ≥3, they agree within a 5-point spread, and the suggestion differs from the
  configured value by ≥1 point — shown with its evidence next to each efficiency field in
  car settings, applied only on explicit user tap (`applySuggestedEfficiency` in
  `src/actions/cars.ts`). Never auto-applied.
- New migration `20260720120000_charging_efficiency_observations.sql`
  (idempotent, RLS-scoped). 11 new tests in `charging-efficiency-learning.test.mjs`
  cover the measurement math and suggestion gating (sample count, spread, noise
  threshold, windowing). Full test suite (154 tests + the excluded auto-session suite),
  `tsc --noEmit`, and `npm run build` all pass. See
  `docs/CHARGING_SESSIONS.md` → "Provider corrections & learned efficiency".
- **Not yet verified**: local Docker/Supabase wasn't running in this session, so the
  migration was reviewed against two close analogs (`20260630140000`,
  `20260706180000_user_providers.sql`) but not executed. Run
  `npm run db:migrations:up` (or the self-hosted `psql -f` path) and do a manual
  correct→suggest→apply smoke test before relying on this in prod.

### BYDMate-own: instant status ping on drive/charge state transitions

- Investigated user report of ≥1 minute delay before drive/charge/parking status updates
  in the PWA. Root cause lived entirely in the sibling **BYDMate-own** APK repo, not in
  this repo's ingest/read path: the Mate APK samples fast but *delivers* in batches, and
  neither the park→charging nor charging→park (unplug) transition triggered a prompt
  flush (a full prompt flush was deliberately dropped 2026-06-24 — draining the queue
  resets `activeBatchStartedMs` and delays the bulk batch charging auto-start needs).
  Worst case: charging-bulk flush 60s + parked flush 60s, plus this repo's 5s Realtime
  debounce (`use-bydmate-live-query.ts`) — landing right at the observed "≥1 minute".
- Fix (BYDMate-own `CloudTelemetrySender.kt`): on a moving/charging state edge that
  doesn't already trigger `flushNow`, stage one single-sample `live_only=true` payload
  and POST it immediately on the next `flushPending()` tick — **outside** the Room queue,
  never touching `activeBatchStartedMs`/`lastFlushAttemptMs`, so batch economics and
  charging auto-start timing (still ~t+60s) are unaffected. The queued full sample for
  the same transition remains the durable history record; the ping is fire-and-forget.
  4 new tests in `CloudTelemetrySenderTest.kt` (ping on charge-start, ping on unplug,
  ping doesn't reset the 60s bulk flush, no ping in steady state). Full suite 495/495
  pass (`./gradlew testDebugUnitTest`).
- This repo needed **no code change**: the `live_only` fast path (migration
  `20260716100000_bydmate_live_only_fast_path.sql`) already upserts only
  `bydmate_live_snapshots` for `live_only` payloads, keyed purely on the payload flag —
  confirmed no parked-only guard blocks a ping sent from a moving/charging state.
- Dual-sender architecture (Mate APK when car on; shell-uid `CommandDaemon` heartbeat
  when car off, gated by a 120s app-alive-beacon TTL) was reviewed and found sound;
  no change made there — out of scope per user's chosen fix.
- Not yet verified live on the car (needs `adb install` of the updated APK + a real
  plug/unplug cycle); unit-tested only as of this entry.

### Android live lock-screen charging/parked status (updating web push)

- New `src/lib/push/live-status-notifications.ts`: during charging the ingest route
  pushes a silently tag-replaced notification (~1/min, matching Mate's 60s charging
  batches) with SOC, charge power, delta since charge start, and a rate-derived ETA
  to 100%; leaving charging buzzes one audible "Charging finished" final. Optional
  `charging_parked` mode adds a parked card (refresh on ≥1% SOC drift or 30 min)
  cleared on drive-away via a new SW `kind:"clear"` push. 7 unit tests on the pure
  state machine (`nextLiveStatusState`).
- Apple endpoints (`*.push.apple.com`) are excluded via a new `endpointFilter` option
  on `sendPushToUser` — iOS cannot silently replace notifications, so iPhones keep
  milestone notifications only. True iOS live surfaces (Live Activities) would need a
  native wrapper; deliberately out of scope.
- Data placement per change gate: preference `profiles.live_status_mode`
  (`off|charging|charging_parked`, default `charging`) is user-owned and lives in
  Postgres because the *server* decides whether to push at ingest time; throttle
  state is app-owned in new `bydmate_live_status_state`. Both in idempotent migration
  `20260719120000_live_status_notifications.sql` — **applied to self-hosted prod**
  (psql via Supavisor pooler per `docs/OPS_LOCAL.md`; verified column default,
  RLS enabled, 4 policies). Local dev DB was down — apply there with
  `npm run db:migrations:up` when it's next running.
- `public/sw.js` push handler now honors payload `renotify`/`silent` and `kind:"clear"`
  (backward compatible; milestone payloads unchanged). Settings → notifications gained
  a three-mode selector (en/be/ru). Full test suite (143), lint (no new issues), and
  production build passed.

## 2026-07-18

### Android install-fallback icon fix

- `InstallPrompt` and `StartTrackingButton` show manual "add to home screen"
  instructions whenever the browser hasn't (or no longer) fires
  `beforeinstallprompt` — notably on Android after a user uninstalls the PWA,
  since Chrome suppresses the event again for a cooldown period tracked at
  the browser-profile level, outside app control.
- Both components previously showed the iOS `Share` icon on that first
  instruction step regardless of platform. Android's actual entry point is
  the browser's ⋮ overflow menu, not a share sheet, so the icon was
  misleading. Now renders `Share` on iOS and `MoreVertical` otherwise.
- `npx tsc --noEmit` passed.

### Admin users needs-attention queue

- Added an expandable, actionable queue to `/admin/users`. It surfaces accounts with no
  telemetry for 7 or 30 days, a Mate version behind the current release, no Mate
  activation after seven days, or a premium term ending within 14 days.
- Added service-role-only `admin_users_attention_queue()` RPC in migration
  `20260718120000_admin_users_attention_queue.sql`. It derives results from existing
  facts, persists no new user data, and excludes admins/manual-premium users from the
  expiring-term queue.
- Production verification returned 2 accounts stale for 30 days, 1 stale for 7 days,
  4 needing a Mate update, and 29 never activated. Anon/authenticated roles cannot
  execute the RPC.
- Focused mapper tests, targeted lint, and `npx tsc --noEmit` passed. The first build
  passed before the final show-all control; its immediate retry stalled after compilation
  and was stopped.

### Admin users dashboard KPIs and lifecycle metrics

- Added four `/admin/users` cards: connected users today, current registered users,
  registered/removed accounts today, and all-time recorded trips.
- Added `admin_user_lifecycle_daily` with Minsk-day registration/removal counters. It
  stores aggregate counts only, with no deleted-user identifiers, and backfilled 54
  historical registrations on deployment. Removal tracking starts on 2026-07-18.
- Added the service-role-only `admin_users_dashboard_stats()` RPC. The route now uses
  database-side distinct/count aggregates instead of downloading a capped snapshot list.
- Added focused stats-mapping tests. Targeted lint and `npm run build` passed.
- Production migration `20260718110000_admin_users_dashboard_metrics.sql` was applied
  through the self-hosted Supavisor pooler. Read-only verification returned 4 connected
  users, 54 registered users, 5,375 trips, and denied RPC/table access to anon and
  authenticated roles.

## 2026-07-17

### Phantom drain now measures parked intervals only

- Fixed `bydmate_phantom_drain_daily`: parked time is no longer merely an eligibility
  filter around a whole-day `first SOC - last SOC` subtraction. Movement, charging, UTC
  midnight, and telemetry gaps of six hours or more now split continuous parked runs;
  only positive net SOC loss inside a run of at least four hours is counted.
- Added a shared TypeScript interval reducer for the paginated fallback plus six focused
  regression tests covering same-day trips/charging, genuine parked loss, SOC jitter,
  six-hour gaps, multiple parked runs, and the Di+ unplugged-state override.
- Migrations `20260717133852_fix_phantom_drain_parked_intervals.sql` and
  `20260717134341_restrict_phantom_drain_rpc_grants.sql` were applied individually to
  self-hosted production. The follow-up removes a stale explicit `anon` execute ACL while
  retaining `SECURITY INVOKER` and authenticated/service-role access.
- Production verification for vehicle `way`: 2026-07-14 no longer reports the false 43%
  drain created by 168.3 km of driving and two charging sessions. Across July, the old
  large whole-day artifacts are replaced by 1-3% results only where qualifying continuous
  parked intervals actually lost SOC.
- Verification: focused lint passed, `npx tsc --noEmit` passed, and all 139 Node tests
  passed.

### Historical end-of-charge cell-delta trend (History → Analytics)

- **Why:** the balance signal actually worth tracking is how the end-of-charge cell
  delta moves *across* charges (partial charges let it grow, charges to 100% bring it
  back down). That arc previously required opening the per-session "Delta by SOC"
  chart for every charge, one at a time.
- **Persisted, not computed on read:** raw `bydmate_telemetry_samples` are pruned
  (30 d free / 365 d premium) and `bydmate_telemetry_hourly` has no cell-delta column,
  so a compute-on-read chart would silently truncate to the retention window. Migration
  `20260717120000_charging_session_end_cell_delta.sql` adds nullable
  `charging_sessions.end_max_cell_delta_v` + `end_delta_soc`, the
  `bydmate_capture_session_end_delta(uuid)` RPC (max delta measured **while charging**
  within 1 SOC point of the session end — delta relaxes once current stops), and an
  idempotent backfill of closed sessions whose samples still exist.
- **Captured at every session close**, never on the per-second SOC path: auto-stop and
  supersede-on-start (`bydmate/charging-auto-session.ts`), silence-close only in
  `charging-session-reconcile.ts` (the value-repair path re-runs over already-closed
  sessions and must not re-trigger it), manual stop and supersede-on-start
  (`actions/sessions.ts`). `bydmate/charge-end-delta.ts` keeps the capture non-fatal —
  a session must still close if the RPC fails or the migration is not applied yet.
- **Only charges to 100% are plotted, and that is physics, not taste.** The first cut
  charted every charge; the backfilled data then showed partial charges land at
  **4-12 mV (avg 7)** and tail charges at **10-347 mV (avg 260)** — a 37× gap, because
  LFP cells only spread apart on the steep knee at the top. One linear axis would flatten
  every real movement of the tail delta into the bottom pixel row. Partial charges are
  the *cause* of drift, so they ride a context rail under the axis and are counted into
  each full charge's tooltip ("2 partial charges since the previous").
- **Anchor the end phase on measured peak SOC, not `current_percent`** (migration
  `20260717130000_charge_end_delta_peak_soc.sql`). The first backfill exposed a session
  row stuck at `current_percent = 86` whose samples had clearly charged to 100%; anchoring
  on it made the end phase "SOC ≥ 85", which swept in the real tail and filed a 265 mV
  reading as a partial charge's delta. The session row can be stale, the samples cannot.
  Also raised capture from 92 → 122 of 143 closed sessions.
- **Chart:** new card next to SOH in `VehicleAnalyticsPanels`; x = charge date, y = peak
  delta in mV. Tooltip carries date, delta, the SOC it was measured at, nearest SOH, and
  the partial-charge run that preceded it.
- **Egress:** served by its own `useChargeDeltaHistoryQuery` (few columns, no polling)
  rather than `useSessionsQuery`, which polls at up to 1 Hz in the balance tail.
- Pure `buildChargeDeltaTrend` + 10 tests in `src/lib/bydmate/charge-delta-trend.test.mjs`.
  EN/BE/RU labels added.
- **Both migrations applied to self-hosted prod on 2026-07-17** (`psql -f` via the pooler;
  local Supabase was down, so they were never applied locally). Backfill recovered history
  to **17 May** — the raw-sample retention floor. 52 charges to 100% carry a tail delta
  (190-322 mV over the last week); the 21 uncaptured closed sessions are 7 older than the
  sample window and 14 without cell telemetry.

### Parked vehicle hero shows driving context instead of zero speed

- Replaced the parked-only `0 km/h` speed tile with distance-weighted average
  consumption from the same latest ~50 km trip window used by range estimation.
- Driving retains live speed; charging and stale layouts are unchanged.
- Added localized EN/BE/RU label. No data is added or persisted.

### Parked vehicle hero reports recent-50-km energy

- Changed the parked-only tile from a `kWh/100 km` rate to its normalized
  recent-50-km energy equivalent, for example `~9.9 kWh`.
- The `~` clarifies that the result is calculated from the same distance-weighted
  recent-drive window, not cut as an exact raw-meter 50 km segment.

### Parked 50 km tile hierarchy

- Kept the `Last ~50 km` label at the top and vertically centered only its
  `~9.9 kWh/50km` value.
- Other vehicle metrics retain their existing layout.

### Parked 50 km tile, narrow-screen correction

- Split the parked Consumption tile into its top label, centered `~9.9` number,
  and bottom `kWh/50km` unit so it cannot wrap into the label on narrow phones.

### Parked 50 km tile, readable context

- Replaced the formula-style bottom unit with a localized “Last 50 km” context
  line, while retaining `~9.9 kWh` together as the centered value.

### Parked telemetry grid cleanup

- Made the page’s parked state authoritative for the lower telemetry grid, so
  `kWh charged` is hidden even when the raw telemetry flag is inconsistent.
- Battery and outside-temperature cards now occupy an equal two-column row.

### Parked temperature row always visible

- Replaced the mixed raw-telemetry filter with an explicit parked-only list of
  Battery temp and Outside temp, preventing the entire row from disappearing.

### Parked temperature placeholders

- Kept both parked temperature cards visible when fresh values are absent,
  displaying `—` instead of collapsing the row before Trips.

### Expanded trip energy per kilometre

- Added `Energy per km` to expanded trip cards, calculated directly as measured
  trip energy divided by trip distance, alongside total trip consumption.
- Added EN/BE/RU labels and a safe unavailable-value display for missing or
  zero distance.

### Expanded trip net consumption after regeneration

- Added a full-width bottom metric using `(trip energy − recovered energy) ÷
  trip distance × 100`, displayed in `kWh/100 km`.
- Added EN/BE/RU labels and preserves an unavailable marker when inputs are
  missing or trip distance is zero.

### Vehicle trip cards now show actual energy use

- Day trip rows now show measured traction energy (`kWh`) first, with `kWh/100 km`
  as secondary efficiency.
- Daily summary includes complete measured driving energy across all selected-day
  trips beside the weighted consumption rate.
- If any displayed trip lacks measured energy, the day total is omitted rather
  than partial or inferred.
- Added EN/BE/RU copy and focused unit coverage.

### Expanded trip cards use exact trip consumption

- Replaced the legacy “Traction” wording with the localized “Trip consumption”
  value in `kWh`.
- Removed the redundant `kWh/100 km` tile from individual expanded trip cards.
  Comparative consumption remains in daily and history summaries.

## 2026-07-16

### Telegram compact cockpit for Xiaomi and iPhone WebViews

- Turned Telegram's live viewport and content-safe-area values into shell CSS
  tokens, so the authenticated cockpit follows the usable WebView height rather
  than assuming browser `dvh` alone.
- Added a phone-width Telegram-only compact mode for the dashboard: reduced
  duplicate header, card, and spacing overhead while keeping the full vehicle,
  charging, latest-trip, and latest-charge UI.
- Hardened the five-target bottom navigation at 360–375 px with 44 px touch
  targets, compact labels, and safe bottom padding for iPhone home indicators.
- Standalone PWA layout is unchanged. No data model, data ownership, or storage
  behavior changed.

### Telegram widget preview now reflects driving state

- Replaced the hardcoded `P` mileage prefix in the compact Telegram chat-list
  preview with an explicit state marker: `D`, `P`, charging, or offline.
- Kept the detailed Russian state line and the existing 30-second edit throttle.

### Documentation sync pass — DATABASE_SCHEMA, VEHICLE_STATE_NOTIFICATIONS, ARCHITECTURE, MIGRATIONS_AUDIT

- Followed a codebase-vs-docs audit that found the July 6–15 code (provider rework,
  Telegram-bot wave, battery snapshots) undocumented or actively misleading.
- **`docs/VEHICLE_STATE_NOTIFICATIONS.md` rewritten**: it documented a deleted feature
  (`bydmate_vehicle_state_notifications`, dropped `20260706000000`;
  `src/lib/push/vehicle-state-notifications.ts` no longer exists). Replaced with the
  actual current behavior — the Telegram live-status widget
  (`src/lib/telegram/live-widget.ts`, `telegram_live_messages` table, 30 s edit
  throttle, offline-gap re-send behavior).
- **`docs/DATABASE_SCHEMA.md` updated**: removed the dropped table from the ER diagram
  and column list; added `user_providers` (+ `charging_provider_type` enum value
  `user_provider`, `charging_sessions.user_provider_id`/`.tariff_selected_at`),
  `telegram_live_messages`, `bydmate_battery_snapshots`, `bydmate_idle_drains`,
  `bydmate_trips.source`/`.fuel_kwh` (flagged the `fuel_kwh` unit as still ambiguous —
  column name says kWh, migration comment says "liters equivalent"),
  `knowledge_article_views`, `profiles.last_active_at`/`.inactivity_warning_sent_at`,
  `cars.fast_dc_efficiency_percent`, and a new "Community marketplace" section for
  `telegram_group_events` + `community_listings`.
- **`docs/ARCHITECTURE.md` + `.ru.md`**: fixed the Notifications subsystem row and
  doc-map entry to describe the live widget, and added a new **Telegram bot**
  subsystem row. That row corrects a discovery made while writing it: the real
  registered Telegram webhook is `scripts/telegram-miniapp-server.py` (a separate
  Python edge server), not `src/app/api/telegram/webhook/route.ts` — that Next.js
  route only sends the PWA deep-link reply and was never part of the live group-event
  → classification → `community_listings` path. This had already been corrected twice
  in this file's 2026-07-15/16 entries below; the architecture doc simply never
  reflected it until now.
- **`supabase/MIGRATIONS_AUDIT.md`**: added a chain-currency note (last full audit
  stopped at `20260602120000`; chain now runs through `20260715100000`) plus two
  same-day create-then-drop traps for anyone reading migrations linearly
  (`provider_tariffs` created and dropped both on `20260706`;
  `bydmate_vehicle_state_notifications` created `20260629`, dropped `20260706`).
- Canonical domain docs (CHARGING_SESSIONS.md, TRIPS.md, KNOWLEDGE_SEARCH.md,
  TELEMETRY.md) were checked and found accurate — no changes needed there.

### Final correction: Telegram marketplace classification pipeline is fully built and live

- The prior same-day correction (below) was *also* wrong: it said classifying
  `telegram_group_events` and inserting `community_listings` drafts was the remaining
  gap. It isn't — `scripts/telegram-miniapp-server.py`'s
  `process_telegram_group_event()` already does exactly that, calling
  `verify_telegram_text()` (a Python twin of `verifyTelegramContext`) and
  `upsert_community_listing()` inline on every webhook call via a background thread,
  plus a `process_pending_group_events()` batch retry path.
- Verified against **live data**, not just source: the last 10 real messages in the
  BYD group all show `status: "processed"` with correct `intent`/`needs_review`/
  `actionable` and `verified_at` 3–7 s after `sent_at`.
- `BACKLOG.md`'s marketplace entry rewritten a final time: only a deterministic
  pre-filter (cost/latency optimization — every message currently triggers an LLM
  call unconditionally), search/matching (`market_listing` source type), and listing
  expiry remain, none urgent.

### Correction: Telegram group-event capture already existed (BACKLOG.md was wrong twice)

- The 2026-07-15 "webhook wiring" gap description was itself wrong: Telegram's actual
  registered webhook is `https://bot.voltflow.life/voltflow/api/telegram/webhook`
  (confirmed via `getWebhookInfo`), served by the **Python edge**
  `scripts/telegram-miniapp-server.py`'s `handle_webhook()` — not the Next.js
  `src/app/api/telegram/webhook/route.ts` route previously audited.
- That Python edge already has `normalize_group_event()` /
  `upsert_telegram_group_event()` writing every message from the real BYD group
  ("Купи и езди на BYD YUAN UP (Беларусь)", chat id `-1002179930838`) into Supabase
  `telegram_group_events`, confirmed live via prod-db query (current organic traffic).
- Corrected `BACKLOG.md` again: the real remaining gap is classifying already-captured
  `telegram_group_events` rows and inserting `community_listings` drafts, not "webhook
  wiring." Removed a temporary diagnostic `console.log` added to the (irrelevant)
  Next.js route during this investigation.

### Dashboard charging card: live progress and price to 100%

- Replaced the low-contrast charging summary line with two additional prominent stat
  boxes: remaining time plus charged kWh on the left, and estimated price to 100% on
  the right. Existing Pack and Charger boxes remain visible, giving the charging state
  four boxes in total.
- Reused the existing live session SOC, tariff, battery capacity, and efficiency math;
  added English, Belarusian, and Russian labels. No schema or API changes.
- Verification: `npm run lint`, `npm run build`.

---

## 2026-07-15

### Telegram community marketplace: data model + admin CRUD + verifier built (webhook wiring still pending)

- Retroactive documentation fix: `BACKLOG.md`'s "Telegram community marketplace" entry
  still read as a from-scratch proposal after this had already landed. Confirmed via
  git history (`f924b8a`, `2a833d6`, `667254c`, `d67ffe4`, 2026-07-14/15) and the
  current tree.
- **Shipped:** `community_listings` Postgres table (migrations
  `20260714160000_community_listings.sql`,
  `20260715100000_community_listings_admin_privileges.sql`); admin CRUD module
  `src/lib/supabase/community-listings.ts` (`getAdminCommunityListings`,
  `updateCommunityListing`, `updateCommunityListingStatus`, `deleteCommunityListing`);
  admin navigation UI for reviewing/editing/removing listings; the Ollama-compatible
  context verifier `src/lib/llm-context-verifier.ts` (`verifyTelegramContext`,
  `parseVerification`, `isPublishableVerification`), fully unit-tested and configured
  via `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY`/`LLM_MAX_TOKENS`.
- **Not yet built** (the real remaining scope, kept in `BACKLOG.md`): the Telegram
  webhook (`src/app/api/telegram/webhook/route.ts`) never calls
  `verifyTelegramContext` or touches `community_listings` — no deterministic-cue
  pre-filter, no automatic draft-listing creation from group messages. There is also
  no `create`/insert function in `community-listings.ts` yet — only get/update/delete.
  Search integration (`market_listing` source type in vector search) is unbuilt.

### Portable private agent and memory rules

- Added ignored local `docs/AGENT_RULES_TEMPLATE.md`, a copyable rule set for
  starting another project without carrying VoltFlow-specific implementation or
  operational details.
- Linked the template from the local `AGENTS.md` and `SKILLS.md` guidance while
  keeping the public Git index free of agent and memory workflow material.
- Saved the concise, non-sensitive policy to durable memory under
  `private-agent-rules`, `public-private-doc-boundary`, `change-gate`, and
  `safe-memory-policy`.
- Verification: confirmed the template and local guidance are ignored and that
  this work added no files to the public staging area.

### Russian architecture reference

- Added [docs/ARCHITECTURE.ru.md](docs/ARCHITECTURE.ru.md), a complete Russian counterpart
  to the architecture onboarding document: data-flow diagram, source-of-truth rules, data
  ownership, subsystem map, documentation map, and contributor conventions.
- Added reciprocal English/Russian links and a Russian README entry. The English document
  remains the canonical implementation reference; this is a documentation-only change.
- Verification: compared sections, endpoints, cadences, formulas, and local links against
  `docs/ARCHITECTURE.md`; checked the resulting diff for whitespace errors.

### VoltFlow Mate v0.4.7: architecture and telemetry-contract truth sync

- Audited the current Android APK, the Next.js ingest/fan-out path, the Supabase read
  models, and both fallback paths. Updated the architecture map, telemetry/API contracts,
  charging-session timing, and English/Russian README sections to describe the verified
  state-aware cadence, Room ACK queue, car-off command daemon, `mate_version`/
  `autoservice` compatibility fields, and `energydata` completed-trip-only sync.
- Recorded durable ownership boundaries: Postgres is the user-history/read-model authority;
  Mate Room/imported history/daemon files are device-local delivery or operational caches;
  PWA preferences remain client-side.
- Updated companion Mate documentation for the v0.4.7 payload tiers, delivery behaviour,
  queue vehicle-ID grouping, and watchdog supervision. No runtime code, migration,
  payload schema, or retention policy changed.
- Verification: matched each documented transfer and cadence against the owning Kotlin,
  TypeScript, and SQL sources; searched both repositories for the superseded v0.3.2 and
  obsolete cadence wording; checked documentation diffs for whitespace errors.

### Math Distance: rolling ~50 km efficiency window

- `resolveKmPerPercentSoc` (`src/lib/bydmate/hero-drive-metrics.ts`) no longer keys
  Math Distance's `kmPerPercentSoc` off the single latest trip. It now walks trips
  newest-first, summing distance and SOC-drop until ~50 km is covered
  (`MATH_RANGE_WINDOW_KM`), and divides the sums — staying in percent-space so it
  never depends on the user's capacity setting and self-corrects for battery
  degradation.
- Trips with missing/invalid distance or SOC data (e.g. 0 km / 0% junk micro-trips)
  are skipped rather than aborting the walk, so a bad latest trip no longer knocks
  the estimate down to the raw consumption fallback.
- The consumption-based fallback (`batteryCapacityKwh / consumptionKwh100`) is
  unchanged and still applies only when the window yields no usable SOC delta
  (`< 1%` total).
- AI Distance (`useVehicleRangeEstimate`) was untouched by this increment — see the
  follow-up below.
- Pre-build comparison against the single-trip and capacity-based
  (SOH-in-user-settings) alternatives was measured on real `way` vehicle trips
  before implementation (see prior BACKLOG.md entry, now removed).

### AI Distance: share the ~50 km window with Math Distance

- Investigated a live divergence on `way` (Math Range ≈ 186 km vs AI Range ≈ 121 km).
  Root cause: `useVehicleRangeEstimate` fetched its own single latest trip
  (`useLatestBydmateTripsQuery(..., limit=1)`) — unlike Math Distance, it was still
  anchored to whichever one trip ran last, so a short/high-consumption trip skewed
  the whole blended estimate.
- `computeHeroDriveMetrics` (`src/lib/bydmate/hero-drive-metrics.ts`) now exposes
  `rangeEstimateTrips`: the same rolling ~50 km window as `kmPerPercentSoc`, built by
  the new exported `selectTripsWithinDistanceWindow` (distance-only selection — a
  trip missing SOC data still counts toward the window, since AI Distance applies
  its own consumption filters, not SOC).
- `vehicle-live-view.tsx` now passes `heroDriveMetrics.rangeEstimateTrips` as
  `recentTripsOverride` to `useVehicleRangeEstimate`, replacing its internal
  single-trip fetch. `range-estimate.ts` itself is unchanged — its aggregation
  functions (`averageTripConsumption`, `averageEnergyConsumption`,
  `userMedianConsumption`) already handled multiple trips correctly; they just
  never previously received more than one.
- Fixture/dev mode (`fixtureTrips`) is unaffected — it still overrides with the
  full fixture day's trips.
- **UI marker:** both `HeroMetric` tiles (Hero and `RestMetricsCard`) gained an
  optional `hint` prop rendered as a native `title` tooltip, wired to new
  `vehicle.metrics.aiRangeHint` / `mathRangeHint` i18n keys (en/be/ru) explaining
  each estimate's ~50 km methodology on hover/long-press.

---

## 2026-07-14

### Telegram group event inbox and Ollama context-verification foundation

- Added a configurable Ollama-compatible verifier for Telegram context using
  `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, and `LLM_MAX_TOKENS`.
- Kept OpenAI embeddings and the existing 1536-dimensional knowledge search unchanged.
- Added strict, fail-closed intent parsing with seller, buyer, service, question,
  irrelevant, and ambiguous outcomes.
- Added Telegram group-message normalization for new and edited messages, captions,
  media identifiers, replies, protected content, source links, and deduplication keys.
- Added and applied `20260714150000_telegram_group_events.sql` to self-hosted
  Supabase at `supabase.voltflow.life`; the raw inbox is RLS-enabled and inaccessible
  to `anon` and `authenticated` roles.
- Updated the live Telegram Python edge to idempotently upsert group events while
  preserving `/start` and `/app` behavior.
- Verification: 11 focused tests, TypeScript, ESLint, Python normalization smoke test,
  and production migration privilege checks passed.

### Telegram event Qwen processor

- Added migration `20260714153000_telegram_group_event_verification.sql` with restricted
  intent, confidence, extracted fields, review, and processing state columns.
- The Telegram edge now sends stored text events to the configured Ollama-compatible
  Qwen model in a background task and writes the structured result back to the inbox.
- Protected-content and media-only messages are ignored; provider failures remain
  marked for review. No public listing is created automatically.
- Added `LLM_*` variables to `.env.example` and verified one live seller message through
  the Python processor against `qwen2.5:14b`.

### Telegram draft marketplace listings

- Added and applied `20260714160000_community_listings.sql` with private `draft` status,
  admin-only management, public visibility only after explicit publication, and source
  message deduplication.
- Verified seller events now create draft listings; the first live test draft is the
  Kraft AGM 40 offer from Новолуцк at 250 BYN.
- Fixed production moderation 500s by applying `20260715100000_community_listings_admin_privileges.sql`;
  authenticated admins now have table-level write grants, still restricted by RLS.

---

## 2026-07-14

### Domain migration → `voltflow.life` (Phases 0–3)

Moved the app, its backend infra, and paired cars off `volt-flow-beige.vercel.app` /
`mykid.life`. Phases 0–2 shipped to production; Phase 3 (Mate) is built and verified on car
`way` but its commits are **local/unpushed** pending a formal `/release-apk` cut.

**Phase 3 — Mate APK settings migration** (repo `BYDMate-own`, commit `e2cd59b`). The
telemetry endpoint is persisted in Mate's settings at link time, so changing the default
alone would only move fresh installs. A one-shot migration (mirroring the v2.4.17 pattern,
gated on `migration_domain_voltflow_done`) rewrites a stored `cloud_sync_url` to
`voltflow.life` on first launch of the new build — **only** when it is blank or its host is
the known-legacy `volt-flow-beige.vercel.app`; a user's custom endpoint is never touched
(that guard is proven by a mutation test). Verified on `way`: after install the stored URL
flipped to `voltflow.life`, the flag was set, and telemetry kept landing. The old Vercel
host still 308s, so a car that never upgrades keeps working. Also fixed in the same repo
(`7b37366`): queued telemetry batches are now sent under the `vehicle_id` in each row's own
body, not the current setting — editing the vehicle id with a non-empty queue previously
caused a header/body mismatch that made the server drop the whole batch.

**Phase 0 — canonical domain.** `voltflow.life` (apex) is Production; `www` and
`volt-flow-beige.vercel.app` both `308` → apex. Before this, apex *and* `www` were both
attached to Production with no redirect between them — browsers treat those as different
origins, which would have split auth cookies, PWA installs, and push subscriptions.

**Phase 1 — frontend URLs.** The canonical origin now lives in **one** place,
`src/lib/site-url.ts` (`DEFAULT_SITE_URL` + `siteUrl()`), instead of being hardcoded in
eight. Rewired: link-code telemetry endpoint, push click-through, Telegram widget +
webhook, inactivity email, the endpoint shown in Settings, the `.mjs`/`.py` scripts, and
README/INSTALL. Telegram menu button + webhook repointed via
`scripts/configure-telegram-bot.mjs`.

**Phase 2 — backend infra.** nginx now **dual-serves** `supabase.voltflow.life` and
`bot.voltflow.life` alongside the old `mykid.life` names, with one Let's Encrypt cert
covering both (`certbot --expand`). GoTrue moved to the new `API_EXTERNAL_URL`, mailer
templates, and `SITE_URL`; Vercel's `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_TELEGRAM_API_BASE_URL` follow. Migration `20260714130000` repointed the 12
rows holding **absolute** Storage URLs (`accessories`, `knowledge_articles`,
`spare_parts`) — those would have 404'd silently once the old host retired, and nothing
in the code would have warned.

**Auth-email outage found and fixed.** Removing `mykid.life` from Resend broke GoTrue,
which still sent from `noreply@mykid.life` — every password reset and signup confirmation
was 403'ing. Senders moved to the verified `noreply@voltflow.life`. The inactivity cron
had the *same* latent bug (`noreply@voltflow.app` was never verified), but is fail-safe:
it only stamps `inactivity_warning_sent_at` on success and only deletes accounts carrying
that stamp, so **no account was ever wrongly deleted** — the emails simply never arrived.

**Load-bearing invariants (do not break):**

- **`volt-flow-beige.vercel.app/api/bydmate/telemetry` must keep resolving forever.**
  Installed Mate builds persist their sync URL and cannot be force-updated. The `308` is
  safe: OkHttp preserves the POST body on 307/308 (`maintainBody`), and the auth key
  travels as `X-API-Key`, not `Authorization` (which OkHttp strips cross-host).
- **The old `mykid.life` hosts must keep serving.** PWA clients bake the Supabase URL into
  their cached JS bundle and keep calling the old host until their service worker updates.
- `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI` is derived from `API_EXTERNAL_URL`; the new
  callback is registered in Google Console (both old and new are registered).
- `knowledge_articles` has a `BEFORE UPDATE` trigger stamping `updated_at`. The migration
  disables it for the rewrite — otherwise a hostname change would have falsely marked five
  articles "recently updated".

---

## 2026-07-13

### Backdate auto-started charging sessions to when charging really began

- **Symptom.** A 66 kW DC charge on car `way` billed by the provider at 18.40 kWh /
  21m30s was recorded as 12.18 kWh / 17m20s — a third of the cost missing.
- **Root cause, from prod telemetry.** Auto-start needs 4 consecutive charging samples
  (`AUTO_CHARGING_MIN_CONSECUTIVE_START_SAMPLES`), a threshold written assuming the ~1 Hz
  ingest seen while driving. But while **parked and charging the Mate throttles to ~1
  sample per minute** — so the streak costs ~4 *minutes*, not ~4 seconds. The car arrived
  at 46% SOC and the session only opened at 56%, discarding 10% SOC ≈ 4.5 kWh. At 4 kW
  home AC the same latency is only ~0.27 kWh, which is why it never surfaced before; a DC
  charger makes it 16× more expensive.
- **Fix.** `nextAutoChargingSessionStep` now carries the streak's first charging sample
  and the last pre-charge (idle) reading, and backdates the session: `start_percent`
  prefers the idle SOC (guarded — must be ≤ the first charging SOC, and ≤30 min old, or it
  may predate an untracked drive), falling back to the streak's first charging sample;
  `started_at` is always the streak's first charging sample. The 4-sample confirmation is
  unchanged — detection stays conservative, only the recorded start rewinds. Replaying
  today's session through the new logic gives 46% → 83% = 16.7 kWh over ~20.6 min, against
  the provider's 18.40 kWh / 21m30s; the residual ~9% is grid-to-battery DC loss (see
  Known gap below).
- Migration `20260713090000_bydmate_auto_charging_backdate_state.sql` adds four nullable
  columns to `bydmate_auto_charging_session_state` (`streak_start_percent`,
  `streak_start_device_time`, `last_idle_percent`, `last_idle_device_time`) so the streak
  survives across ingest batches. **Applied to self-hosted prod 2026-07-13** via `psql`;
  all four columns verified present.
- Docs reconciled: `docs/CHARGING_SESSIONS.md` (new "Backdating the start" section, plus
  the sample-cadence correction in the auto-start table) and the `AGENTS.md` hard-won rule.
- Verification: auto-session tests 7/7 (3 new — the real DC scenario, the stale-idle
  fallback, and the discharged-idle guard), `npm run test` 108/108, `npx tsc --noEmit`
  clean, targeted ESLint clean, `npm run build` passes.

## 2026-07-14

### Clickable semantic accessory results

Semantic search cards now work for accessory and spare-part results. Relative internal
URLs use Next navigation, valid `http(s)` product URLs open as external links, and results
without a URL fall back to the Buy tab instead of rendering as dead cards.

### Service-provider catalog

Added an app-owned Postgres service directory beside accessories and spare parts. The
Telegram catalog is now `Аксессуары`, `Запчасти`, and `Сервис`, with provider cards for
service centers, mobile services, detailers, and parts-and-service businesses. Cards show
location, services, optional starting price, verification status, and external contact or
booking links. Added admin CRUD at `/admin/knowledge/service-providers`.

Migration: `20260714130000_service_providers.sql` was applied to production on 2026-07-14;
the catalog remains empty until providers are entered.

Service cards now open `/telegram/service/[id]`; contact and booking links are available
on the detail page, so a provider without a direct external URL is still navigable.

Service discovery now includes semantic search in the Service tab. Providers are indexed
in the existing vector search with their descriptions, locations, services, prices, and
model generations; redundant service tag chips are no longer shown in public service
cards or service search results.

Accessory and spare-part catalog cards now open dedicated detail pages; purchase links,
compatibility notes, checks, risks, and images are available inside the detail view.

Provider detail pages now show the address in high-contrast text and offer a map link:
Yandex Maps for CIS language/timezone signals, Google Maps otherwise. Added migration
`20260714140000_service_provider_address.sql` for the provider address field.

### Knowledge search: admit when there is no answer (+ a relevance eval)

- **Correction to yesterday's verdict.** I recorded that search relevance was "weak". That
  was wrong, and it was drawn from one cherry-picked query. Measuring it properly
  (12 realistic queries against the live corpus) shows **retrieval is good: the correct item
  ranks #1 for 10 of 12**, scoring 0.46–0.65.
- **The two failures are content gaps, not retrieval failures.** The corpus (19 embedded
  items) has **no winter-charging article and no AC-vs-DC article** — «как заряжать зимой»
  and «чем отличается AC от DC» have no right answer to return. The model matched «зимняя» →
  winter washer fluid because that is genuinely the closest thing we have.
- **The real defect was dishonesty.** `match_threshold` is `0.2`, so *everything* clears it
  and washer fluid was presented at 42% dressed exactly like a real hit — a user asking
  about winter charging was confidently handed an unrelated accessory. Search never admitted
  it had no answer.
- **A flat threshold cannot fix this** — the scores overlap. The *correct* hit for «коврики»
  is **0.423**; the *wrong* hit for «зимой» is **0.417**. Raising the cutoff to 0.45 would
  suppress the wrong answer by also dropping a right one. What separates them is the *lead*
  over the runner-up: «коврики» wins by 0.088, «зимой» by only 0.048 — a near-tie among
  unrelated items, i.e. the model has no real opinion.
- **New `classifySearchConfidence`** (`src/lib/knowledge-search-confidence.ts`): a result set
  is presented as an answer when the top hit is **≥ 0.45** *or* leads #2 by **≥ 0.06**. Both
  constants derived from the eval, not chosen by feel. This classifies **all 12** queries
  correctly. When it is not confident, `SemanticSearchResults` leads with "Точного ответа не
  нашлось", demotes the hits under a muted «Возможно, близкое», and drops the confident green
  badge — a weak match must not look like a real one.
- **New `npm run search:eval`** (`scripts/knowledge-search-eval.mjs`): the 12 queries with
  their expected top hit, including the two content gaps encoded as `expect: null` (they pass
  by *correctly refusing to answer*). Relevance is now something you check, not argue about —
  run it before and after touching embeddings, the threshold, `buildKnowledgeEmbeddingText`,
  or the corpus. **Currently 12/12.**
- **Explicitly not built: hybrid search** (vector + full-text). It is the textbook cure for
  "matched one adjective, ignored the topic", and I would normally reach for it — but at 19
  documents with a 10/12 hit rate, the measurement says retrieval is not the bottleneck.
  Deferred until the corpus passes ~100 items or the eval regresses. The two missing articles
  are worth more than any tuning; logged in BACKLOG.md as content work.
- Verification: `npm run test` 128/128 (6 new, pinned to the real recorded scores),
  `npm run search:eval` 12/12, `npx tsc --noEmit` clean, ESLint clean, `npm run build`
  passes; both the confident and the "no answer" paths checked in the live UI at phone width.

### Fix: semantic search was 500-ing on every query in production

- **Symptom.** Every semantic search failed — home "Умный поиск", the Guides article
  search, and `/knowledge/search`. `POST /api/knowledge/search` returned
  `500 {"error":"Knowledge search failed."}` for any input.
- **Root cause.** Reproducing the API's own call with the service-role client surfaced the
  error the route was swallowing:
  `42883: operator does not exist: extensions.vector <=> extensions.vector`.
  pgvector is installed into the **`extensions`** schema, so the `<=>` distance operator
  lives there — but `public.match_knowledge_items` had **`proconfig = null`**, i.e. no `SET
  search_path` of its own, so it resolved operators from *the caller's* path. The API roles
  (`anon`, `authenticated`, `service_role`) have no `search_path` role setting, so the
  PostgREST connection never had `extensions` on the path and `<=>` could not resolve.
- **Why it looked healthy from the DB.** An interactive `psql` session defaults to
  `"$user", public, extensions`, so calling the function by hand worked perfectly — the
  failure existed only on the app's connection. It is also **self-hosted-only**: on Supabase
  Cloud `extensions` is on the default path, so the original migration was written against
  an environment that hid the bug.
- **Fix.** Migration `20260714090000_match_knowledge_items_search_path.sql` pins
  `search_path = public, extensions` on the function, making it correct regardless of
  caller. **Applied to self-hosted prod 2026-07-14**; idempotent (guarded `DO` block).
  Verified: `proconfig` now reads `search_path=public, extensions`, the service-role RPC
  returns rows instead of erroring, and `POST /api/knowledge/search` returns **200 with 8
  results**. `match_knowledge_items` was the only function in `public` using `<=>`, so the
  blast radius was contained.
- **The route no longer hides its cause.** `src/app/api/knowledge/search/route.ts` logged
  server-side and returned a flat `"Knowledge search failed."` — exactly why a total outage
  presented as a mystery. It now includes the underlying `detail` outside production
  (withheld in prod, where it would leak schema details to anonymous callers).
- **Ruled out, so they don't get blamed later:** OpenAI embeddings are fine (200, 1536
  dims), `OPENAI_API_KEY` is present, and the RPC signature matched the call exactly.
  `knowledge_items` has 10 rows with no embedding, but all 10 are legacy
  `source_type='seed'`, which the app never queries — every `article`/`faq`/`accessory`/
  `spare_part` row is embedded (19/19).
- **Known follow-up, not fixed here:** result *relevance* is mediocre — "как заряжать зимой"
  ranks "Зимняя омывающая жидкость" (winter washer fluid) first, matching on «зимняя»
  alone. That is retrieval tuning, not the outage. Logged in BACKLOG.md.
- Verification: `npm run test` 122/122, `npx tsc --noEmit` clean, ESLint clean,
  `npm run build` passes; searched from the live UI at phone width.

---

## 2026-07-13

### Real article popularity for the knowledge base (view counter)

Restores a truthful "Популярные" section — the label removed earlier the same day because
no popularity signal existed. **Data ownership (confirmed with the user):** the counts are
app-owned aggregate content metrics → **Postgres**; the "already counted this article
today" flag is per-user → **localStorage**, never sent to the DB.

- **Migration `20260713190000_knowledge_article_views.sql`, applied to self-hosted prod
  2026-07-13** via `psql` against the Supavisor pooler (the CLI cannot connect —
  no TLS). Idempotent, per the self-hosted rules.
- **The counter lives in its own table, and that is the whole point.**
  `knowledge_articles` has a `BEFORE UPDATE` trigger (`set_knowledge_articles_updated_at`,
  migration `20260516120000`) that stamps `updated_at = now()`. A `view_count` column on
  that table would therefore have bumped `updated_at` **on every page view**, silently
  turning the "Недавно обновленные" list shipped hours earlier into "most recently
  *viewed*". `knowledge_article_views` (`article_id` PK → articles, `view_count bigint`,
  `last_viewed_at`) never writes to the content table, so the recency list stays correct by
  construction. **Verified on prod:** two increments left `updated_at` at
  `2026-06-25 20:48:50.942597+00`, unchanged.
- **Anonymous readers can count without being able to write.** The KB is public (`anon` may
  `select` published articles), and RLS cannot restrict *which column* an `UPDATE` touches
  — so an `anon` write policy on `knowledge_articles` would have let anyone rewrite article
  bodies. Instead the views table has **no** insert/update/delete policy, Supabase's blanket
  default grants are explicitly **revoked** (so the design does not rest on a single policy
  existing), and the only write path is `increment_knowledge_article_view(p_slug)`, a
  `SECURITY DEFINER` function that can do nothing but bump a counter. Verified on prod:
  `anon` has `select` + `execute` and **cannot** update the table. An unknown or
  unpublished slug is a silent no-op, not an error.
- **Counted client-side, once per article per day per device** (`ArticleViewTracker`).
  Incrementing during the server render would have counted Next.js prefetches and non-JS
  crawlers and could not tell a refresh from a real read — popularity would have measured
  who reloads most, the same dishonesty as the old fake list.
- **The label is gated on the data.** Home shows "Популярные" only once the top article has
  **≥ 5 views** (`MIN_VIEWS_FOR_POPULAR`); below that it keeps showing "Недавно
  обновленные". A single curious tap must not crown an article.
- **Counts fail soft.** `getArticleViewCounts` returns an empty map on error rather than
  throwing. It runs inside `getTelegramKnowledgeDataWithFallback`'s try/catch, so a throw
  would have collapsed the *entire knowledge base* to static fallback content — e.g. if the
  code were deployed before the migration was applied. Counts are decoration; the articles
  are the product.
- Verification: `npm run test` 122/122, `npx tsc --noEmit` clean, ESLint clean on all
  touched files, `npm run build` passes; migration applied and re-run (idempotent) on prod,
  with RPC behaviour, grants and the `updated_at` invariant all asserted against prod.

### Knowledge base (`/telegram`): make the catalog navigable

The KB had two navigation systems that disagreed with each other, and neither reliably got
you into a category. Found by walking the live catalog at phone width.

- **Category cards now actually filter.** `KnowledgeHome`'s `quickCards` sent **Зарядка**,
  **Эксплуатация** *and* **Обслуживание** to `tab: "guides"` with **no category** — three
  different-looking buttons landing on the same unfiltered "Все гайды" list, forcing the
  user to re-pick the category they had just clicked. A section tile now opens Guides with
  that category already selected (`onOpenCategory` → sets `guideCategory` + switches tab),
  and the article search box scopes to it ("Поиск в разделе «Зарядка»").
- **One taxonomy instead of two that had already drifted.** The home cards were a
  hand-written list; the guides chips were derived from the data. They disagreed:
  "Эксплуатация" was a card with **no matching chip and no articles at all**, and
  "Батарея" was a chip with no card. Both now render from a single `articleCategories`
  derived from the articles on screen (with counts), so they cannot drift apart again.
- **Section tiles carry article counts** ("Зарядка · 3 статьи"). The cheapest possible
  trust signal — it tells you whether a section is worth a tap before you spend one.
- **"Еще" was hiding the best tool.** The `more` tab is the charging time/energy/cost
  calculator, buried behind a hamburger icon and the least informative word available (and
  given a *calculator* icon on the home grid while still labelled "Еще", so icon and label
  contradicted each other). Renamed to **Калькулятор** with the calculator icon.
- **"Популярные статьи" were not popular.** The list was
  `articles.filter(categorySlug === "charging").slice(0, 4)` — the first four *charging*
  articles in insertion order. No popularity signal exists in the data. Replaced with
  **"Недавно обновленные"**, sorted by `updatedAt` (which `toTelegramArticle` really does
  fill from `articles.updated_at`), so the label matches the data. A real popularity list
  would need a view counter; deliberately not invented.
- **Three internal roadmap notices removed from the product**: "База знаний сейчас ведется
  вручную… будут добавлены позже", "Остальные инструменты подготовлены для следующих фаз",
  and a `voltflow-card` listing the next-phase backlog. The calculator screen also rendered
  **a card per unbuilt calculator** ("В следующей фазе") — a catalog of things the user
  cannot use. All gone; the screen now shows the one calculator that works.
- **Home H1 "Умный поиск" → "База знаний".** The title named a feature; it now names the
  place, with search as the instrument on it.
- **The generation switch stopped eating the viewport.** It sat in the sticky header on
  every tab, costing ~60px of a ~700px screen forever, for a set-once choice that
  `useAutoDetectCarGeneration` already guesses. It now scrolls away with the content.
- Correction to the review itself: the Guides search is **not** a separate plain-text
  filter as first reported — it is the same `useSemanticKnowledgeSearch` engine, scoped to
  articles and the active category. Nothing to unify; the real defect was that the
  placeholder never said it was scoped, which it now does.
- Verification: `npm run test` 122/122, `npx tsc --noEmit` clean, ESLint clean on all
  touched files, `npm run build` passes; walked home → section tile → filtered guides in
  the browser at 430px.

### Dashboard status-card polish + a dev component gallery

Four dashboard-card issues, plus the variant workshop that makes them checkable.

- **Last-seen time under the status badge.** The badge said *Parking* / *Last seen* but
  never *when*. The status column is now a stack: badge, then a muted
  `dashboard.lastSeen` line ("Data from car 47m ago"), shown only for `parked` and
  `stale` — `driving` and both charging modes are fresh by definition (≤90 s), so a
  timestamp there is noise. The `timeAgo()` helper was a private function inside
  `vehicle-live-view.tsx`; it is now `src/lib/time-ago.ts` (`timeAgoParts` +
  `formatTimeAgo`), shared by both views and covered by 6 tests — including the
  clamp that stops a car clock running ahead of the phone from rendering "−12s ago".
- **Car image no longer collides with the vehicle name.** Root cause: the card body was
  `grid … items-center`, so the short left cell (image + ring) re-centred against a right
  cell whose height changes per mode — 4 driving tiles vs. the tall park calculator vs.
  1–2 stat tiles. The image was lifted into the header by a hard-coded `-mt-8` tuned for
  one mode, so it landed on the `h1` in the others. Fixed by giving the image its own
  in-flow row (`mb-1`, no negative margin), so it sits in the same place in every status.
- **Range badge no longer clips the ring — or drifts far below it.** The `≈ 244 km` badge
  is absolutely positioned at the bottom of its container, which only reserved `pb-4` —
  less than the badge's own height — so it overlapped the circle. It is now anchored to a
  `relative pb-9` wrapper around the **ring itself** rather than the grid cell: the cell
  stretches to the tallest column (the park calculator), which would otherwise drop the
  badge to the very bottom of the card, far under the circle.
- **"No data" no longer reports "Parking".** `deriveDashboardVehicleMode` returned
  `"parked"` when there was **no snapshot at all** — inventing a state we had no evidence
  for, so a car that had never reported showed a confident "Парковка". It now returns
  `"stale"`. `canStartChargingSession` already accepted `stale`, so the Start button and
  park calculator are unaffected. Behaviour is now: an **old** snapshot keeps its last
  known percent, the "Давно не обновлялось" badge, and the time-since line; **no**
  snapshot shows `—` and no timestamp. Covered by 3 new tests.
- **The dev "No Data" mode actually tests no data.** `dashboard-dev-snapshot-context.tsx`
  returned `buildParkedSnapshot(seed)` for `nodata` — the *same fixture as `park`* — so
  the mode rendered as "Parking" with a live 64% SOC, the exact opposite of what it
  claimed to test. It now resolves to `null`, and `useDashboardDevSnapshotOverride` no
  longer lets its `?? base` fallback hand the real snapshot back.
- **New dev "Stale" mode** (`?devSnapshot=stale`, plus a toolbar button). The
  car-reported-then-went-quiet case had no fixture and so was unreachable in the running
  app: a real parked snapshot backdated 47 minutes, well past `LIVE_SNAPSHOT_STALE_MS`.
  Verifies the intended contract — an old snapshot keeps its last known SOC and range,
  the badge reads "Давно не обновлялось", and the line under it reads "Данные с авто 47
  мин назад"; `nodata` instead shows `—` and no timestamp.
- **Dead space in the charging modes removed.** The right column is only one or two stat
  tiles there, against a much taller ring column, and top-aligning them left a large gap
  below. The column is now `flex flex-col justify-center`, so the tiles sit centred on
  the ring; the taller modes (driving's 4 tiles, the park calculator) are unaffected.
- **No status word inside the ring at all.** `BatteryRing`'s `status` prop is now
  optional (`string | null`) and the dashboard card stops passing it entirely — the ring
  is a bare number, since the badge directly above already names the state and the
  last-seen line supplies the *when*. (The prop stays because the charging screen and
  the landing page still label their rings; while there, the label is now width-clamped
  and truncates instead of spilling outside the circle, which long strings like
  "Зарядка (live)" and "В движении" were doing.)
- **No more fabricated percent.** `currentPercent` used to fall through to
  `Number(startPct)` — the manual start-percent input — so a car that had never reported
  showed a confident **42 %**. It is now `number | null`, `BatteryRing` renders `—` when
  unknown, and the pack tile degrades to `— / 45 kWh`.
- **The park calculator remembers its last choices.** Tariff, provider and power now
  persist to **localStorage** via the existing `useAppPreferences` zustand store
  (user-owned preference data, per the AGENTS.md change gate — no migration, no Postgres
  column). The three `*Touched` flags persist alongside the values and set the
  precedence: a field the user set by hand survives a reload, while an untouched field
  keeps auto-filling from the GPS-matched tariff location. Stored once per user, not per
  car.
- **New `/dev/gallery` page** (dev-only, linked from the `/dev` index). Renders all eight
  status-card variants — the five vehicle modes plus no-data, no-image and long-name —
  side by side on a frozen clock with hand-built props, then `BatteryRing` in six
  isolated states. Each card sits in the PWA's real **430px phone frame** (the
  `.mobile-page` width), so the gallery shows what a phone shows rather than a stretched
  desktop column; the frames wrap to a grid on a wide screen and stack to one column on a
  narrow one. Chosen over Storybook: `DashboardView` is wired into react-query,
  Supabase and zustand, so every story would need those providers mocked, for a second
  build pipeline to maintain. This exercises the components, not the data plumbing; the
  fully wired card still lives at `/dev/site/dashboard` behind its mode toolbar.
  `statusBadgeClass` moved to `src/lib/vehicle-live-mode.ts` as
  `dashboardStatusBadgeClass` so the gallery can reuse it without importing the whole
  dashboard.
- Verification: `npm run test` 119/119 (6 new), charging auto-session 7/7,
  `npx tsc --noEmit` clean, ESLint clean on every touched file, `npm run build` passes
  (122 pages).

### Public, no-login access to the knowledge base

- `/telegram` (+ `/telegram/category/[slug]`, `/telegram/article/[slug]`) was already a
  fully public, unauthenticated route with SEO metadata and a static-data fallback —
  built for the Telegram Mini App but works for any browser. `/knowledge`
  (`src/app/(app)/knowledge/page.tsx`) sat inside the authenticated `(app)` shell
  (`MobileShell`, bottom nav, onboarding banners) with no SEO metadata and no subpages
  of its own.
- `KnowledgePage` now checks for a session server-side via `getCurrentUser()`
  (`src/lib/supabase/knowledge.ts`) and `redirect("/telegram")`s anonymous visitors
  before fetching knowledge data; logged-in users see the unchanged in-app experience.
  No data-model change — knowledge content is app-owned, curated in
  `src/app/admin/knowledge/`.
- The redirect alone left the feature undiscoverable: the marketing landing page
  (`src/app/(marketing)/page.tsx`) had no link to it. Added a "BYD knowledge base"
  card (new `landing.knowledgeTitle/knowledgeBody/knowledgeAction` keys in
  `src/lib/i18n.ts`, all three locales) linking to `/knowledge`, right below the
  existing Telegram card in the hero section.
- **Root-cause correction:** the redirect in `KnowledgePage` never ran for anonymous
  visitors — this app uses Next.js 16's renamed `middleware.ts` → `src/proxy.ts`, whose
  edge-level `PUBLIC_PATHS` gate already listed `/telegram` and `/knowledge/search` but
  not `/knowledge` itself, so unauthenticated requests were bounced to
  `/login?next=/knowledge` before the page component ever loaded. Added `/knowledge` to
  `PUBLIC_PATHS` in `src/proxy.ts`; the page-level redirect to `/telegram` now actually
  executes for anonymous visitors.
- Verification: `npx tsc --noEmit` clean, targeted ESLint clean on all touched files.

### Per-tariff charging efficiency (AC ≈98%, fast DC ≈90%)

- **Why.** SOC-derived energy is *battery-side*; providers meter *grid-side*. The old
  invariant said efficiency ≈ 100%, which was validated **on AC only** (SOC × capacity
  2.706 kWh vs 2.760 kWh grid truth, −2%). Today's DC charge measured −9.3% (16.69 kWh
  absorbed vs 18.40 kWh metered), so a single per-car figure cannot serve both: setting it
  to 90% fixes DC and breaks AC by the same margin.
- New `src/lib/charging-efficiency.ts` → `efficiencyPercentForTariff(car, tariffType)`:
  `fast_dc` reads the new `cars.fast_dc_efficiency_percent` (default **90**), everything
  else reads `cars.default_efficiency_percent`, whose meaning is now explicitly **AC**
  (default **98**). Wired into both session-creation paths — Mate auto-start
  (`charging-auto-session.ts`) and manual start (`actions/sessions.ts`).
- Also fixed: `stopSessionFromTelemetry` computed the final energy from
  `car.default_efficiency_percent` instead of the session's own `efficiency_percent`
  snapshot, which would have silently applied the AC figure to a DC session on close.
- Both figures are user-editable in the car form (Advanced), with en/ru/be strings.
- Migration `20260713100000_cars_fast_dc_efficiency.sql` adds
  `cars.fast_dc_efficiency_percent` (numeric, not null, default 90, check 0–100).
  **Applied to self-hosted prod 2026-07-13.**
- **Prod data repaired** (car `way`, user-owned settings): AC efficiency 100 → 98, DC → 90.
  Today's DC session `13b0210b` rewritten to what the new code would have produced —
  start 46% @ 04:42:05 (was 56% @ 04:45:19), **18.541 kWh / 20.6 min / cost 10.20** against
  the provider's 18.40 kWh / 21m30s / 10.12, i.e. within 0.8%. Previously 12.177 kWh /
  17m20s / 6.70. The open home session was recomputed at 98%.
- Verification: `npm run test` 113/113 (5 new efficiency tests), auto-session 7/7,
  `npx tsc --noEmit` clean, targeted ESLint clean, `npm run build` passes.
- Docs: `docs/CHARGING_SESSIONS.md` energy/cost section rewritten (the formula now shows the
  `÷ efficiency` step and the per-tariff table with both measurements); `AGENTS.md`
  invariant updated — it previously asserted "efficiency ≈ 100%".

## 2026-07-12 — UI localization and responsive fixes

### Russian bottom-navigation label overflow

Updated `src/components/layout/BottomNavigation.tsx` so every bottom-navigation
item can shrink within the five-column grid and its localized label wraps inside a
consistent, centered line box. This keeps `База знаний` readable on narrow screens
without shortening the Russian translation.

### Analytics summary cards — narrow-screen overflow fix

Updated `src/components/vehicle/telemetry-analytics-charts.tsx` so analytics
summary card values and units wrap within the card at narrow widths and longer
localizations. Added `min-w-0`, safe word wrapping, and overflow clipping while
preserving the existing responsive grid. Targeted ESLint passed; the production
build stalled in the environment after starting and was interrupted.

### Dashboard Yuan UP vehicle image

Moved the transparent `yuanup.png` asset to `public/images/cars/yuan-up.png` and
rendered it between the selected car name and battery ring. Both current car
generations map to this shared artwork until distinct 2024/2025 images are added.
The targeted lint command is currently blocked by an existing `dashboard-view.tsx`
`react-hooks/set-state-in-effect` error in the estimate-tariff effect.
The image is intentionally compact at 132px wide by 48px high inside the left
battery column, leaving the right-side stats untouched.

## 2026-07-12 — /insights follow-ups (workflow hardening)

### Data-ownership rule in the change gate

- Added to `AGENTS.md` → Change gate: plans for user-facing data models must state
  data ownership (user-owned vs app-owned) and storage location (Postgres vs
  localStorage) and confirm both before building; per-user preference data
  defaults to client-side. Motivated by two past rework cycles (provider tariffs,
  GPS coords) surfaced by the 2026-07-12 `/insights` report.
- Sibling changes outside this repo, same session: `/release-apk` skill in
  BYDMate-own (`.claude/skills/release-apk/SKILL.md` — full release flow ending
  in a mandatory prod-telemetry check) plus a matching release rule in that
  repo's `AGENTS.md`; auto-lint PostToolUse hook in this repo's untracked
  `.claude/settings.local.json`.

## 2026-07-12 (revised)

### Ask the user's home price instead of guessing per-currency defaults

- Reverted the same-day "currency-aware defaults" work: a global country/currency
  tariff lookup isn't realistic to build or keep accurate (no reliable free API,
  and the 4-currency table already needed guessed figures for 2 of 3 tiers on 2
  currencies) — users can be from any country, and only the user actually knows
  their local rate. Removed `CURRENCY_DEFAULT_TARIFFS` (`charging-tariffs.ts`),
  the "Typical rate" hints and currency-change reset-prompt in
  `settings-view.tsx`, and their i18n keys.
- Car creation (`/cars/new`, `CarForm` in `mode="create"` only — the onboarding
  screen is a pure ADB/link-code install wizard with no other profile fields, so
  it wasn't the right fit) now asks an optional "Home charging price" question.
  If filled in, `new-car-form.tsx` persists it to `profiles.home_price_per_kwh`/
  `default_price_per_kwh` after the car is created; if left blank, nothing is
  written and the column default applies.
- New migration `20260712120000_profiles_tariff_neutral_default.sql`: changes
  the `profiles` tariff columns' DB default from the old guessed `0.12` to a
  neutral `1` — an obvious placeholder rather than a number that quietly implied
  real, currency-calibrated accuracy. `ALTER COLUMN ... SET DEFAULT` only; no
  data rewrite, existing users' values untouched. **Applied to self-hosted
  prod 2026-07-12** via `psql` (local Supabase/Docker wasn't running this
  session, so applied directly against the pooler per the recipe in
  `docs/OPS_LOCAL.md`); verified all 4 column defaults now read `1`.
- Verification: `npx tsc --noEmit` clean, `npm run test` 108/108, targeted ESLint
  clean on touched files (pre-existing unrelated issues in `settings-view.tsx`
  untouched by this diff), `npm run build` passes.

---

## 2026-07-12

### Currency-aware defaults for Settings → Economics tariff prices

- Every tariff price field defaulted to a flat `0.12` regardless of currency, and
  switching currency never rescaled it — implausible for BYN/USD/RUB. Researched
  current typical rates per currency (sourced where noted, reasoned estimates
  elsewhere — see comments in the new constant) and implemented BACKLOG.md's
  recommended non-destructive fix.
- New `CURRENCY_DEFAULT_TARIFFS` (`src/lib/charging-tariffs.ts`): home/commercial-AC/
  fast-DC typical rates per currency. EUR/USD home and EU/US DC-fast figures are
  sourced (EIA 2026 US residential average, European DC-fast median); BYN home is
  sourced (Belarus's regulated within-norm household tariff, June 2026 decree); RUB
  home is a blended regional average (Moscow/St Petersburg/national). AC tiers and
  BYN/RUB commercial/DC tiers are reasoned estimates (no direct public-charging-network
  pricing found for Belarus/Russia) — flagged inline as needing verification before
  being treated as authoritative.
- `handleCurrencyChange` (`settings-view.tsx`) now offers a toast prompt — "Switch
  tariff prices to typical rates for this currency?" with an explicit Update action —
  only when the user's current prices still equal the *previous* currency's defaults
  (i.e. untouched). Never silently overwrites a price the user actually customized.
- Each of the 3 tariff price fields also shows a small "Typical rate: X" hint using
  the new constant, independent of the prompt (helps first-time setup too, not just
  currency switches).
- Verification: `npx tsc --noEmit` clean, `npm run test` 108/108, targeted ESLint
  clean on touched files (pre-existing unrelated issues in `settings-view.tsx`
  untouched by this diff), `npm run build` passes.

---

## 2026-07-11 (continued)

### Show the new Belarusian ruble (BYN) graphic symbol in place of "Br"

- The National Bank of Belarus approved a new graphic symbol for BYN on
  2026-01-27 (a stylized Cyrillic "Б"), but it has no Unicode codepoint yet
  (submitted for encoding 2026-04-13) — so it can't be typed as text. Added it
  as an inline SVG icon instead: `public/byn-symbol.svg` (source asset) and
  `<BynSymbol>` (`src/components/brand/BynSymbol.tsx`), rendered with
  `fill="currentColor"` so it adapts to text color/theme like the surrounding
  text.
- New `formatCurrencyParts` (`src/lib/i18n.ts`) exposes `Intl.NumberFormat`'s
  parts array instead of a joined string, so the currency-symbol part can be
  swapped for the icon while every other currency (EUR/USD/RUB) and all
  locale-specific positioning/grouping/decimal rules stay byte-identical to
  before. `formatCurrencyAmount` now delegates to it — unchanged output for
  every existing string-based caller.
- New `<CurrencyAmount currency value locale />` (`src/components/currency-amount.tsx`)
  renders those parts, using `<BynSymbol>` for the BYN currency part. Wired
  into every on-screen money-amount display that was previously a JSX child of
  `formatCurrencyAmount`: Day summary cost, session costs (live, history,
  charging screen), service records/stats, and the dashboard park-cost
  estimate. Several shared stat-row components (`HeroMetric`, `MiniStat`,
  `CompactStat`, `CompactStatRow`, `ChargingStat.value`) had their `value`
  prop widened from `string` to `ReactNode` to accept it — backward compatible
  since a string is already a valid `ReactNode`.
- **Deliberately left as plain text** (architecturally can't render an icon):
  chart axis unit label (`vehicle-analytics-panels.tsx`), and every
  `t(..., { cost/price: formatCurrencyAmount(...) })` translation
  interpolation (`dashboard.chargingProgress`, `dashboard.estimateDetailCompact`)
  — translation strings only accept string substitutions.
- **Follow-up, same day:** the Settings currency picker and tariff/price labels
  are now also converted. Checked Base UI's actual `SelectValue` type
  definitions (`node_modules/@base-ui/react/select/value/SelectValue.d.ts`)
  instead of guessing — it accepts a `children: (value) => ReactNode`
  render-prop, so the closed-trigger display (not just the open dropdown) can
  render the icon too. New `currencyTextWithIcon(text, currency)`
  (`src/components/currency-amount.tsx`) finds the plain-text symbol inside an
  already-translated string (e.g. "Home tariff (Br/kWh)") and swaps just that
  substring for `<BynSymbol>` — reused for the picker's `SelectItem`/`SelectValue`
  and the 3 settings tariff labels + dashboard price label, with no changes to
  `translate()` itself. The one remaining plain-text spot,
  `settings-view.tsx`'s location-override price `<Input placeholder>`, stays
  text — an HTML attribute can't hold rich content.
  Verification: `tsc --noEmit` clean, `npm run test` 108/108, targeted ESLint
  clean on touched files, `npm run build` passes.
- Verification: `npx tsc --noEmit` clean, `npm run test` 108/108, targeted
  ESLint clean on all touched files (pre-existing unrelated warnings/errors in
  `vehicle-live-view.tsx`/`history-view.tsx` untouched by this diff), `npm run
  build` passes.

---

## 2026-07-11

### Estimate cost for no-charge driving days (session walk-back)

- `Cost` on the Analytics "Day at a glance" card was previously `—` on any day with
  no finished charging session, even when the car was clearly driving on energy from
  a prior charge. New `estimateNoChargeDayPrice` (`src/lib/vehicle-analytics.ts`)
  walks backward through recent finished sessions and picks the most recent one whose
  `charged_energy_kwh` still covers all driving since it stopped — the charge that
  day's driving is most plausibly still coming from — and returns its `price_per_kwh`.
  Falls back to `null` (card falls back to `defaultPricePerKwh`) once no session
  covers it or none exist.
- The pure selection logic lives in `pickWalkBackSessionPrice`
  (`src/lib/history-day-summary.ts`), separated from the Supabase I/O so it's unit
  tested directly (`history-day-summary.test.mjs`, 6 cases) without mocking the
  client.
- `/api/vehicle/analytics?type=period-overview` accepts `estimateNoCharge=1` (sent
  only for the Day range) and returns `estimatedNoChargeDayPricePerKwh`.
  `HistoryDaySummaryCard` shows it as `≈$X.XX` with a distinct "estimated, not money
  spent today" footnote — kept visually separate from the real `Cost` figure per the
  BACKLOG proposal's recommendation, so nobody budgets off an imputed number.
- See BACKLOG.md history for the option comparison (last-known-price, trailing
  blended average, full weighted-average-cost ledger, and this one) and the EV
  industry research (Tesla, ABRP, fleet cost-per-mile tools) that ruled out
  ledger-grade precision as unnecessary for what's meant to be a plan/estimate.
- Verification: `npx tsc --noEmit` clean, `npm run test` 108/108 (102 prior + 6 new),
  targeted ESLint clean on all touched files, `npm run build` passes.

### Fix History lifetime map failure for long vehicle histories

- Root cause confirmed on vehicle `way`: 355 trip IDs were embedded in one PostgREST
  `.in(...)` URL, which Nginx rejected with **414 Request-URI Too Large** before the
  query reached PostgREST. The former single request was also silently capped at 1,000
  points despite asking for 5,000.
- Lifetime-map retrieval now uses the existing `bydmate_trips!inner(vehicle_id)`
  relationship filter with `user_id`, eliminating the URL-sized ID list while keeping
  the same vehicle and ownership scope.
- The compact query paginates newest-first in 1,000-row ranges up to the intended
  5,000-point display cap, then restores chronological order for the renderer.
- Added pure pagination coverage for page assembly, short-page exit, exact cap, and
  an empty cap. No migration is required.
- Verification: focused tests pass, `npm run test` passes 102/102, targeted ESLint and
  `npx tsc --noEmit` pass, and the live dev endpoint returns HTTP 200 with 5,000 ordered
  points for `way`. `next build` was blocked by an independently running dev server and
  its hanging build lock; that server was deliberately left untouched.

### Reduce telemetry-ingest latency and History Analytics load

- The telemetry receiver now starts charge notifications, Telegram live-widget
  updates, and auto charging-session processing together after persistence. Each
  failure remains isolated, and reconciliation still waits for the auto-session
  result because it depends on its start/stop events.
- Auto-session and charge-notification state now compute the latest device time in
  one pass and bulk-upsert all vehicle rows once per table. This changes repeated
  `O(vehicles × samples)` reverse scans to `O(samples + vehicles)` and removes
  per-vehicle state-write round trips for multi-vehicle batches.
- Profile activity writes and persisted-snapshot verification now run concurrently
  after the ingest RPC, without changing the first-connection null guard.
- History dynamically imports Analytics only when that tab is selected and trip
  visualizations only when a detail panel opens. The production React loadable
  manifest contains separate dynamic entries for both boundaries, keeping the shared
  chart/map chunks out of inactive Charging and collapsed Trips paths.
- Analytics range changes now call the new `period-overview` operation once; its
  RLS-scoped trip and charging-session reads start concurrently. The older individual
  operations remain available for compatibility.
- Verification: focused efficiency/charging tests pass, `npm run test` passes 102/102,
  the separately excluded charging-auto-session suite passes 4/4, targeted server/lib
  ESLint passes, and `npm run build` passes. A local authenticated development smoke
  request returned HTTP 200 with both `trips` and `sessions` arrays.

Residual observation from the smoke run: the pre-existing lifetime-map request returned
500 and the lower route/SoH Analytics requests were slow. They were not changed under
this approved scope and should be diagnosed separately.

**Follow-up (code review):** the bulk-upsert for auto-session/charge-notification state
turned per-vehicle failures into an all-vehicles-blocked failure on a multi-vehicle
account (one bad row rolled back the whole batched statement), so both state writes are
back to a per-vehicle loop — the single-pass latest-device-time lookup is unchanged.
`period-overview` now uses `Promise.allSettled` so a session-fetch failure no longer
blanks trip data too. `updateTelegramLiveWidgets` now reuses the shared
`latestSampleByVehicle` helper instead of its own inline reverse-scan. The `period-trips`/
`period-sessions` compatibility branches are intentionally kept as-is per the note above.

### Persist the onboarding car-generation choice

- Independent gap found while investigating the distance bug: the onboarding
  "2025+ / 2024" toggle only switched which Mate install steps were displayed and was
  never saved, and the car form defaults new cars to `gen1_2024`. A gen2 owner who
  answers the toggle correctly could still end up with a `gen1_2024` row. (Cl's own
  car is correctly `gen1_2024`, so his label was never the distance-bug cause — that
  fix keys on energydata presence, not generation — but the field still drives
  charger presets and knowledge-base filtering, so it should reflect reality.)
- The toggle answer is now committed on onboarding exits (Next → link step, Skip):
  stored in app preferences (`onboardingCarGeneration`, validated by
  `isCarGeneration` on parse/merge) and written to any existing car rows via the new
  `setUserCarGeneration` server action (RLS-scoped). The connected-screen "Enter"
  intentionally does not persist — an already-linked account revisiting /onboarding
  never sees the toggle, and writing its untouched default would clobber a
  deliberate setting.
- `CarForm` (create mode) now seeds its generation default from the persisted
  onboarding choice, falling back to the historical `gen1_2024`.
- Verification: `npm run test` 102/102, ESLint clean on all five touched files,
  `npm run build` passes.

### Fix "distance since charge" double-counting energydata trip twins

- User Cl's live view showed 198.2 km "driven since charge" — impossible for a 50%
  SOC drop at 2.1 km/%. Prod DB confirmed: since the last finished charge
  (2026-07-03), 18 `telemetry` trips (114.7 km) each had a near-identical
  `byd_energydata` cloud-summary twin (11 rows, 83.5 km) from the Mate v0.4.7
  trip-summary sync, and `sumDistanceSinceCharge` summed both: 114.7 + 83.5 = 198.2.
- New `dedupeTripsBySource(trips)` in `src/lib/bydmate/hero-drive-metrics.ts`: an
  energydata row is dropped when a telemetry trip overlaps it in time (±5 min
  tolerance); energydata rows with no telemetry twin are kept (daemon was offline).
  `computeHeroDriveMetrics` dedupes before summing and picks the latest trip from the
  deduped list, so km/1% prefers the SOC-bearing telemetry row.
- Keys purely on the presence of `byd_energydata` rows, **not** on
  `cars.model_generation`. Cl's car is genuinely `gen1_2024` (DiLink 3) yet still
  syncs energydata summaries — energydata capability tracks firmware, not model
  generation — so gating on generation would have wrongly skipped exactly the user
  who reported the bug. (An earlier iteration gated on `gen2_2025`; that parameter
  was proven dead — with no energydata rows there is nothing to drop regardless of
  generation — and removed.)
- Verified against Cl's prod data with equivalent SQL: dedupe yields 18 trips /
  114.7 km, matching the SOC sanity check (~105–115 km).
- Also repaired a stale assertion in `hero-drive-metrics.test.mjs`
  (`formatKmPerPercent` no longer embeds the "km/1%" unit — it lives in the label).
- Verification: focused tests 9/9, `npm run test` 102/102, targeted ESLint clean
  (file-level errors pre-exist unchanged), `npm run build` passes.

## 2026-07-10

### Scheduled parked/off remote commands
Recurring comfort commands (climate/window actions) now run while the car is parked
and off, using the existing VoltFlow Mate poll daemon instead of a local APK timer.
- New `vehicle_command_schedules` table (RLS, owner-scoped) storing an IANA time zone,
  local run time, and weekdays per schedule.
- The authenticated Mate command-poll transaction atomically materializes any due
  schedule into a normal pending `vehicle_commands` row via
  `enqueue_due_vehicle_command_schedules`, then advances `next_run_at`
  (`next_vehicle_command_schedule_run`). Missed runs older than 2 minutes are
  deliberately skipped so a stale preheat/unlock never fires late.
- Migration `20260710150000_vehicle_command_schedules.sql` applied to self-hosted prod
  (`supabase.mykid.life`) 2026-07-10.
- API CRUD + a PWA control for recurring climate/window actions.

### Telegram live-widget chat-list summary
The bot chat list only ever showed the beginning of the latest live-widget message, so
it truncated to the car name/state. The same editable widget message now opens with a
compact first line (`🔋 79% · P 41 694 км`) before the full car name/state, SOC bar,
charging details, and map link — so the chat list stays useful without a second
message cluttering the conversation.

### Repair analytics correctness and database query fan-out

- Phantom drain no longer consumes a silently capped 1,000-row raw response. New
  `bydmate_phantom_drain_daily` aggregates the full selected range in Postgres and
  treats Di+ gun state `1` as unplugged before a stale `is_charging` fallback.
- The year SoH chart now receives one valid latest sample per UTC day from
  `bydmate_soh_daily` (with a partial SoH index), instead of up to 366 raw queries.
- Route insights now fetch bounded track and temperature inputs for all visible trips
  with one `bydmate_route_insight_inputs` call, removing the serial per-trip N+1
  waterfall. All three callers retain correct, temporary fallbacks until their
  matching migration is present.
- Analytics resolves a selected telemetry `vehicle_id` through `cars.vehicle_alias`
  and filters `charging_sessions.car_id`, fixing mixed charging costs/sessions for
  multi-car users in monthly, period, and cost-per-km summaries.
- Added focused response-mapping and session-scope regression tests; documented the
  production query invariants in `docs/CHART_OPTIMIZATION_SPEC.md`.
- Verification: focused tests pass, `npm run test` passes (100 existing globbed tests),
  targeted ESLint passes, and `npm run build` passes. Local migration execution was
  not possible because `127.0.0.1:54322` is not running; migration
  `20260710170000_analytics_query_fanout_repairs.sql` still needs to be applied before
  deploying the matching web code.

### Fix History Analytics range chips jumping into a future period

- Reproduced the anchor drift: Day July 10 → Week W28 → Month July (month-end anchor)
  → Week W31 / July 27 → Day July 27, despite no forward navigation.
- Analytics range chips now re-anchor from the user's current **local** calendar date
  on every selection. Historical navigation remains available through the dedicated
  range anchor controls.
- Added pure regression coverage for the July 10 Day → Week → Month → Week → Day flow
  and documented the behavior in `docs/CHART_OPTIMIZATION_SPEC.md`.

---

### Fix false auto-charging sessions when Di+ says the gun is unplugged

- Diagnosed car `way`: a parked 79% snapshot had no charge power and Di+ gun state
  `1` (unplugged), but a stale `is_charging: true` created a zero-energy open session
  and made the dashboard correctly—but misleadingly—show **Stop Charging**.
- `isMateAutoSessionCharging` now accepts the normalized Di+ context and rejects the
  stale Boolean fallback when gun state is explicitly `1`; a positive
  `charge_power_kw` still wins as real charging evidence.
- `processBydmateAutoChargingSessions` now passes each telemetry sample’s Di+ context
  into the detector. Two subsequent unplug samples will close the existing false row
  through the normal auto-stop path.
- Added the regression test and updated `AGENTS.md` plus
  `docs/CHARGING_SESSIONS.md` to document the precedence rule.
- Focused charging suite: 45 passing. Production build and touched-file ESLint pass.

---

### Agent guidance contract and skill map consolidated

- `AGENTS.md` now clearly gates every tracked-file change behind a researched
  `BACKLOG.md` plan and explicit approval; read-only reviews remain non-mutating.
- Added a documentation-precedence order: `AGENTS.md` for workflow and durable
  safeguards, canonical domain docs for detailed behavior, then source/tests for
  suspected drift. `SKILLS.md` is explicitly navigational and never authoritative
  over a domain doc.
- Rewrote `SKILLS.md` around owner-file maps and verification commands. It no longer
  duplicates volatile charging thresholds, removes the duplicated reconcile entry,
  includes the plan/Agentmemory/Next.js startup gates, and makes branch creation safe
  for dirty working trees.
- Verified the Mate auto-start truth remains four consecutive parked charging samples
  (`charging-auto-session-step.ts` and `docs/CHARGING_SESSIONS.md`); the former stale
  two-sample instruction is gone.

---

### Vercel Hobby efficiency: remove redundant proxy/API work

- `src/proxy.ts` now bypasses public pages before creating a Supabase client and excludes
  all `/api/`, PWA metadata, and icons in its matcher. Protected page redirects and the
  authenticated `/login` redirect remain intact.
- Trip reads now use the browser Supabase client under RLS, preserving the existing
  energy enrichment and development API path. Realtime refreshes on trip creation or
  completion; the 60-second fallback does not requery during every ingest update.
- Command polling changed from 15 to 60 seconds in production (Realtime stays primary).
  Active charging-session sample polling changed from 15 to 30 seconds and stops while
  the tab is backgrounded.
- The GitHub Mate release route now has a five-minute CDN cache. `vercel.json` runs a
  docs/migrations/screenshots-only ignore command to avoid unnecessary build execution.
  Vercel still counts canceled ignored deployments toward deployment/concurrency limits,
  so this is build-time hygiene rather than a quota solution.
- Added `src/proxy.test.mjs` matcher coverage. `npm run test` (100 tests) and
  `npm run build` pass.

The remaining dominant source of Vercel invocations is Mate telemetry ingest. The next
recommended step is the separately scoped BYDMate APK flush-interval change, then
measure Vercel Observability before considering an Edge Function port.

---

### Fix the 7 bugs from the 2026-07-10 code review (reconcile windows, autoservice ingest gap, dead is_charging branch)

All 7 confirmed findings from the review of a51e6c5 + 6177911:

1. **[CRITICAL] autoservice columns always NULL** — new migration
   `20260710120000_ingest_autoservice_fields.sql` redefines the 10-arg
   `bydmate_ingest_telemetry` wrapper to extract `autoservice.*` from
   `p_raw_payload` into the 9 `autoservice_*` columns on samples + live
   snapshots (batch path calls the wrapper per sample, so both ingest routes are
   covered; no route change needed). Live snapshots carry last-seen values
   forward when a sample has no autoservice block (SoH-style carry-forward).
   **Not yet applied to prod** — needs the psql pooler apply.
2. **[HIGH] Corrupt `stopped_at` bypassed the live SOC window** and
3. **[HIGH] backwards `stopped_at` blocked it** — `liveSocWithinSessionWindow`
   moved into `charging-session-reconcile-logic.ts` (testable) and now anchors
   the window end on `updated_at` (the moment of the botched close) whenever
   `stopped_at` is unparseable or before `started_at`; no usable anchor → no
   trusted window. Returns `{ soc, receivedMs }` so the caller can also use the
   snapshot's receipt time as a stop anchor.
4. **[HIGH] dead `is_charging` fallback** — `isMateAutoSessionCharging` now
   returns `true` for parked `is_charging` below 100% SOC (the final return
   repeated an always-false power check; auto-start never fired on
   `is_charging`-only evidence).
5. **[MEDIUM] 1-minute duration fallback** — `buildReconciledSessionPatch`
   returns `null` (leave the row alone) when there is no plausible stop
   evidence, instead of stamping `started_at + 60s`; the in-window live
   snapshot's `received_at` now joins the last-resort stop candidates.
6. **[MEDIUM] future `stopped_at` won `Math.max`** — stop candidates (and the
   stored-stopped_at validity check) are capped at `nowMs + 60s` skew.
7. **[LOW] `fuel_kwh` rendered as "L"** — TripStatsGrid unit fixed to `kWh`.
   (Note: the `20260708120000` migration comment calls the source field "liters
   equivalent" — if real PHEV data proves it's liters, rename the column
   instead.)

8 new regression tests (`charging-session-reconcile.test.mjs`,
`telemetry-charging.test.mjs`); full suite 104 tests green, build passes.

---

## 2026-07-09

### DiLink 5 full parity: fuel_kwh, autoservice FID fields, battery snapshots + idle drains

Three-phase implementation to reach full BYDMate data collection parity with DiLink 5 vehicles:

**Phase 1 — energydata fuel fix:**
- Migration `20260708120000_add_fuel_kwh_to_trips.sql` — adds `fuel_kwh` column to `bydmate_trips`, updates `bydmate_ingest_trip_summaries` RPC to accept fuel_kwh
- `src/lib/bydmate/trip-summary-payload.ts` — Zod schema accepts `fuel_kwh?: number | null`
- `src/types/database.ts` — `BydmateTripRow.fuel_kwh?: number | null`
- `src/components/history/history-view.tsx` — TripStatsGrid shows fuel when > 0 (PHEV indicator)
- `src/lib/i18n.ts` — `fuel` key in ru/be/en dictionaries

**Phase 2 — autoservice Binder fields:**
- Migration `20260708130000_add_autoservice_fid_fields.sql` — 9 autoservice columns on `bydmate_telemetry_samples` + `bydmate_live_snapshots` (soc, power, gun state, BMS state, capacity, voltage, battery type, lifetime mileage, lifetime kWh)
- `src/lib/bydmate/ingest-payload.ts` — `autoservice` object added (optional, passthrough)
- `src/types/database.ts` — autoservice fields on both sample + snapshot row types

**Phase 3 — battery snapshots + idle drains:**
- Migration `20260708140000_battery_snapshots_and_idle_drains.sql` — `bydmate_battery_snapshots` (BMS health at charge session ends, SOC delta >= 5%) + `bydmate_idle_drains` (zero-km parked consumption)
- Policies wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object` for idempotency

All 3 migrations applied to production. Build passes.

**APK side not yet implemented** — user must add Binder reads in BYDMate-own repo.

---

## 2026-07-08

### energydata trip-summary cloud sync — APK sender shipped (VoltFlow Mate v0.4.7)

The missing APK half of the 2026-07-06 web work (BYDMate-own repo,
[release v0.4.7](https://github.com/scroodge/BYDMate-own/releases/tag/v0.4.7)).
New `TripSummaryCloudSync` posts locally imported energydata trips to
`POST /api/bydmate/trip-summaries` after each `HistoryImporter.runSync()`:

- Same auth as telemetry (`X-API-Key` / `X-Vehicle-Id` via `CloudTelemetryClient`);
  endpoint derived from the configured telemetry URL. Hard-gated on Cloud Sync
  linked + car named, data source ENERGYDATA only (ADB/DiPlus cars don't
  double-report), Wi-Fi-only respected.
- Batches ≤300 (server zod limit) with a `start_ts` watermark advanced only on
  acknowledged batches; server upserts on `(user, vehicle, started_at)` so lost
  acks re-send safely. Zero-km idle records and out-of-zod-range rows filtered
  client-side (one bad element would 400 the whole batch).
- 14 unit tests (`TripSummaryCloudSyncTest`); full suite green.

**Verified in prod:** real DiLink 5 user synced 874 trips / 8,330 km (audit
2026-07-08). Docs/onboarding follow-up still pending — see BACKLOG.

---

## 2026-07-07

### Fixed: closed-session reconcile inflating finished charging sessions with a later charge's SOC

Car `way`, 2026-07-06: a DC fast charge that really ran 16→38% got recorded as 16→68%
with `stopped_at` rewritten to a highway sample mid-drive, double-counting the following
AC session's energy. Root cause was three compounding bugs in the closed-session repair
path (`src/lib/charging-session-reconcile-logic.ts` + `charging-session-reconcile.ts`),
not the auto start/stop logic (which worked correctly):

1. **Live-SOC bleed across sessions** — `measuredSocFromMate` used the car's live SOC
   *fresh relative to now*, with no check that it belonged to the session being repaired.
   Every later app-open during the next charge ratcheted the already-closed session's
   `current_percent` up to the car's current SOC. Fix: `liveSocWithinSessionWindow()` in
   `charging-session-reconcile.ts` now only passes `liveSoc` into the closed-session patch
   when the live snapshot's `received_at` falls inside `[started_at, stopped_at + 5min]`.
2. **Driving samples counted as charging evidence** — `isAcWallboxCharging` fell back to
   `power_kw` (positive while driving) with no speed guard, so `stopped_at` got dragged
   forward through an entire drive. Replaced with `isChargingEvidence()`: requires
   `charge_power_kw > threshold` and the vehicle parked (`speed_kmh ≤ 5`), reusing the
   same constants as the (already-correct) auto-session charging check.
3. **`stopped_at` candidate list included `lastSocAt`** (any sample with a SOC reading,
   charging or not) — dropped from the primary candidates; kept only as a last-resort
   fallback when the stored `stopped_at` itself is missing/invalid.
4. **Latent collapse risk** (found while reading, not yet observed in the wild): a
   below-target session with no SOC telemetry in its window and no live SOC would fall
   back to `start_percent`, wiping a legitimate recorded session. `buildReconciledSessionPatch`
   now returns `null` (no-op) instead of guessing.

Regression tests added to `charging-session-reconcile.test.mjs` modeled on the July-6
shape (6 new cases); all pre-existing tests + full suite + `tsc` + `next build` pass.

**Data repair:** three prod rows had already drifted from the bug — `712dd712…` (Jul 6,
16→68% → corrected to 16→38%), `333a1835…` (Jun 30, 32→100% → corrected to 32→64%),
`58f82cfb…` (Jul 3, 50→72% → corrected to 50→66%) — repaired directly via `psql` against
the self-hosted pooler, values re-derived from `bydmate_telemetry_samples` (last real
`charge_power_kw > 0` sample while parked, before the following drive).

**Not yet done:** code changes are in the working tree, not yet committed or deployed; the
bug is still live in prod until the next deploy — reconcile could re-corrupt the just-repaired
rows (or others) if the app is opened again before shipping. Item G from the original research (skip
re-scanning telemetry for consistent sessions older than ~48h, to cut egress) was not
built — kept as a possible follow-up if needed.

## 2026-07-06

### Providers unified into user-owned data (Home permanent, rest fully deletable)

Replaced the hardcoded `PROVIDER_TARIFF_PRESETS` + per-user `provider_tariffs`
override table with a single model: every provider (Home, Malanka, Evika!,
forEVo, Zaryadka, BatteryFly, plus any custom ones) is now a `user_providers`
row the user owns outright. Prompted by feedback that providers should be
user-dependent data, not app-wide constants with a bolted-on override/hide
layer — the fix is to make the already-working `user_providers` CRUD (add,
edit, checkbox → "Delete selected") the single source of truth.

- **Migration** `20260706200000_fold_builtin_providers_into_user_providers.sql`:
  adds `user_providers.is_default boolean`; seeds the 6 baseline providers per
  existing user (price = their old `provider_tariffs` override if present, else
  the hardcoded default; Home flagged `is_default`); repoints existing
  `charging_tariff_locations` rows from the bare enum (`'malanka'` etc.) to the
  newly-seeded `user_providers` row so auto-resolution keeps using each user's
  price; drops `provider_tariffs`.
- **New users**: seeding isn't a DB trigger (GoTrue has silently dropped
  `on_auth_user_created` before — see [[handle-new-user-trigger-dropped]]).
  Instead `useSeedDefaultUserProviders()` (`src/hooks/use-user-providers-query.ts`)
  lazy-inserts the 6 defaults the first time `user_providers` resolves empty,
  mounted globally via `<DefaultProvidersSeed />` in `MobileShell` so it fires
  regardless of which page loads first.
- **Lib** (`src/lib/charging-tariffs.ts`): new `defaultUserProviderSeeds()` and
  `findDefaultHomeProvider()`; `PROVIDER_TARIFF_PRESETS` kept only as the
  fallback for historical bare-enum rows. The power-based auto-tier fallback
  (no manual pick, no GPS match, low charger power) now resolves through the
  user's `is_default` Home row instead of a hardcoded constant.
- **Settings UI**: the separate "Provider tariffs" (built-in, price-override-only)
  card is gone — merged into "Your providers", which now lists every provider
  with editable AC/DC prices. Home has no checkbox (can't be selected for
  delete); every other row can be repriced or removed like a custom one.
- **Dashboard / charge screen / settings location form**: all 4 places that
  used to hardcode the built-in provider list now enumerate `user_providers`
  rows only, plus `custom` (manual price, always available).
- Fixed a latent bug found while touching this: the dashboard's parked-charge
  price estimate never passed its `estimateUserProviderId` into price
  resolution, so picking a custom provider there silently priced at 0.
- **Tests**: `charging-tariffs.test.mjs` covers the seed shape, the Home-excluded
  auto-fallback, and legacy bare-enum resolution for historical data.

### energydata trip-summary cloud sync — web half

Web side of letting no-ADB BYD trip logs reach VoltFlow (APK side still pending —
see BACKLOG). Triggered by a real user's Yuan UP 2025 / DiLink 5 confirming (via the
VoltFlow Mate v0.4.6 «Диагностика BYD» button) that their firmware writes
`/storage/emulated/0/energydata/EC_database.db` — 876 trips, readable with no ADB.

- **Migration** `20260706190000_bydmate_trip_summary_source.sql`: `bydmate_trips.source`
  (`telemetry` default / `byd_energydata`), a partial unique index on
  `(user_id, vehicle_id, started_at) where source='byd_energydata'` for idempotent
  re-import, and `bydmate_ingest_trip_summaries(user_id, vehicle_id, trips jsonb)` RPC
  (security definer, service_role only) that upserts per-trip aggregates and derives
  `avg_speed_kmh` / `avg_consumption_kwh_100km` server-side so the existing history UI
  needs no new fields. Verified in a rolled-back transaction: insert, then re-ingest with
  the same `started_at` updates in place (no duplicate row); math matches the real
  report's trip (46.85 km/h, 20.0 kWh/100km for 6.0 km / 461 s / 1.20 kWh).
- **API** `POST /api/bydmate/trip-summaries` (`src/app/api/bydmate/trip-summaries/route.ts`):
  same `X-Api-Key` → `profiles.bydmate_cloud_api_key` auth as `/api/bydmate/telemetry`;
  Zod-validated batch (`src/lib/bydmate/trip-summary-payload.ts`, max 300, epoch-second
  timestamps matching `EnergyConsumption.start_timestamp`).
- **UI**: small "BYD log" badge on trip cards where `source === 'byd_energydata'`
  (`history-view.tsx`); no other changes needed — charts/route panels already have
  empty states for trips with no telemetry samples or GPS track, and `fmt()` already
  renders missing SOC as `—`.
- These are per-trip **aggregates only** (no samples, no track, no SOC) — bypass
  `bydmate_ingest_telemetry` and its junk-trip rules entirely.

### Editable provider tariffs + auto-save GPS point after manual provider pick

Two-part feature so per-provider prices (Malanka, Evika, etc.) are no longer
hardcoded, and a manual provider pick during a charge quietly turns into a saved
GPS location for next time.

**Part 1 — editable provider tariffs:**
- **Migration** `20260706010000_provider_tariffs.sql`: new `provider_tariffs` table
  (PK `user_id, provider_type`, AC/DC/home prices, RLS own). No seed rows — a
  missing row means "use the hardcoded `PROVIDER_TARIFF_PRESETS` default".
- **Lib** (`src/lib/charging-tariffs.ts`): `resolveProviderTariff()`,
  `providerTariffsFromRows()`; `resolveTariffPrice()` / `resolveSessionTariff()`
  take an optional `providerTariffs` overrides map — user override wins over the
  hardcoded preset, a location's `price_per_kwh_override` still wins over both.
- Wired into all three tariff-resolution call sites (`startChargingSession`,
  `syncChargingSessionTariffFromGps` in `src/actions/sessions.ts`, and
  `resolveTariffForTelemetry` in `src/lib/bydmate/charging-auto-session.ts`) and
  three client spots (charge-screen provider pick, dashboard park estimate,
  settings) via a new `useProviderTariffsQuery` / `useProviderTariffOverrides`
  hook (`src/hooks/use-provider-tariffs-query.ts`).
- **Settings UI**: the old "Provider preset" dropdown (which silently reset to
  "Manual values" and never actually persisted a chosen provider — see the
  superseded BACKLOG item) is replaced by a "Provider tariffs" editor: one row per
  built-in provider with AC/DC price fields and a single save button. Rows with a
  saved override show a checkbox — checking one or more swaps "Save provider
  tariffs" for a "Cancel" / "Delete selected (N)" row, which deletes those
  override rows from `provider_tariffs` (the provider itself reverts to its
  hardcoded default price, same bulk-select pattern as custom providers below it).

**Part 2 — delayed GPS point save:**
- **Migration** `20260706020000_charging_sessions_tariff_selected_at.sql`: new
  `charging_sessions.tariff_selected_at`, set whenever the user manually saves a
  tariff on the active charge screen; re-picking resets the clock.
- New pure decision module `src/lib/charging-tariff-location-autosave.ts`
  (`decideTariffLocationAutosave`, `TARIFF_LOCATION_AUTOSAVE_DELAY_MS = 5 min`,
  `uniqueTariffLocationName`) plus server action
  `persistManualTariffLocationFromSession` (`src/actions/sessions.ts`): once a
  manual, non-custom provider pick has stuck for 5 minutes on a still-charging
  session, it takes the car's GPS from the live snapshot (browser GPS fallback),
  dedupes against existing saved locations (same provider → skip, different
  provider → correct that point), and otherwise inserts a new point named after
  the provider (150 m radius, no price override, so later tariff edits propagate).
  Unplugging before 5 minutes saves nothing (filters out mis-taps).
- **Trigger**: new hook `useChargingTariffLocationAutosave`, polled every 30 s from
  the global `ChargingSessionBackgroundSync` — survives navigating away from the
  charge screen.
- Tests: `src/lib/charging-tariffs.test.mjs` (override lookup) and
  `src/lib/charging-tariff-location-autosave.test.mjs` (persist decision:
  too-early / not-manual / custom-provider / dedupe-same / dedupe-different /
  insert).

### User-connected providers — add/remove custom providers per-user

Users can now create their own charging providers with custom names and prices, and
remove them. These appear alongside built-in providers (Malanka, Evika, etc.) in all
selectors. Built-in providers remain unchanged.

**Migration** `20260706180000_user_providers.sql`:
- Added `'user_provider'` to `charging_provider_type` enum (marker value)
- New `user_providers` table (per-user label + 3 prices, RLS, unique per label)
- Nullable `user_provider_id` FK on `charging_sessions` and `charging_tariff_locations`

**Lib** (`src/lib/charging-tariffs.ts`):
- `resolveProviderTariff()` now handles `'user_provider'` — looks up prices from
  `user_provider` rows
- New `userProvidersFromRows()`, `resolveUserProviderPrices()`, `UserProviderMap` type
- `TariffResolution` includes `userProviderId`
- `ProviderTariffOverrides` excludes `user_provider` (prices live in user_providers)

**Types** (`src/types/database.ts`): `ChargingProviderType` union includes `'user_provider'`,
new `UserProviderRow` type, `user_provider_id` on `ChargingSessionRow` and
`ChargingTariffLocationRow`.

**Hook** (`src/hooks/use-user-providers-query.ts`): fetches user's `user_providers` rows;
`useUserProviderMap()` returns the id→row map for resolution.

**Server actions** (`src/actions/sessions.ts`, `src/lib/bydmate/charging-auto-session.ts`):
all tariff resolution call sites also fetch `user_providers` rows and pass
`userProviderMap` into `resolveSessionTariff`. Created sessions save `user_provider_id`.

**Settings UI** (`src/components/settings/settings-view.tsx`): new "Your providers" card
with:
- List of existing user providers (label, AC/DC prices), each row a checkbox rather
  than a per-row Delete button — selecting one or more swaps the add-provider form
  for a "Cancel" / "Delete (N)" action row, so removing several providers doesn't
  need N separate confirmations.
- Add provider form (label, AC price, DC price, Save button) — hidden while a
  selection is active.
- Duplicate label detection and validation

**Provider selectors** (4 components):
- Dashboard park estimate (`dashboard-view.tsx:ParkChargeEstimatePanel`)
- Dashboard manual session dialog (`dashboard-view.tsx`)
- Charging session screen (`charging-session-screen.tsx`)
- Settings tariff location form (`settings-view.tsx`)
All use `up_<uuid>` namespace convention for user-provider values and merge built-in +
user providers in a single dropdown.

**i18n**: new keys in en/be/ru for add/delete provider flows.

**Tests**: `charging-tariffs.test.mjs` – user provider tariff resolution, user provider
with location match.

### Inactive account auto-cleanup

30-day inactivity → Resend warning email → 60-day auto-deletion. Premium users exempt.

- **Migration** `20260706120000_profiles_inactivity_cleanup.sql`: added
  `last_active_at` + `inactivity_warning_sent_at` to `profiles`.
- **Activity tracking**: `last_active_at` updated on every telemetry ingest
  (`route.ts`) and on web login via `touchUserActivity()` server action
  (throttled to 1/hour, called from `MobileShell` on mount).
- **Email infra**: `resend` npm package installed; `sendInactivityWarning()` in
  `src/lib/email/inactivity-warning.ts`.
- **Cron route**: `POST /api/cron/inactivity-check` (CRON_SECRET gated) sends
  warnings at 30d and deletes accounts at 60d via
  `supabaseAdmin.auth.admin.deleteUser()`.
- **Self-service deletion**: "Delete account" card in settings with type-to-confirm
  (`Trash2`, DELETE text), calls `src/actions/account.ts`.
- **Policy updates**: privacy + terms (world + belarus) × 3 locales — added
  inactivity paragraph in Retention / Termination sections. Date bumped to
  2026-07-06.
- **Remaining**: add daily crontab entry on Contabo to curl the cron route.

### Auto page while charging: charge params lead, then rest, Delta, Remote
During an active charge the Авто page used to mix charge metrics into the hero grid
and duplicate power/type/temps in a "Идет зарядка" card at the very bottom. Rebuilt
the charging layout in `src/components/vehicle/vehicle-live-view.tsx` (single file,
no schema/i18n changes):
- **Hero** is slimmed while charging: SOC + status badge + last update only.
- **`ChargingModeCard`** (cyan, "Идет зарядка") moved to directly under the hero and
  extended from 4 to 7 tiles: charge power, charge type, battery temp, outside temp,
  remaining, energy delivered, cost at 100%. The `chargeSummary` projection memo
  moved out of `Hero` into this card (takes `session` prop); `—`-valued tiles are
  hidden via `isMissingMetricValue`.
- New **`RestMetricsCard`** below it with the displaced hero metrics: AI range,
  math range, 12V battery, odometer.
- Then **`ChargingDeltaCard`** (Delta by SOC) and **`VehicleControlPanel`**
  (Remote commands, admin) in that order.
- Non-charging and stale layouts unchanged; `is_charging` without an open
  auto-session still renders power/type/temps from telemetry (summary tiles hidden).
- Verified: `npm run build` clean; lint shows no new issues in the file.

### Telegram: only the live widget remains — verbose state messages removed
The "ℹ️ Ваш автомобиль … подключился к сети / в режиме стоянки / отключен от сети"
messages (Пробег/🔋/Время + maps link) duplicated the editable live widget and
spammed the chat on every connect/park/reconnect. Built backlog Option A:
- Deleted `src/lib/push/vehicle-state-notifications.ts` and its call + import +
  `vehicle_state_notifications` response field in
  `src/app/api/bydmate/telemetry/route.ts` (its only call site).
- Migration `20260706000000_drop_bydmate_vehicle_state_notifications.sql` drops the
  module's state table (`drop table if exists`, idempotent). ⚠️ **Deploy order
  matters:** with the table gone but the *old* code still deployed, every ingest
  batch sees "no previous state" and fires a connected message — so the table was
  re-created on prod as a shim. **Run the drop migration via the pooler psql recipe
  AFTER the new code is live on Vercel.**
- Side benefit: ~4 fewer DB queries per ingest batch (egress/CPU initiative).
- Kept: the live widget (`updateTelegramLiveWidgets`) and the separate
  `Charging: 80/95/100%` threshold notifications (user chose to keep them).
- Accepted trade-offs: no Telegram ping on connect (widget edits are silent), no 💰
  cost estimate line, no explicit "disconnected" message (widget shows 💤 Офлайн).

### Settings → tariff save: visible progress + confirmation (UX)
Pressing **Save** under Settings → Economics gave no feedback until the Supabase
round-trip finished (fire-and-forget update, no pending state on the button).
Built Option A from the backlog plan, in `settings-view.tsx` + `i18n.ts` only:
- Save button now has a `saving` state (disabled + spinner + "Saving…") and a ~2 s
  "Saved ✓" confirmation state where the user is looking; double-submit guarded.
- `toast.promise` shows an instant "Saving…" toast that resolves to success/error;
  on error the previous prices are rolled back (as before).
- Applying a **provider preset** now shows an info toast reminding that the values
  still need to be saved (they only fill the form).
- New i18n keys `settings.tariffSaving`, `settings.tariffSavedShort`,
  `settings.locationTariffs.presetAppliedHint` in en/be/ru.

---

## 2026-07-01

### Signup email verification required
Free-user signup now requires clicking a confirmation email instead of instant
autoconfirmed access. Root cause of "no signup email ever arrives": GoTrue ran with
`ENABLE_EMAIL_AUTOCONFIRM=true`, so no mailer send was ever triggered.
- Server (contabo `/opt/supabase`): `.env` → `ENABLE_EMAIL_AUTOCONFIRM=false`;
  `docker-compose.yml` auth service adds `GOTRUE_MAILER_SUBJECTS_CONFIRMATION` (bilingual
  static subject — GoTrue does not template subjects) and
  `GOTRUE_MAILER_TEMPLATES_CONFIRMATION` pointing at a trilingual (`ru`/`be`/`en`)
  `confirmation.html` hosted by host nginx. Applied + `auth` container restarted healthy;
  existing 28 users and Google OAuth unaffected.
- Link uses the same prefetch-proof **token_hash** pattern as password reset (plain-GET
  email prefetchers like Apple Mail Privacy Protection or Telegram's preview bot cannot
  burn the token, since verification only happens client-side on `/auth/confirm`).
- Client: `src/app/auth/confirm/page.tsx` calls `verifyOtp({ type: 'signup', token_hash })`
  on mount then routes to `/onboarding`; `/auth/confirm` added to `PUBLIC_PATHS` in
  `src/proxy.ts`; `login-form.tsx` shows a "check your inbox" panel + Resend
  (`supabase.auth.resend`) on signup with no session, and surfaces `email_not_confirmed`
  on sign-in with the same resend affordance. i18n keys added in en/be/ru.
- Also fixed in the same session: a pre-existing `npm run build` break in
  `scripts/test-live-widget.ts` blocking Vercel builds on `main`.

---

## 2026-06-30

### Inline charging on `/vehicle` Live + Charge tab removed
The Charge tab used to redirect to a separate `/charging/[id]` page while charging.
Charging params (time-left, delivered kWh, cost-at-100 %) and the SOC graph now render
inline on the Live view when a session is active; the Charge tab is gone (`?tab=charge`
→ Live). Deep links `/charging/[id]` and `/history` are unchanged. Exactly one
`useChargingSessionLiveSync` owner while charging.

### Charge-session finish detection — overshoot/stuck fixes
Fixed four compounding finish-detection bugs:
- **Math overshoot** → SOC clamp (`clampDerivedToSocCeiling`): projected `current_percent`
  can't exceed `latestSoc + rate × secondsSinceLatestSoc`.
- **Garbage charger power** → `sanitizeChargerPowerKw` rejects AC > 22 kW / DC > 350 kW.
- **Stuck-open sessions** (car sleeps, no unplug samples) → stop-on-silence in reconcile
  (`OPEN_SESSION_SILENCE_MS = 15 min` + stale live SOC).
- **`energy_overridden` lock-in** → repair migration
  `20260630150000_repair_math_overshoot_sessions.sql` (applied prod).

### BMS-measured charge energy — investigated, **not** used for cost
Validated on car `way` (45.1 kWh): the BMS counter `telemetry.kwh_charged`
(`FID_CHARGING_CAPACITY`) measures **battery-cell energy only** and reads ~47 % low vs
grid truth, because ~1.7 kW of active battery thermal management draws from the OBC
output before the cells. **Correct cost formula stays `SOC_delta% × capacity ÷ 100`,
efficiency ≈ 100 %.** `kwh_charged` is retained for diagnostics/thermal monitoring only.
> ✅ Follow-up done 2026-07-10 (`a1ff0b2`): `buildReconciledSessionPatch` now always
> derives energy/cost from `SOC_delta% × capacity ÷ 100`; the display power in
> `charging-session-screen.tsx` uses the di+ grid-side integer, not
> `deriveChargePowerFromEnergyDeltaKw`. Both stay defined for diagnostics only.

### Storage bucket write policies
`20260630120000` restricts insert/update/delete on the five knowledge/service buckets
to admins. Without these, admin CMS uploads silently 500'd on self-hosted prod (the
buckets/policies weren't carried over in the hosting migration). See
[docs/DATABASE_SCHEMA.md §Storage](docs/DATABASE_SCHEMA.md).

### BatteryFly charging provider
Added `batterfly` to the `charging_provider_type` enum (`20260630110000`).

### Telemetry samples — BRIN interim (partitioning Plan B)
BRIN index on `bydmate_telemetry_samples(device_time)` (~72 kB vs 10–42 MB btrees);
planner confirmed using it for time-range scans. Full range-partitioning (Plan A)
remains unbuilt — see [BACKLOG.md](BACKLOG.md).

---

## 2026-06-29

### Settings — no GPS prompt on every open
Removed the mount-time `getCurrentPosition()` in `settings-view.tsx`; GPS is fetched
only when the user explicitly asks, and the last value is cached in `localStorage`
(per-device, no DB privacy concern).

### Vehicle-state Telegram notifications
Connect / park / disconnect events detected during ingest and pushed to Telegram.
State in `bydmate_vehicle_state_notifications` (`20260629130000`). See
[docs/VEHICLE_STATE_NOTIFICATIONS.md](docs/VEHICLE_STATE_NOTIFICATIONS.md).

---

## 2026-06-24 — Egress / CPU initiative

Cleared the Vercel Fluid Active-CPU + Supabase egress caps (full details in the
local-only `docs/archive/EGRESS_CPU_MASTER_PLAN.md`):

- **A** Tiered charging-session poll (60 s / 5 s / 1 s by SOC), unified in
  `chargingSessionsRefetchInterval` so all observers of `queryKeys.sessions` agree
  (TanStack uses the shortest observer interval).
- **B** Reconcile gated to auto-session start/stop in the ingest route.
- **C** Trimmed the echoed `raw_payload` from the post-ingest verify re-read.
- **D** pg_cron daily telemetry purge (`20260624130000` →
  `purge_old_bydmate_telemetry_by_tier()`).
- **E** APK charging-bulk ~60 s flush (Mate repo) — ~4× fewer charging-phase POSTs.

Also dropped the redundant raw `diplus` blob from telemetry (DB 509 → 258 MB).

---

## 2026-06 (earlier) — Charging session integrity

- Auto start/stop sessions from Mate ingest (`20260602120000` +
  `processBydmateAutoChargingSessions`).
- One-time backfill of false `completed` rows (`20260602103500`).
- Fixed 2026-06-03 phantom sessions on car `way` (root cause: traction `power_kw` treated
  as charging; fix: `isMateAutoSessionCharging`, parked check, 4 samples, 3-min window).
- Tiered, premium-aware telemetry retention (`20260617133000`, `20260617135500`,
  `20260626130000`): free 30 d raw, premium + admin kept indefinitely.

---

## Infrastructure

- **Self-hosted Supabase** with Grafana monitoring and Telegram alerts. Migrations apply
  via `psql` (the CLI can't reach the no-TLS pooler). Host/infra specifics are in the
  local-only `docs/OPS_LOCAL.md`; migration history in the local `docs/archive/`.
- **GoTrue SMTP via Resend** for auth emails; fixed forgot-password 500 + prefetch-proof
  recovery flow.
- **Telegram Mini App entry** (BotFather Main Mini App); archived plan in the local-only
  `docs/archive/TELEGRAM_MINIAPP_PLAN.md`.
