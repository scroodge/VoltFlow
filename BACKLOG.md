# Backlog — proposed plans awaiting go-ahead

## Whole-project audit — 2026-09-11 (proposed fixes, not implemented)

Reviewed checkout `a9a7cbf` across authentication, database authorization, charging,
telemetry/trip delivery, exports, notifications, service records/storage, browser
state, public content, pairing, deployment and verification tooling. Preserved the
pre-existing CHANGELOG edit. This is a broad risk-based review, not a claim that
every line or every runtime combination was tested. No application fixes, migration
applications, account mutations, deployments, builds, lint or test runs were made.
Production checks were SELECT-only inside explicit `BEGIN READ ONLY` / `ROLLBACK`.
No personal records, credentials, private endpoints or raw operational logs are
retained here. Security paths were traced without exploiting them.

Evidence labels: **DB verified** means current production catalogs were inspected;
**source verified** means a concrete failure path exists in this checkout, but an
incident or deployed-source parity is not asserted. P0 = immediate security priority;
P1 = high-impact security/data integrity; P2 = correctness/reliability. These IDs are
local to this audit and deliberately do not reuse the companion project's B-numbers.

### AUD-01 — P0: Telegram session minting trusts a client-writable email

**DB + source verified.** Authenticated users have UPDATE on `profiles.email` and
`telegram_id`; profile UPDATE RLS checks only `auth.uid() = id`. The only attached
profile triggers maintain lifecycle counts, not identity integrity.
`src/app/api/telegram/auth/route.ts:67` takes the linked profile's email and at line
118 uses it to generate/redeem a magic link without verifying that the resulting
Auth user is the profile's user ID. The same trust boundary exists in
`scripts/telegram-miniapp-server.py` (`handle_auth`). This permits cross-account
session minting if an authenticated caller changes the email on their own linked
profile. HMAC validation authenticates Telegram, not that email-to-Auth relationship.
No account takeover was attempted and historical exploitation is unknown.

**Options/recommendation:** bind login to the server-resolved Auth user ID, obtain
its canonical email through the Auth admin API, and verify the redeemed session ID;
also protect email/Telegram/credential columns from direct client writes. A UI-only
restriction is insufficient because the database REST API remains accessible.
Identity and credentials are app-managed in Auth/Postgres; existing user preference
columns must retain their intended edit permissions. **Acceptance:** ordinary users
cannot change identity columns; both auth implementations reject mismatched Auth IDs;
normal Telegram linking, email login and preference changes remain functional.

### AUD-02 — P1: users can self-grant Premium through profile writes

**DB + source verified.** `profiles.is_premium` and `premium_until` are writable by
`authenticated` under the same own-row policy, without a protective trigger.
`is_user_premium(uuid,timestamptz)` directly trusts both columns, as does
`src/lib/voltflowmate/dashboard-entitlement.ts:39`. Consequently server-side
entitlement checks do not prevent a user from granting themselves extended access
and retention. Admin-list membership is separate; self-granting admin was not found.
**Recommendation:** explicit allowlisted preference-column grants plus server-only
entitlement writes, or a reviewed role-aware protection trigger. Treat entitlement
state as app-owned Postgres data; preserve user-owned preferences. **Acceptance:**
authenticated attempts to set either entitlement field fail, while authorized
administration and existing Premium users work. Coordinate the migration with AUD-01.

### AUD-03 — P1: excess TRUNCATE grants remain on 47 public tables

**DB verified.** Both API roles retain effective TRUNCATE on 47 public tables,
including profiles, cars, charging sessions, telemetry, device credentials and admin
membership. RLS is enabled but does not govern TRUNCATE. The just-hardened charging
cursor and pending queue are excluded from this finding. This is an excessive SQL
privilege boundary, NOT proof that a normal PostgREST DELETE can truncate a table or
that an anonymously callable destructive RPC still exists. The current anonymous
non-trigger SECURITY DEFINER inventory contains only the three documented public
helpers. [PostgreSQL's RLS documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
explicitly excludes whole-table operations from RLS.
**Recommendation:** inventory legitimate DML per table, remove unnecessary whole-table
privileges from PUBLIC/anon/authenticated, and repair creator-specific default grants;
do not blindly revoke all browser DML. App-owned authorization policy, no data move.
**Acceptance:** effective privilege matrix passes for current and newly created objects,
and legitimate browser/worker access remains intact.

### AUD-04 — P1: query cache survives account changes with unscoped keys

**Source verified.** `src/components/providers.tsx:25` owns a root-lifetime QueryClient;
`src/lib/query-keys.ts` uses account-independent keys for profiles, cars, sessions and
live telemetry. `settings-view.tsx` signs out through client navigation, while
`src/lib/privacy/client.ts:15` clears localStorage/Cache Storage but not QueryClient.
No query-cache clear/reset on auth change exists in source. A subsequent account in
the same SPA can see prior cached private results, at least until refetch; RLS cannot
remove data already in browser memory. Browser reproduction remains outstanding.
**Recommendation:** cancel/remove private queries on user-ID changes and scope private
keys by account; reset in-memory preferences as part of that transition. Full page
navigation alone is a weaker alternative. Cache is temporary browser data for
user-owned Postgres records. **Acceptance:** slow-network A-to-B login, sign-out and
account deletion never render A's cached data for B or an unauthenticated view.

### AUD-05 — P1: service receipts are public but ordinary users cannot upload them

**DB + source verified.** The `service-attachments` bucket is public in production.
Its INSERT/UPDATE/DELETE policies allow admins only, with no owner upload policy.
`src/actions/service-records.ts:188` uploads with the ordinary authenticated client
and stores `getPublicUrl()`: non-admin uploads fail, while an existing receipt URL
is publicly accessible. `deleteServiceRecord` also leaves the storage object behind.
**Options/recommendation:** private bucket with owner-path policies, authorized/signed
downloads and storage cleanup; retaining public receipts requires an explicit product
privacy decision and is not recommended. Receipts are user-owned files in Storage,
with metadata in Postgres. Confirm private access and legacy-URL migration before
building. **Acceptance:** non-admin owners can upload/view/delete their receipts;
other users and anonymous downloads are denied; replacement/deletion cleans old files.

### AUD-06 — P1: inactivity deletion ignores admin entitlement and fresh activity

**Source verified.** `src/app/api/cron/inactivity-check/route.ts:57` selects deletion
candidates by profile Premium fields, never by `admin_users` or `is_user_premium`.
Line 74 permanently deletes the Auth user without rechecking activity, warning state
or entitlement after selection. An admin without explicit profile Premium can qualify;
a user who returns or upgrades while the loop runs can also be deleted from a stale
candidate snapshot. No live deletion or affected-account enumeration was performed.
**Recommendation:** use the canonical entitlement predicate and a durable, guarded
deletion claim with final activity/entitlement revalidation and recovery semantics.
An extra frontend check is insufficient. Lifecycle state is app-managed Postgres data.
**Acceptance:** admins, upgraded users and users becoming active after selection cannot
be deleted; only eligible, warned accounts proceed through the authorized lifecycle.

### AUD-07 — P1: rollup RPC errors are acknowledged as successful application

**Source verified.** `src/app/api/bydmate/telemetry/route.ts:372` and line 395 await
Supabase RPC results but discard each result's `error`, then return the input block
count as `hourly_rollup_applied`/`trip_rollup_applied`. Supabase database errors resolve
as results, so the catch handlers do not catch them. Client-hourly inputs can skip
server aggregation and client-trip inputs create stubs, so the comment promising an
equivalent fallback row does not ensure the requested aggregates exist.
**Recommendation:** inspect each result and define explicit per-block ACK/retry behavior
with the Mate contract; preserve sample idempotency. Throwing on any error is simpler
but requires a tested whole-batch retry contract. Rollups remain user-owned Postgres
facts. **Acceptance:** injected DB errors never increment applied counts or cause a
failed final block to be discarded; retry yields correct aggregates without duplicates.

### AUD-08 — P1: production session-list reads bypass reconciliation

**Source verified.** `src/hooks/use-sessions-query.ts:20` invokes the reconciling
`/api/vehicle/sessions` route only in development mode; normal users SELECT directly
from Supabase. The history UI uses this hook. Ingest only reconciles on an auto
start/stop event (`telemetry/route.ts:448`). Thus reopening History after telemetry
goes silent does not perform the documented repair, and broken/open rows can persist.
**Recommendation:** add a bounded server reconciliation step to actual production
list entry, or schedule repair independently; avoid turning every 1-Hz tail poll into
a full reconciliation. No ownership/storage changes. **Acceptance:** reopening the
production history path repairs a silence-ended session without new ingest, and
normal polling does not repeatedly scan its whole telemetry history.

### AUD-09 — P1: other session writers can overwrite a newer finalization

**Source verified.** The live sync hook writes by session ID alone at
`src/features/charging/_client/use-charging-session-live-sync.ts:173` and line 211;
its async interval callbacks may overlap and in-flight callbacks survive effect cleanup.
`charging-session-reconcile.ts:121` likewise updates a snapshot-derived patch without
a status/version predicate. An auto/manual close or energy correction between read and
write can therefore be overwritten by stale progress or repair. Atomic ingest CAS
does not protect these later writers. This interleaving was not exercised in production.
**Recommendation:** conditional status/version updates and affected-row checks on every
writer; cancel/ignore stale UI generations and preserve correction flags. A client
mutex alone does not cover other tabs or server writers. **Acceptance:** two-connection
tests interleaving UI progress, manual stop, correction and reconciliation preserve
the newer terminal values. User-owned session records remain in Postgres.

### AUD-10 — P1: active pairing codes are not unique across users

**DB + source verified.** `src/lib/voltflowmate/link-code.ts:47` generates a six-digit
code without collision retry. Production has a non-unique active `code_hash` index.
Redemption chooses the newest matching active code, rather than uniquely identifying
one owner. Two equal active codes can therefore pair a device to the wrong account.
No collision was induced. **Recommendation:** atomically reserve a unique unredeemed
code hash with bounded generation retries and expiry cleanup. Merely increasing code
length reduces but does not enforce uniqueness. Pairing credentials are app-owned
Postgres data. **Acceptance:** forced collisions retry safely; concurrent creations
never leave ambiguous redeemable codes or return another user's credential.

### AUD-11 — P1: pairing changes credentials before it wins code consumption

**Source verified.** `src/lib/voltflowmate/link-code.ts:214` upserts the device credential
and may update the profile before line 253 conditionally consumes the link code.
A concurrent losing redeemer or a failure in a later statement can change credentials
despite returning failure; requests using different device kinds make the side effects
especially significant. **Recommendation:** combine code validation, consumption,
device update and any legacy mirror into one transaction; lock/claim the code before
effects. Reordering separate calls alone changes which partial-failure case occurs.
**Acceptance:** simultaneous redemptions produce one winner and zero loser side effects;
injected failures leave the previous working credential intact. App-owned Postgres state.

### AUD-12 — P2: public semantic search has no application abuse budget

**Source verified.** `src/app/api/knowledge/search/route.ts` accepts anonymous arbitrary
query lengths, invokes embedding generation via `src/lib/knowledge-search.ts`, and has
no rate/concurrency limit. The five-minute in-process cache only helps repeated queries;
unique strings still create paid external requests. Deployment WAF rules and actual
abuse were not audited. **Recommendation:** bounded input plus a shared request budget
and provider timeout; retain public search. A local Map-only limiter is insufficient
across instances. Any limiter identifiers should be minimized app-owned operational
data with expiry, not retained raw query/IP histories. **Acceptance:** oversized/over-
budget requests are rejected before embedding work; ordinary public search still works.

### AUD-13 — P2: JSON-LD serialization allows a script closing tag

**Source verified, content-write prerequisite.** `src/lib/seo/json-ld.tsx:21` inserts
plain JSON.stringify output into a script tag. Article titles/summaries and category
labels come from stored CMS data, so a literal closing script tag is not escaped for
HTML parsing. The enforced CSP does not restrict scripts. This is a stored injection
sink if hostile text reaches a published CMS field; anonymous CMS write access was
not established. **Recommendation:** escape less-than characters during safe JSON-LD
serialization (or use a vetted serializer); do not assume JSON escaping is HTML safety.
**Acceptance:** malicious title/summary fixtures render only data and preserve valid
structured metadata. No data ownership or persistence change.

### AUD-14 — P2: exports can silently omit data and mix vehicles

**Source verified.** `src/app/api/vehicle/export/route.ts:35` ignores all three query
errors and serializes missing results as empty successful sections. Its vehicle filter
applies to trips/samples but not charging sessions. It also assumes a requested 10,000
row limit is honored by PostgREST and has no paging; a lower server cap can silently
truncate results without the flag. The current server cap was not measured.
**Recommendation:** handle query failures explicitly, resolve the chosen alias to its
car IDs, and page deterministically to an explicit export cap. **Acceptance:** a failed
section cannot produce a misleading successful backup, vehicle A excludes B's sessions,
and a mocked lower server page cap still yields complete/explicitly truncated output.
User-owned exported records remain in Postgres; no storage change.

### AUD-15 — P2: session-list projection drops manual/corrected/provider metadata

**Source verified.** `src/hooks/use-sessions-query.ts:17` omits `manual_entry`,
`energy_overridden`, correction timestamps, `user_provider_id` and end-delta fields
that `src/lib/db-map.ts:92` reads. Missing booleans become false and IDs become null.
The history list uses `manual_entry` for badges and messaging, so normal refetch loses
that distinction. Dashboard bootstrap already selects a richer set, creating inconsistent
views of the same session. **Recommendation:** use a shared, explicit mapper-complete
projection. **Acceptance:** production list fetch and dashboard bootstrap preserve
manual/corrected/provider/delta values identically. No ownership/storage change.

### AUD-16 — P2: retention-status API still advertises a 365-day Premium cutoff

**Source verified.** `src/app/api/vehicle/retention-status/route.ts:8` reports 365 days,
an oldest-kept date and next deletion date for Premium, whereas `supabase/TELEMETRY.md`,
`docs/PREMIUM_ADMIN.md` and `20260626130000_premium_admin_full_retention.sql` describe
indefinite retention while active. **Recommendation:** represent unbounded retention
explicitly in API/UI and reconcile its canonical documentation. Do not alter retention
jobs merely to fit the old constant. **Acceptance:** Premium has no invented cutoff;
free-tier cutoff remains accurate. User-owned records stay in Postgres.

### AUD-17 — P2: service reminders diverge from edited records

**Source verified.** `src/actions/service-records.ts:87` ignores reminder INSERT errors
and returns record success. `updateServiceRecord` updates next-due fields but never
updates/creates/removes the associated reminder. Users can see an old reminder after
changing its due date, or lose a requested reminder without any error. **Recommendation:**
transactional record/reminder synchronization, defining how completed/manual reminders
behave; an explicit retryable partial result is a less atomic alternative.
**Acceptance:** create failure is visible, due-date edits propagate, clearing due fields
removes/deactivates only the linked pending reminder. User-owned Postgres service data.

### AUD-18 — P1: webhook ACKs a failed durable event insert

**Source verified.** `scripts/telegram-miniapp-server.py:221` catches failure of
`upsert_telegram_group_event` and still returns HTTP 200. Telegram has no reason to retry
an acknowledged update; the pending-events recovery function cannot recover a row that
was never stored. The comment promising a later idempotent retry is insufficient.
**Recommendation:** return retryable failure when durable acceptance fails, and ACK
only after the event is persisted; keep downstream classification asynchronous.
**Acceptance:** injected storage failure produces retry and exactly one eventual event.
No webhook was called. Existing community-event ownership/storage remains unchanged.

### AUD-19 — P2: remote command dispatch has no atomic claim or sent recovery

**Source verified, gated feature.** `src/app/api/bydmate/commands/route.ts` SELECTs pending
rows and separately marks them sent, ignoring update errors and not selecting claimed
rows back. Concurrent polls can return the same command; a lost HTTP response leaves
a sent command excluded from future polling and from the pending-only timeout logic.
Commands are disabled by default; production enablement was not inspected.
**Recommendation:** transactional claim with lease/ack recovery and device-side command-ID
idempotency before enabling commands. **Acceptance:** simultaneous polls and dropped
responses neither duplicate physical actions nor strand commands forever. User-scoped
command state remains in Postgres; no device command was issued during this audit.

### AUD-20 — P1: push subscriptions allow arbitrary server-side HTTPS destinations

**Source verified, VAPID/runtime prerequisite.** `src/actions/push.ts:17` validates only
nonempty subscription strings and exposes authenticated test sending. `web-push.ts`
passes stored endpoints directly to the library; the installed library's
`web-push-lib.js:348` uses the endpoint host/port for https.request. There is no destination
restriction or send timeout in the caller. With valid generated subscription keys, this
provides an authenticated arbitrary HTTPS POST/availability-abuse path. Internal network
reachability was not tested and no request was sent. **Recommendation:** approved push-
service destination policy or robust public-destination egress validation, plus timeouts,
subscription quotas and send budgets. Validate at send time as direct DB writes also
exist. **Acceptance:** private/loopback/unapproved destinations cannot be contacted and
supported push providers still work. Subscription endpoints are user-owned Postgres data.

### AUD-21 — P1: read-only helper does not enforce its promise through the pooler

**Observed earlier in this same review thread.** `scripts/prod-psql-readonly.sh` sets
startup PGOPTIONS, but live queries returned both default_transaction_read_only and
transaction_read_only off; explicit `BEGIN READ ONLY` returned on. The helper's claim
that accidental writes fail is therefore unsafe on this connection path. All database
queries in the whole-project audit used explicit read-only transactions.
**Recommendation:** a genuinely read-only DB role/session connection or a helper that
establishes and verifies transaction-local read-only mode with a constrained interface;
never repair this using leaked session SET through the transaction pooler.
**Acceptance:** mode assertions pass on the actual target and a harmless forbidden-write
probe fails in a disposable context. App-owned tooling; no user data changes required.

### Previously tracked items and remaining validation

- The Vercel ignore-build defect remains in `scripts/vercel-ignore-build.mjs`: only
  HEAD's parent is compared, so a docs-only tip can suppress earlier app changes.
  Keep the existing dedicated backlog plan; do not duplicate it here.
- The three previously reported full-suite failures have not been rerun. The source
  still has the math expectation and runtime alias imports called out in the existing
  test-discovery follow-up. Do not label the current full suite green.
- Point 2's single-connection rollback test passed earlier in this thread. Actual
  simultaneous-connection contention and application deployment verification remain
  distinct outstanding checks. Its older backlog text saying the SQL test never ran
  is stale; see the later CHANGELOG entry for the verified result.
- The Python webhook also accepts requests when its secret is unset; this is a
  configuration-dependent fail-open risk. Production configuration was not inspected.
- The public-content route move to `/knowledge/*` is not reflected in the worker's
  `/telegram*` page-cache predicate. Offline navigation of the new URLs needs a focused
  browser check before treating it as a verified product regression.

### Recommended order and approval boundary

First AUD-01/02 (identity and entitlement), then AUD-03/04/05/06/20 (authorization,
privacy and destructive lifecycle), then AUD-07 through AUD-11 and AUD-18 (delivery
and state integrity), followed by the P2 correctness work. Each fix should keep its
own focused diff and verification. This audit authorizes recording findings only;
implementation and production rollout are not authorized by this entry. Data/storage
choices above are recommendations to confirm with each concrete implementation plan.

## Approved — charging replay, freshness, and atomic progression

Approved in conversation for review point 2. Preserve charging predicates; add distinct
measurement ordering, a three-minute start window and a 30-second future-clock tolerance.
Live SOC must have fresh measurement and receipt times (90 seconds). Keep TypeScript
decisions and commit sessions, counters and cursor atomically through a versioned RPC.
A tenant-scoped pending queue retains minimal charging inputs until commit, and ingest
returns retryable failure if charging processing fails. Snapshot-only pushes skip it.

Timestamp checks alone miss overlapping requests; a SQL-only reducer duplicates tested
logic. Prefer a short compare-and-commit transaction with bounded retries and recovery.
Charging facts remain user-owned in Postgres; queue/cursor/version are app-managed,
tenant-scoped operational state in Postgres. Pending inputs are deleted on commit. No
new GPS collection or preference storage; retain existing session-cardinality policy.
Verify duplicate, delayed, out-of-order, skewed-clock, concurrent and failed-commit cases.
Production migration application and deployment are separate from implementation.

Implementation status (2026-09-11): local implementation connected, not shipped.
The patch helper works again. The draft migration preserves Di+ gun state, the public
server entry point uses the atomic adapter, and the old processor is a compatibility
re-export. Charging failures now return HTTP 503 with `ok: false` / `retryable: true`.
Canonical charging and API documentation describe queue recovery and rollout ordering.

Verification this resume: 39 focused charging/processor/delivery tests pass; TypeScript
passes. Added explicit Di+ unplug and future-clock-boundary cases. Overlapping-worker
and failure-recovery tests use an in-memory store, not Postgres. The previous full-suite
result was 476 passes and three prior failures; the full suite was not rerun this resume.

Prepared `supabase/tests/charging_atomic_progression.sql` for an explicitly selected test
account, with rollback, duplicate/projection checks, version-conflict checks, session
start/stop, injected-operation failure and role privilege assertions. It has NOT run.
Actual Postgres transaction/permission checks and simultaneous-connection locking checks
remain outstanding. No database changes or deployment were performed.

Rollout: verify/apply the migration before deploying the RPC-dependent app; drain old
ingest requests during the switch because the old processor is not atomic. Database
verification/application and deployment require their separate authorized rollout.
Keep this plan here until shipped, then move the outcome to CHANGELOG.md.

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

## 🟠 Vercel ignore-build step skips app changes when several commits are pushed at once

### Evidence (2026-09-11)

One push carried `63fc474` (test runner, message helper), `ffb8750` (cadence-alarm route →
admins) and `d36ccf9` (migrations, tests, BACKLOG). Vercel made a single production
deployment, `dpl_A9ioNmuZZMFSBJRJS8rN39hbmtqX` for `d36ccf9`, and it is **CANCELED**.
Production still serves `067d0b8`: the pending `yuan up` alarm kept failing with the old
route's `missing_telegram_id` after the push.

**Cause:** `scripts/vercel-ignore-build.mjs` diffs `HEAD^..HEAD` only. Vercel builds just the
tip of a push, and here the tip touched only `supabase/` and `*.md` (all "non-app"), so the
step exited 0 ("ignore"). The app changes in the two earlier commits were never examined.
Any multi-commit push whose *last* commit is docs/migrations-only is silently dropped.

### Options

1. **Diff against the last successful deployment (recommended).** Vercel sets
   `VERCEL_GIT_PREVIOUS_SHA` to the SHA of the last successful deployment for the branch.
   Diff `${VERCEL_GIT_PREVIOUS_SHA}..HEAD` and fall back to `HEAD^` when it is unset. If that
   SHA is missing from Vercel's shallow clone, `git diff` throws and the existing `catch`
   already builds, which fails safe. A one-line change plus a focused test of the decision.
2. **Stop skipping builds entirely.** Simplest and never wrong, but migration- and doc-only
   pushes build again (cost only; the project is on Vercel Pro).
3. **Leave it, and push app commits last.** A process rule nobody will remember.

**Immediate recovery, whichever option:** make a build happen. Committing option 1 does that
by itself, because it touches `scripts/`, an app path. Otherwise push an empty commit (its
diff is empty, so the step builds) or redeploy `d36ccf9` from the dashboard.

**Data boundary:** none. Build tooling only.

## ✅ 19 server-only `SECURITY DEFINER` functions were callable with the public anon key (option 1 shipped 2026-09-11)

**Shipped (option 1):** migrations `20260911120000` (revoke from `anon, authenticated`) and
`20260911121000` (revoke from `PUBLIC`) are applied to prod. The second was needed because
`bydmate_apply_diplus_columns` and `bydmate_prune_telemetry_samples` still carried Postgres's
built-in EXECUTE-to-PUBLIC (`=X/postgres`). Verified: across the 20 overloads, `anon` and
`authenticated` can execute 0, while `postgres` and `service_role` keep all 20. Anon-key RPC
calls to `bydmate_prune_telemetry_samples` and `rdp_simplify_trip_track` return
`401 permission denied`, and `is_admin` still answers. Ingest is live via service role
(a sample landed 37 s after the revoke), and every pg_cron job succeeded afterwards.
Test: `supabase/tests/api-role-function-privileges.test.mjs`. Options 2 and 3 below remain
proposed.

### Evidence (read-only, prod, 2026-09-11)

Found while closing the same gap on the cadence detector. Supabase's default privileges
grant `EXECUTE` on every new `public` function to `anon` and `authenticated`
explicitly, and our migrations only `revoke … from public`, which does not remove those
grants. PostgREST exposes every function a role can execute as `/rest/v1/rpc/<name>`, and
the anon key ships in the PWA bundle. So these run **as their owner, bypassing RLS**, for
anyone on the internet. None of them checks the caller (no `auth.uid()` or role test):

| Function | What an anonymous caller can do |
|---|---|
| `bydmate_prune_telemetry_samples(p_keep_days)` | No lower bound. `p_keep_days => 0` deletes every rolled-up, non-charging raw sample for **all users**. |
| `bydmate_apply_diplus_columns(p_table regclass, p_where text, …)` | The caller picks the table, and `p_where` is concatenated raw into dynamic SQL: arbitrary `WHERE` (including subqueries) on an `UPDATE` run as owner. Mass-overwrites telemetry and is an injection primitive. |
| `bydmate_ingest_telemetry` ×2, `…_batch`, `bydmate_ingest_trip_summaries`, `bydmate_apply_client_trip`, `bydmate_apply_client_hourly`, `bydmate_apply_hourly_rollup_sample`, `bydmate_update_hourly_energy` | Take `p_user_id`: write forged telemetry, trips and energy into **any** user's account. |
| `bydmate_discard_trip_if_junk`, `bydmate_finalize_trip_energy`, `rdp_simplify_trip_track`, `simplify_aged_bydmate_trip_tracks` | Mutate or delete trips by id / in bulk. |
| `purge_old_bydmate_telemetry`, `purge_old_bydmate_aux_voltage_rollups`, `bydmate_enqueue_aux_voltage_backfill`, `bydmate_enqueue_aux_voltage_day`, `bydmate_materialize_aux_voltage_day`, `bydmate_process_aux_voltage_rollup_queue` | Trigger retention and rollup jobs on demand (heavy load; purges run early). |

Nothing exploited them as far as we know; this is exposure, not an incident. Not tested
against the live API, deliberately: the calls are destructive.

### Who legitimately calls them

- The ingest RPCs are called only from `src/app/api/bydmate/telemetry/route.ts` and
  `…/trip-summaries/route.ts`, both via `createServiceClient()` (service role). The Deno
  `bydmate-telemetry` edge function only forwards to that route and makes no RPC calls.
- The purge/rollup functions are called by pg_cron jobs, all running as `postgres`.
- Query over `pg_proc` (non-definer callers), `pg_policies` and `cron.job`: **no**
  user-triggered function, trigger or RLS policy calls any of the 19. No `anon` or
  `authenticated` caller exists, so revoking cannot break the app.

Leave alone: `is_admin` (used by RLS on the KB/CMS tables),
`increment_knowledge_article_view` (intentionally public, see AGENTS.md), and
`is_user_premium` (used by the `bydmate_phantom_drain_daily_rollups` policy and by
invoker functions `bydmate_soh_daily` / `bydmate_phantom_drain_daily`; it discloses only
whether a given user id is premium). `handle_new_user` and
`bydmate_queue_aux_voltage_chemistry_rebuild` return `trigger`, so PostgREST cannot call
them.

### Options

1. **Revoke `EXECUTE` from `anon, authenticated` on the 19 (recommended, now).** One
   idempotent migration. Callers are service role or `postgres`, so there is no app
   change. Verify with `has_function_privilege` and one anon-key RPC call expecting 401.
2. **Also stop it recurring:** `alter default privileges in schema public revoke execute
   on functions from anon, authenticated`, then grant explicitly to the few
   public-facing functions. That stops every *future* function from being born public,
   but a missed grant breaks a feature silently, so it needs a full RPC inventory first.
   Follow-up, not today.
3. **Fix `bydmate_apply_diplus_columns` itself:** replace the raw `p_where` with typed
   key parameters. Defense in depth even after 1; separate change.

**Data boundary:** no data model change. These are privileges on app-owned Postgres
functions.

## Proposed — failures exposed by complete test discovery

Review point 1 is implemented; see CHANGELOG.md (2026-09-11). The expanded Node 22 run
discovers 73 files and reports 456 passes and three failures in unchanged source/tests:

- `src/features/charging/_domain/charging-math.test.mjs:15` expects the full-precision
  result `41.943 / 0.92` to equal rounded `45.59` within `1e-9`.
- `src/lib/push/live-status-notifications.test.mjs` and
  `src/lib/voltflowmate/telemetry-history.test.mjs` cannot load because their source
  modules import the runtime alias `@/features/charging/domain`, unsupported by the
  plain Node test runner.

Recommendation: correct the arithmetic expectation against the documented grid-energy
formula and make the tested modules load through focused, relative imports. A general
alias loader is an alternative but adds test-only resolution machinery and can hide
production module-boundary issues. Trace transitive imports before changing them; do
not round production energy or skip suites to make the command pass. No user-facing
data ownership/storage changes. Acceptance: all discovered suites load and the full
command passes. This follow-up is proposed, not part of point 1's implemented scope.

## 🟡 Cadence-collapse alarm: the moving-gap rule fires on traffic stops, not collapses

### Evidence

On 2026-09-11 the owner of car `cl` got a Telegram alert: *"telemetry cadence collapsed for
cl. Moving samples were 27 seconds apart. Observed: 2026-09-11T05:32:50Z"*. Read-only
production checks show that telemetry was healthy the whole time:

- Samples arrived every ~1.2 s straight through the "gap". Between the two moving samples
  (05:32:23, 1 km/h and 05:32:50, 3 km/h) there are **21 samples at 0 km/h**. The car was
  stopped in traffic, and uploads kept landing in normal ~18 s driving batches.
- 05:00–05:40 UTC: 1,468 samples, 820 of them moving.

**Cause.** `bydmate_detect_telemetry_cadence_collapses()`
(migration `20260908130000`) compares only the **two latest samples with
`diplus_speed_kmh > 0`**, and so skips every stationary sample between them. Any stop
longer than 5 s reads as a 5+ s gap. It fires whenever a 10-minute run lands just after a
batch that ends right after a stop, like a red light, a queue or a parking manoeuvre.

**All 9 `moving_gap` alarms since install are false.** For each alarm, the largest gap
between *consecutive* samples (any speed) inside its window:

| Vehicle | Reported gap | Samples in between | Real max consecutive gap |
|---|---|---|---|
| BYD | 10.3 s | 8 | 1.2 s |
| z_byd | 10.1 s | 5 | 1.8 s |
| z_byd | 6.7 s | 4 | 1.4 s |
| Bulbazavr | 5.0 s | 3 | 1.3 s |
| yuan up | 29.7 s | 24 | 1.3 s |
| Bulbazavr | 5.3 s | 2 | 2.1 s |
| Yuan UP | 6.8 s | 5 | 1.2 s |
| BYE Yuan Up | 12.5 s | 9 | 1.4 s |
| cl | 27.2 s | 21 | 1.6 s |

Every one closed itself on the next run. The rule also has a **blind spot**: it inspects a
single pair per 10-minute run, so it missed both real mid-drive data holes in the same
period (below).

### Backtest of the replacement rule

Rule: *two **consecutive** samples, **both** moving, more than N s apart.* A traffic stop
then reads as ~1.2 s, because the stationary samples sit between the moving ones.
Starting from parked is excluded because the earlier sample is stationary. All samples,
2026-09-08 → 2026-09-11 (~3.5 days, 12 vehicles):

| Gap | Hits | What they are |
|---|---|---|
| 5–8 s | 4 | Jitter: 5.2–5.4 s at 1–8 km/h, and one 7.3 s at 95 km/h (`way`). Noise. |
| > 8 s | 2 | **Real holes:** `BYD Yuan Up` 18 → 72 km/h across **4 min 25 s** (2026-09-10 04:43, delivered 1.5 h late) and 18 → 55 km/h across **5 h 47 min** (2026-09-08 06:15, delivered 37 min late). |

Healthy driving never exceeded 7.3 s. The slowest cadence mode the sender can fall into
is the 10 s charging-bulk queue. So **8 s** sits above the noise and below every collapse
mode. On this data it trades 9 false alarms and 0 real ones for 0 false alarms and 2 real.

### Data boundary

No user-facing data model change. The alarm rows are **app-owned** operational monitoring
in **Postgres** (`bydmate_telemetry_cadence_alarm_audits`, service-role only). The table
shape stays as it is: `observed_at` / `previous_moving_at` / `gap_seconds` already fit a
consecutive pair. Only the detector function changes.

### Options

1. **Raise the threshold only (e.g. 30 s).** Rejected. A stop's length is arbitrary: red
   lights run 60–90 s, and two of the nine false alarms were already 27–30 s.
2. **Minimal patch: keep "one pair per run", but pair the latest moving sample with the
   sample immediately before it (any speed), require that one to be moving too, and raise
   N to 8 s.** This kills the false positives with a few-line diff. It keeps the blind
   spot, though, and would have missed both real holes.
3. **Scan every consecutive moving → moving pair delivered since the last run
   (recommended).** For each live vehicle, take moving samples whose `received_at` falls
   in the run window (~11 min, overlapping the 10-minute schedule; the open-alarm unique
   index already de-duplicates). Look up each one's immediately preceding sample and open
   an alarm on the largest gap over 8 s. The window is keyed on `received_at`, so a late
   batch is judged when it arrives. That is how both real holes landed, 37 min and 1.5 h
   late.
   *Cost:* candidates come from the existing partial index
   `bydmate_telemetry_samples_moving_time_idx` (`device_time` bounded to 24 h, index-only,
   which the index's `INCLUDE (received_at, diplus_speed_kmh)` already covers). Each
   predecessor is one probe on the `(user_id, vehicle_id, device_time)` unique index. That
   is no heavier than the 24 h count the detector already does every run.
   *Resolve rule:* close an open `moving_gap` alarm when a run sees moving samples in its
   window and none of them qualify.
4. **Drop the `moving_gap` signal and keep only the 24 h floor.** Rejected. It loses
   mid-drive holes entirely; the floor only catches a car that goes quiet for a whole day.

### Scope of the change (option 3)

- New migration `create or replace function public.bydmate_detect_telemetry_cadence_collapses()`.
  Never edit `20260908130000`, which is already applied. Keep it idempotent and apply
  with `psql` per `docs/OPS_LOCAL.md`.
- Update `supabase/tests/telemetry-cadence-collapse-alarm.test.mjs`. It pins
  `moving_gap_seconds > 5` from the old file, so point it at the new migration and assert
  the consecutive-pair rule and the 8 s threshold.
- Optional, small: have `src/app/api/cron/telemetry-cadence-alarm/route.ts` format large
  gaps readably ("4 min 25 s", "5 h 47 min") instead of "20838 seconds". A real hole can
  now be hours long.

**Status:** the detector rule shipped to prod 2026-09-11 (migration `20260911100000`; the
07:13 UTC run took 3 s and opened no alarms).

### Delivery: operator-only (chosen 2026-09-11)

The alarm's audience was wrong. An owner can't act on "telemetry cadence collapsed"
(jargon, and a sender bug they can't fix), and 13 of the 14 alarms since install were
undeliverable because those owners never linked Telegram. The only one delivered was a false
alarm. The people who *can* act are the operators, who fix sender bugs in code. Options
considered: (1) send to admins only, (2) audit table only with no Telegram, (3) remove the
alarm, (4) leave it on owners. **Chosen: 1.**

- **Recipients:** every `admin_users` member with a linked `profiles.telegram_id` (2 of 2
  today). The owner is no longer messaged.
- **Message:** names the owner (`profiles.email`) and vehicle, and the gap window
  (`previous_moving_at` → `observed_at`), because an admin sees every user's alarms.
- **Delivered** when at least one admin received it. With no reachable admin, record
  `delivery_error = 'no_admin_telegram'`. This also ends the undeliverable-retry churn
  (each open alarm re-called Vercel every 10 minutes forever): an admin is always reachable.
- **Data boundary:** no user-facing data model change. Alarm rows and the admin list are
  **app-owned**, in **Postgres**. The change is route-only (no migration); the detector
  already hands each alarm to the route by id.

### Closed 2026-09-11: detector was callable by `anon` / `authenticated`

The Sep 8 migration's `revoke all … from public` did not remove Supabase's explicit
default `EXECUTE` grants to `anon` and `authenticated`, so anyone with the public anon key
could run the `SECURITY DEFINER` detector through the PostgREST RPC. Migration
`20260911110000` revokes them. It is applied to prod; the remaining grantees are
`postgres` (pg_cron) and `service_role`. Verified from outside: an anon-key
`POST /rest/v1/rpc/bydmate_detect_telemetry_cadence_collapses` now returns
`401 permission denied`. The same gap exists on 19 other functions; see the 🔴 entry at
the top.

### Verification

`node --test supabase/tests/telemetry-cadence-collapse-alarm.test.mjs`, `npm run test`,
and `npm run build` if the route changes. After applying: run the detector once by hand,
check its JSON result, and re-run the backtest query above. It should reproduce the two
real holes and none of the nine stop-bridged pairs.

## 🔵 Knowledge-base import from an external parser (JSON in → draft articles)

### Goal

An external parser (currently DRIVE2 posts, see `research/article_parsed.json`) produces
JSON per article. VoltFlow ingests it as `knowledge_articles` rows that are visible to
semantic search, land as **drafts**, and are reviewed in `/admin/knowledge` before
publication.

### Evidence — what the current code requires

- `validateArticle` (`src/actions/knowledge-admin.ts:542`) is the real gate:
  `title`, `slug`, `category_id`, non-empty `content`, non-empty `model_generations`,
  a valid `status`, and a slug unique in `knowledge_articles`.
- `slugify` (`knowledge-admin.ts:705`) strips everything outside `a-z0-9`, so a Cyrillic
  title yields an **empty** slug and fails validation. The parser must send a latin slug.
- A plain SQL insert is not enough: semantic search reads `knowledge_items`, whose
  1536-dim embedding is built in app code by `upsertArticleKnowledgeItem`
  (`src/lib/supabase/knowledge.ts:680`). There is no DB trigger. This is the same reason
  `scripts/seed-knowledge-articles.mjs` exists rather than a migration.
- `summary`, section `heading`/`body`, and section image `alt` all feed the embedding
  text — empty alts mean the photos contribute nothing to retrieval.
- `createArticle` (`knowledge.ts:241`) uses the **user-scoped** client and relies on the
  admin RLS policy, so it cannot serve a machine caller as-is; a machine path needs
  `getSupabaseAdmin()` plus its own auth, the way
  `src/app/api/admin/knowledge/reindex/route.ts` separates `requireAdmin` from the
  service-role work.

### Images — hotlink vs rehost (measured, 2026-09-08)

- Every knowledge-base `<Image>` passes `unoptimized` (`ArticleRenderer.tsx:130,152,187`;
  also `ArticleCard`, `SparePartsCatalog`, the spare-part and accessory pages). With
  `unoptimized`, `generateImgAttrs` returns early
  (`node_modules/next/dist/shared/lib/get-img-props.js:96-113`) and never calls the
  loader, so the `remotePatterns` check at `image-loader.js:96` never runs. **External
  image URLs render today with no `next.config.ts` change.**
- `https://a1.drive-data.ru/...jpg` returns `206 image/jpeg` with no Referer and with a
  `voltflow.life` Referer — no hotlink protection at present.
- Costs of hotlinking: silent link rot (no `onError` handler anywhere in
  `ArticleRenderer` — a deleted photo renders a broken-image icon in a published
  article); the CDN can add Referer checking at any time and break every imported article
  at once; `public/sw.js:56` skips cross-origin, so hotlinked photos are never cached for
  the PWA / Mini App; each viewer's IP and Referer leak to drive-data.ru.
- Copyright cuts the other way: rehosting copies and redistributes someone else's photos,
  hotlinking does not. `source_label` + `source_url` carry attribution either way.

**Recommendation: link-first, rehost on promotion.** Import with original URLs, and
rehost only articles kept published long-term. Each image object carries `origin_url` and
`hosted` so a later rehost is mechanical. `parseImages` (`knowledge.ts:977`) strips
everything but `url`/`alt` for the UI, so the extra keys are inert in the app while
Postgres preserves them in the `jsonb` column for the rehost script to read.

### Data ownership and location — confirmation required before building

- **App-owned editorial content, not user data.** Imported articles are VoltFlow's public
  knowledge base, authored/curated by admins; no `auth.uid()` scoping applies.
- **Lives in Postgres** (`knowledge_articles` + the derived `knowledge_items` search row),
  which is where the knowledge base already lives. Nothing goes to localStorage.
- Images stay at the origin CDN on import; only promoted articles move into the existing
  `knowledge-articles` Supabase storage bucket.

### Options and trade-offs

**A. HTTP push endpoint — `POST /api/knowledge/import` (recommended).**
Shared-secret header (`x-import-key`, hashed the way `voltflowmate/api-auth.ts` handles
Mate keys), service-role writes, accepts one article or a batch, returns per-article
results. Matches "the parser sends us JSON" literally: the parser fires and forgets, no
machine access to the repo or the DB. Costs: a new public attack surface that must be
rate-limited and secret-gated, and a Vercel function that calls OpenAI for embeddings
(seconds per article — batch size must be capped).

**B. CLI script — `scripts/import-knowledge-articles.mjs <file.json>`.**
Mirrors `seed-knowledge-articles.mjs`; the parser drops JSON files somewhere and a human
runs the import. No new attack surface, trivially auditable, easy dry-run. Costs: manual
step, no automation, only works from a machine holding `SUPABASE_SERVICE_ROLE_KEY` and
`OPENAI_API_KEY`.

**C. Admin UI upload — paste/upload JSON in `/admin/knowledge`.**
Reuses `requireAdmin` and the existing forms, gives a preview before writing. Costs: the
most UI work; still manual; awkward for batches.

**Recommendation: build B first, then A on top of the same core.** Extract one
`importKnowledgeArticles(payload)` module used by both, so the endpoint is a thin
authenticated wrapper. B proves the mapping and the embedding path against real parser
output with zero exposure; A is a small addition once the shape is stable.

### Contract — the JSON the parser sends

```json
{
  "source": "drive2",
  "articles": [
    {
      "slug": "side-trim-matte-black-film",
      "title": "Закрыл пленкой боковой китайский орнамент",
      "summary": "Матовая черная пленка на боковых вставках нижнего пластика.",
      "category": "ownership",
      "model_generations": ["gen1_2024", "gen2_2025"],
      "status": "draft",
      "tags": ["тюнинг", "пленка", "салон"],
      "source_label": "DRIVE2",
      "source_url": "https://www.drive2.ru/l/...",
      "images": [],
      "content": [
        {
          "heading": "Как затягивал вставки",
          "body": "…",
          "images": [
            {
              "url": "https://a1.drive-data.ru/hNtEbIuvXvPIJ9PxLIskirldadc-960.jpg",
              "alt": "Боковая вставка, оклеенная матовой черной пленкой",
              "origin_url": "https://a1.drive-data.ru/hNtEbIuvXvPIJ9PxLIskirldadc-960.jpg",
              "hosted": false
            }
          ]
        }
      ],
      "tips": ["Пленка заказывалась на Ozon: ozon.kz/t/TORTFDT"],
      "warnings": ["Требуется полный демонтаж нижнего пластика."]
    }
  ]
}
```

Rules: `category` is a **slug** resolved against `knowledge_categories`
(`charging, ownership, maintenance, accessories, calculators, battery, winter, safety,
costs, byd-yuan-up`) — an unknown slug rejects the article rather than guessing.
`slug` must be latin and is the idempotency key. `status` is forced to `draft` on import
regardless of what the parser sends; publication is a human decision in `/admin/knowledge`.
A block with empty `heading`, empty `body`, and no images is dropped (`parseSections`).

### Implementation phases after approval

1. `src/lib/knowledge/import-article.ts` — zod schema (zod 4 is already a dependency)
   mirroring `validateArticle`, plus `toArticleInput()` mapping the payload onto
   `ArticleInput`. Pure module, unit-tested with `.test.mjs` alongside it.
2. `importKnowledgeArticles()` — resolve category slug → id, upsert by slug via
   `getSupabaseAdmin()`, then run the embedding upsert (the `upsertArticleKnowledgeItem`
   path) so the article is searchable. Per-article results: `created` / `updated` /
   `skipped` / `error` with a reason.
3. `scripts/import-knowledge-articles.mjs` — `--dry-run` default-on reporting, `--file`,
   loads env the way `seed-knowledge-articles.mjs` does.
4. `POST /api/knowledge/import` — shared-secret auth, batch cap, rate limit, returns the
   same per-article result array.
5. Hardening for link-first images: `onError` fallback in `ArticleRenderer` so a dead
   hotlink degrades to a placeholder instead of a broken icon, plus a link-check script
   that reports rotted URLs.
6. Optional later: `scripts/rehost-knowledge-images.mjs` — download `origin_url`, upload
   to the `knowledge-articles` bucket, rewrite `url`, set `hosted: true`.

### Verification

- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/knowledge/import-article.test.mjs`
- `npm run test`, `npm run lint`, `npm run build`
- Dry-run the script against `research/article_parsed.json` mapped to the contract above,
  then a real import of one article, then `npm run search:eval` to confirm retrieval did
  not regress.

### Acceptance criteria

- A parser payload imports as a **draft** article that is retrievable by semantic search
  (a `knowledge_items` row with an embedding exists).
- Re-importing the same payload updates the same row and creates no duplicate.
- An unknown category slug, an empty/non-latin slug, or empty content rejects **that
  article** with a reason and does not abort the batch.
- No `next.config.ts` image change is required for hotlinked photos to render.

## ✅ A power-less telemetry sample must not reset the zero-power stall (approved 2026-08-28)

### Evidence

Car `way`, session `3ea4c611-131f-4084-a02a-3619885ac399`: charge finished, gun left in,
and the session was still `charging` at 99.8% more than an hour later. Read-only
production checks found three layered causes:

1. **A 2h20m ingest blackout hid the end of the charge.** Samples stop at 09:20 UTC
   (SOC 82%) and resume at 11:40 UTC (SOC 99.9%); `autoservice_bms_state` went `1` →
   `15` (charge complete) across the gap. Auto-stop had nothing to evaluate.
2. **The keep-alive predicate correctly held the session open.** Resumed samples read
   `charge_power_kw = 0`, `charge_gun_state = 2` (plugged), `is_charging = true`,
   `speed_kmh = 0` — parked, not explicitly unplugged, `is_charging` true, so
   `isMateAutoSessionChargingSustained` returns true. Working as designed: Di+
   `is_charging` means *gun connected*, not *energy flowing*.
3. **The 5-minute zero-power stall — the guard built for exactly this case — could never
   converge.** Two senders push with different payload shapes:

   | Sender | `telemetry` keys | `charge_power_kw` |
   |---|---|---|
   | `CloudTelemetrySender` (app) | 17 / 19 | `0` present |
   | `CommandDaemon` (car-off) | **14** | **absent** |

   The 14-key daemon payload omits `charge_power_kw` and `power_kw` but still sends
   `is_charging: true`. In `nextAutoChargingSessionStep`, `isExplicitZeroPower` requires
   `rawChargePowerKw != null`, so every daemon sample sets `zeroPowerSinceDeviceTime =
   null` and restarts the 5-minute clock. Measured clean zero-power windows after 11:44
   UTC: 1m49s, 4m00s, 1m00s, 3m00s — longest run **4 minutes** against a **5-minute**
   threshold. It can never fire. The frozen-reading check is blocked identically
   (`readingUnchanged` also requires `rawChargePowerKw != null`).

Secondary display effect: the CHARGER tile read `~ 3.9 kW` on a car drawing nothing.
`resolveChargingEtaPowerKw` finds no positive live power and falls back to the session
average (20.295 kWh ÷ 5.2 h = 3.90 kW). The energy figure itself is correct
(55.7 → 99.8% × 45.1 kWh ÷ 0.98 = 20.29 kWh).

### Data boundary

No user-facing data model change. No new column, no migration: the state column
`zero_power_since_device_time` already exists (migration `20260826120000`). This is a
pure change to how an **app-owned** server-side reducer interprets an absent field, and
the data stays in **Postgres** where it already lives.

### Options and recommendation

1. **Make the daemon payload include `charge_power_kw`.** Fixes it at the source, but
   the Mate app (Kotlin) is not in this repo and it needs a car-side release plus
   install. It also leaves the server trusting that every present and future sender
   populates the field — the exact assumption that broke here. Worth doing eventually,
   not sufficient alone.
2. **Shorten `AUTO_CHARGING_ZERO_POWER_STALL_MS` below the daemon's cadence.** Rejected:
   it races an interval we do not control, and a shorter stall is what previously ended
   real charges on a momentary zero reading.
3. **Treat an absent `charge_power_kw` as neutral rather than as a reset (recommended,
   approved).** A sample with no power field is *no measurement*, not a measurement of
   flowing power — it should carry the existing zero-power run forward instead of
   clearing it. The run still only ever *starts* on an explicit zero, so the AGENTS.md
   invariant holds unchanged: firmware that never reports `charge_power_kw` still never
   accumulates a run and can never be stopped by this path. Three-state, not two:
   explicit zero starts/extends the run, real power clears it, absent carries it.

Leave the frozen-reading check as it is. Its job is a stuck *nonzero* reading, and
loosening its null handling would risk stopping sessions on never-report firmware; the
zero-power stall converging is what closes the observed case.

The 2h20m ingest blackout is a separate problem and is **not** in scope here.

### Verification

Extend `src/features/charging/_server/auto-session.test.mjs` with the production
interleave — explicit zeros punctuated by power-less daemon samples — and assert the
session stops at the 5-minute mark; keep a case asserting a never-reports-power stream
never stops. Run the auto-session suite (excluded from the `npm run test` glob), the
full `npm run test`, and `npm run build`. Then confirm against production that the open
session closes with `stopped_at` set and `current_percent` at the live SOC.

## ✅ Restore live SOC after the Di+ 0.5.2 update (approved 2026-08-14)

### Evidence

Read-only production checks for `way` found that the fresh Mate 0.5.2 live snapshot and
all 25 durable samples in its surrounding ten-minute window omit `telemetry.soc`,
`diplus.soc`, reported range, and live-trip consumption. The Vehicle page renders both
AI Range and Math Range as `—` by design when `telemetry.soc` is absent. The VoltFlow
ingest has not dropped the field: it was absent on arrival. Mate's `DiParsClient` still
maps SOC only from the Di+ `电量百分比` request, while the updated Di+ installation
returns the other requested diagnostics but not that mapping.

### Data boundary

No user-facing model or storage change. This continues to send the existing
**user-owned** live SOC telemetry to its existing **Postgres** storage; no value is
persisted locally as a fallback and no stale cloud value is re-labelled as live.

### Options and recommendation

1. **Display the previous cloud SOC in the PWA.** Rejected: it would be stale while
   appearing live and would violate live-SOC priority for charging and range.
2. **Guess a replacement Di+ parameter label.** Deferred: no connected head unit is
   available to verify the new Di+ response, so a guessed label would be another
   version-specific breakage.
3. **Use the existing validated autoservice SOC FID only when Di+ SOC is missing
   (recommended, approved).** Keep Di+ as the preferred source. The app sender reads a
   current autoservice battery snapshot while Di+ SOC is absent and emits its validated,
   integer-rounded SOC; the independent car-off daemon applies the same fallback before
   building its payload. This is read-only vehicle state already used by Mate and keeps
   both sender paths consistent. Add focused payload/selection tests. No migration or
   VoltFlow UI change is required.

### Verification

Run the focused Android unit tests covering source selection and cloud payload SOC, then
build the debug APK. A connected-car verification remains required after installation:
confirm fresh `bydmate_live_snapshots` and `bydmate_telemetry_samples` contain
`telemetry.soc`, then refresh the Vehicle page and confirm both range cards render.

## 🔵 Consumption formula map — reference for the parts left as separate tools

The "average consumption" discrepancy investigation (shipped 2026-08-04, see
CHANGELOG.md) found 8 distinct kWh/100km formulas across the app. Two were genuine
duplicate re-derivations of the same math and have been consolidated (see CHANGELOG).
The rest are **intentionally different tools**, kept here as a map so a future "why does
X disagree with Y" doesn't have to be re-researched from scratch.

### Research — every distinct formula found (8, feeding 15+ display sites)

**A. Per-trip, net of regen** — `(traction_kwh − regen_kwh) / distance_km × 100`.
Canonical home: `src/lib/bydmate/trip-metrics.ts` (`tripTractionEnergyKwh()`,
`tripNetConsumptionKwh100()`, `tripEnergyPerKm()`).
- `tripNetConsumptionKwh100()` → History → Trips tab (`history-view.tsx:147-149,799`,
  label `vehicle.trips.netConsumption`) and Vehicle Live trip list
  (`vehicle-live-view.tsx:1306-1308,1316`, same label).
- `tripEnergyPerKm()` — gross kWh/**km** (not /100), same two files, label
  `vehicle.trips.energyPerKm`.
- ~~`range-estimate.ts` `averageEnergyConsumption()` re-derived the same net formula
  inline~~ — **consolidated 2026-08-04**, now calls `tripNetConsumptionKwh100()`.
- ~~`history-day-summary.ts` `tripDriveKwh()` re-derived the same gross-traction
  fallback~~ — **consolidated 2026-08-04**, now calls `tripTractionEnergyKwh()`.

**B. Device-reported `avg_consumption_kwh_100km` field, distance-weighted average** —
was 5 independent implementations with 3 different filters; **consolidated 2026-08-07**
into `trip-metrics.ts` `weightedAvgConsumptionKwh100()` (see CHANGELOG). Display sites,
all now on the one helper:
- Analytics day view "Day average" + baseline/regen-compare cards (`day-insights.ts`
  re-exports the helper; `analytics-day-view.tsx`).
- Analytics summary stat tile (`vehicle-analytics.ts` `fetchMonthlyStats()` →
  `telemetry-analytics-charts.tsx`).
- Vehicle Analytics summary panels (`telemetry-buckets.ts` `buildAnalyticsSummary()` →
  `vehicle-analytics-panels.tsx`).
- Efficiency bar chart + period-average dashed line (`telemetry-analytics-charts.tsx`
  `buildBarCharts()`, grouped per bucket).
- Vehicle Live SummaryPill (label `vehicle.trips.consumption`) and the range/ETA blend —
  `range-estimate.ts` `averageTripConsumption()` deleted, including its unweighted-mean
  fallback.

**C. Device-reported field, median** (baseline/fallback pools)
- `src/lib/vehicle-analytics.ts:469-513` `fetchConsumptionBaseline()` (30-day rolling) →
  "X% better/worse than your 30-day median" (`analytics-day-view.tsx:126-130,286`).
- `range-estimate.ts:40` `userMedianConsumption()` → range-estimate fallback pool.

**D. Device-reported field, unweighted average per bucket**
- `telemetry-buckets.ts:266-291` `consumptionByOutsideTemp()` → temp-vs-consumption chart
  (`vehicle-analytics-panels.tsx:477`).
- `src/lib/bydmate/route-insights.ts:526-572` per-route median/min/max → route prediction
  card (`route-insights-section.tsx:244,254-262`).

**E. Net-of-regen total-over-total (day/period)**:
- `src/lib/history-day-summary.ts` `avgConsumptionKwh100 = (driveKwh − regenKwh) /
  distanceKm × 100`, where `driveKwh` sums `tripTractionEnergyKwh()` per trip (group A's
  canonical helper) → `HistoryDaySummaryCard`, all scopes (day/week/month/quarter/year).
  Matches group A's net-of-regen semantic by decision (2026-08-04); the card's "On trips"
  cell intentionally stays gross traction (it feeds the charge/drive balance math), so
  avg-consumption × distance will not exactly equal "On trips" kWh — accepted trade-off.

**F. Raw device/live field, no averaging** — displayed as-is:
- `dashboard-view.tsx:217-220` `drivingStatsFromLive()`, `dashboard-deferred-summaries.tsx:108`,
  `vehicle-live-view.tsx:949` — each reads `current_trip_consumption_kwh_100km` or
  `trip.avg_consumption_kwh_100km` directly.

**G. Blended forecast** (range/ETA — legitimately its own thing, not "a consumption
display"): `range-estimate.ts:67-225` `estimateVehicleRangeKm()` weights B, F, and an
A-variant together, clamped 8–42 kWh/100km, to project range. Out of scope for
consolidation — it's a forecast, not a reported stat.

### Why B/C/D/F/G stay separate (deliberate, not drift)

Aggregation strategy varies **on purpose**: weighted-by-distance average of device values
(B) vs. median (C, deliberately outlier-resistant for baselines) vs. net total-over-total
(E, deliberately exact for a day/period) vs. raw instantaneous (F, deliberately "right
now") vs. a multi-signal blend (G, a forecast, not a reported stat). Collapsing these into
one aggregation would likely make at least one of {30-day baseline, live tile, day
summary, range forecast} worse at its actual job — so only the genuine duplicates (group
A's re-derivations) were consolidated; see CHANGELOG.md 2026-08-04.

**Amended 2026-08-07:** that reasoning is sound *between* groups but was wrongly applied
*within* group B, which was five copies of a single formula disagreeing on filters, not
five different tools — consolidated, see CHANGELOG.md 2026-08-07. The one consumption
question still open is deliberate and unbuilt: **which basis is "the" user-facing average**
— net-of-regen measured energy (A) or the device's own field (B). They differ for the same
trip, so History → Trips and the Vehicle Live pill still disagree by design. Switching
would move the headline number on four pages and invalidate the stored 30-day baseline's
comparability, so it needs an explicit decision rather than a refactor.

---

## 🔵 Suspended head unit: "app is offline" while Di+ keeps recording

### Goal

A parked or locked car must keep reporting often enough that the PWA can tell **"car
asleep"** from **"no contact"**. Today the reporting cadence on a suspended head unit
collapses to **one sample per ~15 minutes**, which the PWA's 90 s freshness threshold
reads as stale ~94% of the time.

Reported by user `kevlar_5@meta.ua` (2026-08-03), who correctly noted that **Di+ keeps
writing video** through the whole outage — Di+ is BYD's own privileged app and is exempt
from the head unit's power management; VoltFlow Mate is not.

### Research findings — prod DB, read-only (2026-08-03)

All times Europe/Minsk (the reporter's profile TZ). Evidence from
`bydmate_telemetry_samples` on self-hosted prod.

**3 August — matches the report exactly**

| Time | Observed |
| --- | --- |
| …–16:20:14 | Healthy: 1 Hz sampling, batches of ~14 delivered every ~17 s |
| 16:22:44 | +150 s |
| 16:30:44 | +480 s |
| 16:45:44 / 17:00:44 / 17:16:48 / 17:31:48 | **+900 s each** — one single sample per 15 min |
| 17:38 (his check) | Newest data 17:31:48 = **6+ min old** → past 90 s → shown stale |
| 17:55:28 | App wakes, dumps backlog whose oldest sample is 16:20:14 — **5714 s (95 min)** delivery lag |

**1 August — also matches, to the minute.** Last dense sample 13:03:29, then singles at
13:13:02 → 13:28:02 → 13:43:05 → 13:58:09 → 14:13:09 → **14:28:12**, then nothing until
15:00:57. His *"прога связывалась с авто до 14.30"* is literally the daemon's last 15-min
wake-up at 14:28:12.

**The 900 s interval matches no constant in the code.** `MAX_BACKOFF_MS` 30 s,
`PARKED_CLOUD_HEARTBEAT_MS` 30 s, `TELEMETRY_PUSH_MS` 60 s, daemon loop 6 s. It is imposed
from outside the app by platform suspend.

**Two distinct device-side defects, one per sender** (the "two senders" rule in
[AGENTS.md](AGENTS.md) applies — a fix in one is not a fix):

1. **`CommandDaemon` (car off) holds no wakelock at all.** A plain `Thread.sleep` loop in a
   shell-uid process; when the head unit suspends it only advances during the platform's own
   wake windows. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is declared in the manifest but
   covers only the app process, not the shell daemon.
2. **`TrackingService` (app path) has a self-deadlocking wakelock.**
   `WAKE_LOCK_DURATION_MS` is 30 min but `renewWakeLockIfNeeded()` is called *only from
   inside the polling loop* (`TrackingService.kt:908,969`). Once the loop is starved past
   30 min the lock expires and can never renew itself — which is why the 3 Aug stall ran
   95 min.

This extends the existing rule in AGENTS.md ("the daemon's loop period — not its push
interval — is the floor on its latency"): **on a suspended head unit the platform's wake
period is the floor, and the loop period is irrelevant.**

**Fleet-wide, not user-specific.** Share of long gaps landing at exactly 14–16 min over
7 days: barbaly3615 **80.4%**, philon96 **83.4%**, alexavr69 **85.9%**, scroodgemac 29.4%,
kevlar_5 **39.5%**. Worst per-user delivery lag runs 8 h to **42 h**. The 15-min phase is
spread across `minute % 15` fleet-wide — each device runs its own idle timer, so this is
per-device suspend, not coalesced alarms or anything server-side.

**Confirmed working, do not touch:** `bydmate_prevent_stale_live_snapshot_update`
correctly rejected the 95-min-old backlog (`if new.device_time < old.device_time then
return old`), so the live snapshot was never rewritten backwards. `isFreshLiveSnapshot`
keys off `received_at` and was accurate — the data really was stale.

### Repo boundary

Items 1–2 land in **`BYDMate-own`** (Android/Kotlin). Item 3 lands in **this repo**. They
ship independently; item 3 is worth doing regardless, because no cadence fix makes a
sleeping car report continuously.

### Options and trade-offs

**A — Device settings only (no code).** Have users exempt Mate from battery optimization /
enable autostart on the head unit.
*Pro:* zero code, testable today, likely fixes the app path immediately.
*Con:* per-user manual step, silently regresses on reinstall or OS update, does nothing for
the shell-uid daemon, and cannot be verified remotely. Not a fix — a workaround.

**B — Fix both senders' wake handling (recommended).**
Give `CommandDaemon` a wakelock (or drive it from `setExactAndAllowWhileIdle` rather than
`Thread.sleep`), and renew the `TrackingService` wakelock from an independent timer that
cannot be starved by the loop it is protecting.
*Pro:* addresses both root causes; restores the *intended* 30–60 s parked cadence.
*Con:* touches the hardest-to-test code in the project; exact-alarm rate limits mean the
daemon may still not reach 60 s on every OEM. Battery cost on a car-off head unit needs
measuring, not assuming.

**C — UI honesty only.** Leave cadence alone; replace the binary stale badge with a
"last contact HH:MM" and an explicit asleep state.
*Pro:* small, entirely in this repo, removes the false "broken" impression.
*Con:* the car still is not reporting — comfort controls and auto-stop stay degraded.

### Recommendation

**B + C together, in that priority order.** B removes the cause; C makes the remaining,
legitimate sleep windows legible instead of alarming. A is worth telling the reporter
*today* as an interim step while B is built, but must not be recorded as the resolution.

Do not raise `LIVE_SNAPSHOT_STALE_MS` to paper over this — it would mask a real 15-min
outage and weaken every freshness guarantee that depends on it (charging priority rules
in `docs/CHARGING_SESSIONS.md` use the same 90 s notion of fresh).

### Data ownership and location

No new user-facing data model, no new preference, no schema change. Item 3 is a pure
presentation change over the existing `bydmate_live_snapshots.received_at`. Items 1–2 are
device-side runtime behavior only. **Nothing to confirm on ownership/location.**

### Implementation phases after approval

1. **Instrument first.** Per the AGENTS.md rule about fire-and-forget paths, log daemon
   wake-ups and wakelock acquire/renew/expire before changing behavior — otherwise "it
   still stalls" is unattributable.
2. `CommandDaemon` wakelock / alarm-driven wake. Keep the decision logic in the pure
   `internal` functions (`planPush`, `loopSleepMs`) covered by `CommandDaemonTest`.
3. `TrackingService` independent wakelock renewal.
4. PWA: asleep-vs-offline state + "last contact HH:MM".

### Acceptance criteria

- On a locked car, ≥95% of consecutive `device_time` gaps are ≤90 s over a 2 h parked
  window (currently ~900 s).
- No sample delivered with `received_at - device_time > 5 min` in normal operation.
- Fleet 14–16 min gap share drops below 5% for users on the fixed build.
- PWA never labels a car "offline" when a sample arrived within the last 15 min.

### Side finding — separate issue, needs its own check

The sparse daemon samples carry `is_charging: true` with `charge_power_kw: null` and
`diplus_charge_gun_state = 1`. Per AGENTS.md, gun state `1` is **unplugged** and the
`is_charging` fallback is invalid there. Reduced DiPars payloads on the daemon path may be
feeding a false charging state into `processBydmateAutoChargingSessions`. Not part of this
plan — flagged so it is not lost.

---

## Advanced admin workspace: activation, retention, and audit history

### Goal

Extend the shipped KPI and needs-attention workspace with evidence of whether signup becomes
lasting Mate usage and accountability for privileged admin changes.

### Phases

1. **Activation and retention.** Show `registered → car linked → first telemetry → active
   after 7 days`, weekly/monthly active telemetry users, and signup-cohort retention.
   Use app-owned Postgres aggregates for efficient historical reads.
2. **Admin audit log.** Record premium/admin-role changes, acting admin, affected account,
   timestamp, prior/new values, and an optional reason.

### Data ownership and location — confirmation required before implementation

The audit log is **app-owned operational data in Postgres**, not user preference
data and not `localStorage`. It retains administrative history, so its retention policy,
visible fields, and access scope must be confirmed before building. Activation/retention derives
their results from existing user, car, snapshot, telemetry, release, and entitlement facts.

### Recommendation

Build activation/retention only if the funnel will drive concrete product decisions. Plan
the audit log separately with explicit retention and visibility decisions. Keep host and
Supabase infrastructure health in Grafana rather than duplicating it in the application.

---

## 🔵 Telemetry efficiency and reliable trip-finalization roadmap

### Goal

Make the car-to-cloud path cheaper without weakening the Telegram widget, PWA live view,
trip history, charging correctness, or the car-off case. The key change is a versioned
event contract: the Mate prepares compact physical segments and durable end events; the
cloud validates them and remains the canonical owner of user-visible history.

### Status refresh (2026-07-21) — code-verified

Owner restated the two objectives: (1) car status reaches **every** surface — PWA, web,
Telegram Mini App, Telegram widget — almost immediately; (2) a fast, reliable tiered
transfer schema where urgent/live data goes immediately and the rest is delayed.

**Objective 1 is shipped except for one surface.** Viewer-gated fast mode is live and
measured (see [CHANGELOG.md](CHANGELOG.md) → "Viewer-gated fast live status"):

| Surface | Fast mode? | Latency today |
| --- | --- | --- |
| PWA / web | yes — `MobileShell.tsx:37-48` heartbeat | live snapshot 5-9 s (app path) |
| Telegram Mini App | yes — renders the same `MobileShell` | same as PWA |
| Car-off daemon path | yes | ~3 s push cadence |
| **Telegram widget (bot message)** | **no** | **30-90 s** |
| Web-push live status | no gate | ingest-cadence bound |

The widget is the gap: `THROTTLE_MS = 30_000` (`src/lib/telegram/live-widget.ts:10`) is a
hard floor, and nothing grants fast mode when the app is closed, so the batch cadence
(15-60 s) stacks on top of it.

**Objective 2 is half-built.** The tiering is real on the wire (1 Hz driving / 10 s
charging / 30 s parked, flushed 15-60 s) and real in Postgres — migration
`20260716100000` gives `live_only: true` a snapshot-only fast path with no history,
hourly, or trip writes. **But `/api/bydmate/telemetry` does not honour the class.** No
`live_only` guard exists in any of the four fan-out handlers, so a 3 s status ping pays
the same ~12-15 round trips as a full batch:

1. profile auth read · 2. previous-snapshot select · 3. ingest RPC ·
4. **`profiles.last_active_at` UPDATE, unconditional** (`route.ts:274-280`) ·
5. persisted-snapshot verify select · 6. charge-notification reads ·
7. live-status-notifications (profiles + state select) · 8. Telegram widget
(cars + profiles + widget row) · 9. auto-session (3 selects,
`charging-auto-session.ts:270`)

Two specific wastes worth naming:

- `last_active_at` is consumed only by an inactivity cron at **30/60-day** granularity
  (`src/app/api/cron/inactivity-check/route.ts`). The client-side `touchUserActivity`
  already self-throttles to 1/hour via `localStorage`; the ingest path does not. It writes
  the same `profiles` row the ~6 s command poll reads, every 3 s, during fast mode.
- `updateTelegramLiveWidgets` performs `loadCars`, a `profiles` select, `loadWidgetRow`
  and full HTML construction **before** the 30 s throttle check at
  `live-widget.ts:352-359`. The throttle saves a Telegram API call but no database work.

This is P1 below, now with measured justification rather than an estimate.

### Near-term goals derived from the refresh

#### G1 — Telegram widget reaches parity

**Constraint discovered while planning:** Telegram provides **no viewer signal** for a bot
message. The widget's only button is `web_app` (`live-widget.ts:258`) and the webhook
handles no `callback_query`, so the PWA's "someone is watching" heartbeat has no direct
analogue. Options:

- **A — Lower the throttle only (~7-10 s).** The widget then tracks whatever delivery
  cadence exists, so it inherits fast mode for free whenever the app or Mini App is open.
  Telegram's general per-chat limit is about one message per second, so 30 s is far more
  conservative than the API requires. *Pro:* smallest change, no new signal, no added
  invocations. *Con:* standalone widget (app closed) still sits at 15-60 s.
- **B — Add an explicit refresh button that grants a fast window.** Give the widget a
  second inline button with `callback_data`; handle `callback_query` in the webhook, map
  `telegram_id` → profile, and stamp the existing `live_fast_until` / `live_fast_vehicle_id`
  columns. *Pro:* a genuine standalone viewer signal reusing the shipped mechanism; cost is
  bounded by taps. *Con:* pull rather than continuous — one tap buys one window; needs
  webhook callback handling that does not exist yet.
- **C — State-gated always-on fast cadence.** Push fast whenever the car is charging or
  driving, regardless of viewers. *Pro:* widget is always current. *Con:* this is the
  rejected always-on option scoped to active states; it spends invocations continuously and
  erodes offload phases 0-3. **Reject.**

**Decision 2026-07-29: stage both A and B.** G2 will keep the 30-second edit throttle and
make its eligibility check cheap first. Reconsider a faster widget cadence only after
G2 has production evidence; B remains a separate follow-up. G1 depends on G2 — see below.

#### G2 — Server-side persistence classes — SHIPPED 2026-07-29

Implemented in production as commit `15c370b`; see
[CHANGELOG.md](CHANGELOG.md#snapshot-only-live_only-ingest-g2). G1 remains staged until
G2 has production cost evidence. The former G3 reliability premise was superseded by the
current Mate contract: client-owned trips have a Room-first final block, immediate flush on
confirmed `P → power off`, and a 20-minute next-boot finalizer. The cloud already accepts
that final block through `bydmate_apply_client_trip`.

#### G3 — Client-trip finalization observability — SHIPPED 2026-07-29

Implemented in production; see
[CHANGELOG.md](CHANGELOG.md#client-trip-finalization-observability-g3). Modern `client_trip`
final blocks are now measured atomically when the cloud accepts them. G1 remains staged until
G2 has production cost evidence.

### Data ownership and location for G1-G3

**No new user preference.** The fast-mode window remains
ephemeral app-owned state in the two existing nullable `profiles` columns
(`live_fast_until`, `live_fast_vehicle_id`) with an expiry — extend-only, never an explicit
off switch. G1 option B persists nothing beyond stamping those same columns. G2 removes
writes rather than adding them. G3's audit is user-owned operational data in Postgres.
Existing GPS consent is untouched.

### Observed constraints

- The Telegram widget is throttled to 30 seconds and renders only current SOC, odometer,
  state, speed, charging power/time-to-full, and optional last location. It does not need
  one-second history.
- PWA live views read `bydmate_live_snapshots`; a 5–10 second moving update and a
  30–60 second charging update satisfy the current 90-second live-SOC freshness rule.
- Raw samples currently also feed server-side trip inference, route tracks, detailed
  day/trip charts, SOH/energy diagnostics, and exports. Removing them in one cutover would
  change those features and risks missed trip-end events when the head unit powers off.
- The current APK writes a final client-trip block to its durable local queue before the
  confirmed `P → power off` flush attempt, then retries on a later app/daemon opportunity.
  The network flush is still best effort; G3 measures the actual server-accept delay.

### Data ownership and location — confirmation required before implementation

- **User-owned canonical data in Postgres:** authenticated live snapshot, validated trip,
  route track, charge session, server aggregate, command/notification state, and the
  finalization audit record. The cloud derives the Telegram and PWA read models.
- **Device-local delivery cache in Mate Room:** unsent events, a short raw diagnostic
  buffer, and provisional local trip calculations. It must survive process death but is
  never the only copy of cloud history.
- **No new user preference in this phase.** Existing GPS consent remains user-controlled;
  the client may omit GPS and the server continues to sanitize accepted points.

### What each surface actually needs

| Surface | Required cloud data | It does **not** require |
| --- | --- | --- |
| Telegram widget | latest snapshot and state transition; at most one edit per 30 s | every driving sample or full raw route |
| PWA live card | latest snapshot, fresh timestamp, SOC, speed/state, basic position | one-second cloud persistence |
| Charging screen | fresh SOC/power, four start-confirmation samples, start/stop edges, periodic progress | one-second bulk-charge samples below 98% |
| Trip list/analytics | final trip facts and hourly/daily aggregates | all raw points forever |
| Route map / detailed trip chart / diagnostics | adaptive geometry and bounded high-resolution samples | a fixed 1 Hz point on every straight road segment |

### Options

1. **Phased event contract with a shadow period (recommended).** First make trip-end
   delivery durable and remove unnecessary server fan-out. Then dual-write a v2 event
   stream beside the current samples, compare server-derived trips/charges, and only then
   reduce raw cloud persistence. This protects correctness and provides measured savings.
2. **Server-only micro-optimizations.** Gate notifications/widgets/auto-session queries
   and debounce activity writes without changing the payload. Low risk and useful, but it
   does not materially reduce storage or the number of parked/driving samples.
3. **Immediately upload only client daily/week/month summaries.** Lowest volume, but it
   loses routes and diagnostics, makes history depend on APK versions, and cannot reliably
   close a trip when the unit dies. Reject.

### Recommended target contract

- `live_state`: immediate state/gear/charging transitions; every 5–10 s while moving,
  every 30–60 s while actively charging, and an unchanged parked heartbeat no more often
  than every 5–15 min.
- `trip_segment`: adaptive 15–60 s or 100–250 m segment with odometer/SOC start/end,
  duration, speed/power/temperature extrema and averages, energy deltas, and a simplified
  route polyline. Emit earlier on turns, significant speed/SOC/power changes, or loss of
  GPS quality.
- `trip_end_candidate`: Room-first, high-priority event on park/ignition-off with a stable
  local trip id, end facts, last valid location, reason, sequence, algorithm version, and
  idempotency hash. Try a bounded flush; retry on the next APK or daemon opportunity.
- `charge_start`, `charge_progress`, `charge_end`: keep enough early samples to meet the
  four-confirmation auto-start rule, send every 30–60 s after confirmation, and send
  immediate plug/gun/SOC-boundary/tail/end edges. The cloud validates final session,
  energy, tariff, and cost.
- Keep a bounded local 1 Hz diagnostic buffer and retain raw cloud samples during the
  shadow period. High-resolution raw upload remains available for anomalies and explicit
  diagnostics; it is not the normal long-term protocol.

### Delivery roadmap

1. **P0 — reliable stop/off finalization — complete.** The current Mate client already has
   the durable final block, immediate flush attempt, and 20-minute next-boot recovery. G3's
   production audit now measures its first server acceptance; no duplicate protocol is planned.
2. **P1 — reduce current ingest fan-out — half-shipped, see refined plan below.** No
   wire-contract change.
3. **P2 — v2 events in shadow mode.** Add event ids, sequence, algorithm version and
   idempotency validation. Upload `trip_segment`/end events alongside existing samples;
   compare distance, SOC, start/end, and track fidelity per trip.
4. **P3 — measured cutover and retention.** Reduce ordinary raw persistence only when
   parity thresholds hold. Keep adaptive route points and short diagnostic retention;
   retain cloud aggregates and final facts for all supported history views.

### P1 refined plan (2026-08-10) — two of four items already shipped under G2

Re-checked P1 against current code before proposing anything further, since G2 (shipped
2026-07-29) already touches adjacent ground.

**Already done, no action needed:**
- **Debounce `last_active_at` writes** — done, and not scoped to `live_only` only:
  `route.ts`'s `lastActiveBefore` filter applies to every request.
- **Widget throttle before unrelated reads** — done per G2: a throttled widget edit skips
  loading car metadata and building HTML before the throttle check.

**✅ Item 1 shipped 2026-08-11** — see CHANGELOG.md. Item 2 (auto-session gating) remains
open, deferred for the correctness reason below.

1. **Gate charge-notification work to charging changes — SHIPPED.**
   `processBydmateChargeNotifications` (`src/lib/push/charge-notifications.ts:161`)
   unconditionally calls `loadNotificationProfile` and selects
   `bydmate_charge_notification_state` on every non-`live_only` request, even a plain
   driving sample with zero charging signal.
   - **Design:** skip the call entirely when neither of the following holds: (a) any
     sample in the batch is charging per `isTelemetryCharging(sample.telemetry, sample)`
     (`src/features/charging/_domain/telemetry-charging.ts:50`), or (b) the vehicle's
     last known telemetry, already held in-memory as `previousTelemetryBeforeSanitize`
     (`route.ts:229`, populated before this function runs, no extra query), was charging.
     Condition (b) catches the just-stopped-charging transition the function needs to
     close out, without a DB read to discover it.
   - **Needs verification during implementation, not assumed:** `isTelemetryCharging`
     takes an optional `context` carrying Di+ gun-state fields for its fallback path
     (`telemetry-charging.ts:52,64-68`); confirm what `previousTelemetryBeforeSanitize`'s
     stored shape actually carries before relying on it for condition (b), or the skip
     could be wrong in the gun-state-fallback case specifically (the one AGENTS.md already
     flags as unreliable for car `way`).
2. **Avoid full auto-session reads with no charging/open-session signal.**
   `processBydmateAutoChargingSessions` (`src/features/charging/_server/charging-auto-session.ts:270`)
   unconditionally fires 3 selects (`cars`, open `charging_sessions`, auto-session state)
   on every non-`live_only` request.
   - **Correctness risk, not just a cost question:** unlike item 1, this function's job
     includes detecting the **charging → not-charging** transition to auto-stop a session
     (unplug, drive-away). A naive gate of "skip unless currently charging" would silently
     break auto-stop for exactly the samples where charging just ended — a regression to
     charging correctness, which is worse than the invocation cost this phase is trying to
     reduce. The same-signal check from item 1 (currently charging OR was charging per
     `previousTelemetryBeforeSanitize`) covers the *known* transition case, but does not by
     itself confirm whether a session is actually open server-side without a read.
   - **Options:** (a) apply the same charging-signal gate as item 1 — cheaper than nothing,
     but relies entirely on `previousTelemetryBeforeSanitize` correctly reflecting
     "was charging" across every legitimate transition path (including drive-away-while-
     charging, not just unplug), which has not been verified against
     `shouldAutoStopOnDriveAway`'s speed-based trigger (`charging-live.ts:267-272`) — a
     drive-away sample may show `isTelemetryCharging: false` with no prior-charging
     telemetry difference the naive check would catch differently from a normal drive.
     (b) denormalize an `has_open_charging_session` flag onto `cars`, updated whenever a
     session opens/closes, so the route can check it with the data it already loads instead
     of a fresh select — closes the gap fully but is schema work, out of scope for a
     "fan-out reduction" pass. (c) leave this one alone for now; ship item 1 only.
   - **Recommendation: (c).** Ship item 1 (charge notifications) on its own — it's a clear,
     low-risk win. Defer item 2 until the drive-away-while-charging interaction with a
     signal-only gate is verified against real samples, or until option (b)'s schema change
     is separately proposed and approved; a broken auto-stop is a worse outcome than the
     invocation cost it would save.

### Design-review gates before P2/P3

1. **Separate freshness from history.** `live_state` must update the latest snapshot but
   not automatically append a historical raw row. Every v2 event declares its server
   persistence class: snapshot-only, canonical segment/final fact, or bounded diagnostic
   raw. Without this distinction, lower upload cadence only moves the cost problem rather
   than solving it.
2. **Finalization is a candidate, not unilateral authority.** The server accepts a
   `trip_end_candidate` only when it matches the active vehicle/trip context, its odometer
   and timestamp do not regress, and it is not contradicted by newer driving telemetry.
   Otherwise it records the audit event and uses the existing grace/gap fallback. This
   prevents a transient `P` or delayed replay from splitting a physical drive.
3. **Order and retry contract.** Add `source_session_id`, monotonic `sequence`, immutable
   `event_id`, and payload hash. The server deduplicates `event_id`, never regresses a live
   snapshot from an older sequence/device time, and permits a late historical segment only
   when it belongs inside an already accepted trip window.
4. **Explicit stale/offline semantics.** A missed parked heartbeat must make the snapshot
   stale after a defined TTL; it must never imply that the car is still driving. The PWA
   and Telegram output should show last-seen/offline state from timestamps rather than
   inventing a vehicle state.
5. **Shadow window and rollback.** Run v1 and v2 side-by-side for a fixed, measured cohort
   and period. Compare per-trip start/end, distance, SOC, energy, route deviation, and
   finalization delay. Keep the v1 sender selectable until the acceptance thresholds pass;
   then stop dual write before reducing raw retention.
6. **Failure test matrix.** Cover no-network queueing, duplicate replay, out-of-order
   replay, `drive → P → power off` in under two seconds, daemon-only recovery, app restart,
   charging start/stop, GPS omitted, and an APK upgrade across an unfinished trip.

### Success measures

- No lost or incorrectly open trip across the `drive → P → power off` test matrix.
- Telegram freshness stays within its 30-second throttle; PWA moving live state ≤10 s and
  charging SOC ≤90 s.
- Compared with today's normal path: roughly 5–10× fewer moving live writes, 3–6× fewer
  bulk-charge writes, and up to 10–30× fewer unchanged parked writes, while route and
  trip/charge parity remain within defined tolerance.
- No client-provided aggregate bypasses RLS, tariff/cost calculation, notification state,
  or canonical trip/session validation.

Proposed 2026-07-15; not built. **Should I build this?**

---

## Public-documentation hygiene: English-primary, no private operations or AI material

### Goal

Turn the tracked documentation into a safe public product/developer reference. English
is canonical for implementation; Russian translations may remain public. Remove private
operational detail, agent/AI workflow material, local paths, real deployment/vehicle
history, and provider/model configuration from the public Git history going forward.
Keep any information needed by the local maintainer only in Git-ignored local files,
with **no public links or references to those files**.

### Audit facts (2026-07-15)

- `.gitignore` already ignores `/docs`, `AGENTS.md`, `CLAUDE.md`, `SKILLS.md`, and agent
  configuration folders, although older versions of several of those files are tracked.
- Publicly tracked AI/agent material currently includes `AGENTS.md`, `CLAUDE.md`,
  `SKILLS.md`, `PAPERCUTS.md`, agent-oriented sections in `README.md` and architecture
  docs, plus implementation/provider references to OpenAI, Ollama, Qwen, prompts, and
  agent memory in `BACKLOG.md`/`CHANGELOG.md`.
- Publicly tracked private operational material includes real production history,
  vehicle aliases and observations, self-hosted migration commands, local filesystem
  paths, hardware/ADB operational details, and deployment troubleshooting. It is spread
  across `BACKLOG.md`, `CHANGELOG.md`, `supabase/MIGRATIONS_AUDIT.md`,
  `supabase/TELEMETRY.md`, and related domain documents.
- `docs/ARCHITECTURE.ru.md` is a public Russian translation. It may remain tracked; the
  English `docs/ARCHITECTURE.md` remains the canonical implementation reference.

### Options

1. **Full public/private split (recommended).** Keep only concise English public docs:
   product overview, safe setup with placeholders, architecture, behavior contracts, and
   schema/API references stripped of real environments and AI/provider detail. Remove
   tracked agent instructions, work logs, backlogs, papercuts, operational runbooks, and
   historical deployment notes. Preserve their local copies under ignored `docs/` paths,
   but do not mention them in public files. Keep public Russian translations aligned with
   their English canonical counterparts.
2. **Redact only obvious secrets and hostnames.** Smaller diff, but internal operations,
   personal history, AI workflow, and implementation clues remain public. Does not meet
   the requested clean public-repo boundary.
3. **Make the repository private.** Avoids immediate redaction but leaves the current
   public-documentation posture unsafe if it is later opened or cloned. It also does not
   create a clean shareable repository.

### Recommended public scope

- Keep and rewrite with English canonical versions (and public Russian translations where
  present): `README.md`, `INSTALL.md`,
  `docs/ARCHITECTURE.md`, `docs/CHARGING_SESSIONS.md`, `docs/TRIPS.md`,
  `docs/DATABASE_SCHEMA.md`, `docs/PREMIUM_ADMIN.md`, `docs/PRODUCT_STATUS.md`,
  `docs/VEHICLE_STATE_NOTIFICATIONS.md`, `supabase/VOLTFLOW_MATE_API.md`, and a compact
  `supabase/TELEMETRY.md`. They will use generic examples/placeholders and describe
  product behavior without private operations or AI/provider details.
- Remove from the tracked public repository and keep locally only: `AGENTS.md`,
  `CLAUDE.md`, `SKILLS.md`, `PAPERCUTS.md`, `BACKLOG.md`, `CHANGELOG.md`,
  `docs/CHART_OPTIMIZATION_SPEC.md`, and `supabase/MIGRATIONS_AUDIT.md`. Move needed
  local content into ignored files before removal; no surviving public document may link
  to them.
- Remove all AI-related documentation from public files: agent workflows and model/tool
  references, plus provider-specific product-search documentation and environment keys.
  Public docs may say only that an optional search feature exists, without naming or
  documenting AI providers, models, prompts, embeddings, or keys.
- Remove real production/car/local details: domains, hosts, IPs, local absolute paths,
  exact car aliases/observations, production migration/deploy commands, hardware access
  procedures, internal bot operations, and incident records. Retain safe protocol names,
  endpoint paths, and placeholder credentials where necessary for public integration.

### Local-only ownership and location

The private copies are maintainer-owned operational documentation stored under ignored
`docs/` paths. They remain outside Git and outside public navigation. No user preference
or product data model changes are involved.

### Verification

- Inspect the tracked file list after the split; no removed AI/agent/private document may
  remain tracked or be linked from a public document.
- Search tracked Markdown for AI/provider terms, local paths, real hosts, production
  commands, credentials, and known vehicle aliases; allow only intentional generic API
  placeholders and public product vocabulary.
- Confirm the remaining public Markdown is English or an intentional Russian translation;
  retain reciprocal language navigation for public translations.
- Run `git diff --check`, link checks for remaining public docs, and verify ignored local
  copies are not staged.

Proposed 2026-07-15; not built. **Should I build this?**

---

## Telegram community marketplace for `@Voltflowscr_bot` — only search/matching, expiry, and a pre-filter remain

### Status check (2026-07-16) — verified against live production data, this is final

This entry was wrong three times in a row before this correction (see `CHANGELOG.md`
history). Verified this time not just against source but against **live behavior**:
queried the last 10 real messages from the BYD group (chat id `-1002179930838`,
"Купи и езди на BYD YUAN UP (Беларусь)") and every one shows `status: "processed"`
with correct `intent`/`needs_review`/`actionable` and `verified_at` landing 3–7 s after
`sent_at`. **The full pipeline is live and working right now.**

**Already shipped, fully operational — do not re-propose:**
- `community_listings` + `telegram_group_events` Postgres tables (migrations
  `20260714150000`, `20260714153000`, `20260714160000`, `20260715100000`).
- Admin CRUD: `src/lib/supabase/community-listings.ts` + admin navigation UI.
- **The entire capture → classify → draft pipeline runs in
  `scripts/telegram-miniapp-server.py`** (the Python edge Telegram's webhook actually
  calls at `https://bot.voltflow.life/voltflow/api/telegram/webhook` — confirmed via
  `getWebhookInfo`), not in the Next.js tree at all:
  - `handle_webhook()` → `normalize_group_event()` → `upsert_telegram_group_event()`
    (status `pending`) → spawns `process_telegram_group_event()` on a background thread.
  - `process_telegram_group_event()` calls `verify_telegram_text()` (a Python twin of
    `verifyTelegramContext`, same `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` env vars);
    on `actionable: true` it calls `upsert_community_listing()`, which **does** insert
    into `community_listings` with `status: "draft"` (upserts on
    `source_chat_id, source_message_id`, so edits refresh the same listing).
  - `process_pending_group_events()` exists as a batch retry/backfill path for rows
    stuck at `status: "pending"`.
  - The Next.js `src/lib/llm-context-verifier.ts` and
    `src/app/api/telegram/webhook/route.ts` are unrelated to this flow (the latter only
    handles `/start`/`/app` for direct bot chats).

**Genuinely still open:**
1. **No deterministic pre-filter.** `process_telegram_group_event()` calls the LLM
   unconditionally for every non-empty, non-protected message — no cheap keyword gate
   first. Not a correctness bug (classification is working), but every message in an
   active group costs an LLM call. Worth a keyword pre-check (`продам`, `куплю`, `ищу`,
   `нужен`, price/contact patterns) to skip obviously-irrelevant technical chatter
   before calling `verify_telegram_text()`.
2. **Search/matching integration missing.** No `market_listing` source type in the
   vector-search contract — confirmed via full-tree grep, zero hits. Buyer/seller
   matching by embedding + generation/city/status/expiry filters is unbuilt.
3. **Expiry.** No cron/RPC expires `community_listings` after 30 days; `expires_at`
   exists as a column but nothing acts on it. (`telegram_group_events` has its own
   7-day `expires_at` for the raw inbox, also with no prune job found.)

### Recommendation

None of the three remaining items are urgent — the marketplace works end-to-end today
for the core "message becomes a moderated draft listing" loop. Priority, if picked up:
item 1 (pre-filter) first since it's the only one with an ongoing cost/latency impact;
items 2–3 whenever search/discovery for listings is actually wanted.

### Data ownership (unchanged, now reflects the fully built schema)

- **Normalized listing:** user-owned, Postgres (`community_listings`), author-editable
  via the existing admin CRUD.
- **`telegram_group_events`:** app-owned raw capture + verification result storage,
  already applied — treat as the working system, not something to redesign.
- **Embeddings:** app-owned derived search data, to be deleted with the listing once
  item 2 exists.

Should I build any of the three remaining items, or leave this alone for now?

---

## 🟠 Domain migration → voltflow.life — leftovers (optional, not blocking)

Phases 0–3 **shipped** (canonical domain, frontend URLs, backend infra, and the Mate
one-shot settings migration built + verified on car `way`) — see [CHANGELOG.md](CHANGELOG.md).
The two Mate commits (`7b37366` vehicle_id fix, `e2cd59b` domain migration) are **local,
unpushed** — a formal Mate release still follows the `/release-apk` skill (version bump +
post-install telemetry verification).

Remaining items are optional and none block anything:

- **Serve `/api/bydmate/*` directly on the old host.** Today every telemetry sample is a
  `308` + a re-issued POST. Flipping the legacy Vercel origin to *Connect to an
  environment → Production* and moving the redirect into `src/proxy.ts` with a path
  exemption would halve the request count. Efficiency, not correctness.
- **Vercel Attack Challenge Mode is intermittently ON** (`x-vercel-mitigated: challenge`),
  which challenges every non-browser client. It is the reason Telegram traffic detours via
  `bot.voltflow.life`. A WAF bypass for `/api/bydmate/*` would be healthier than routing
  around it.
- **Push subscriptions are origin-scoped.** A user who reinstalls the PWA from the new
  origin gets a *second* subscription → possible duplicate charge notifications until the
  old one expires. Worth a dedupe pass.
- **No `sitemap.ts` / `robots.ts`** — folded into the SEO remediation section below
  (approved 2026-08-19).

---

## 🟠 SEO remediation — the site is technically unindexable (approved 2026-08-19)

**Status 2026-08-20: Phases 1-5 built. The `/knowledge/*` move (Phase 3) shipped
on branch `feature/seo-knowledge-split` — see the resolution note below, which
supersedes the (a)/(b)/(c) options that blocked it. Every KB route is prerendered
with 1h ISR and `s-maxage=3600`.**

**Remaining, and blocking everything above: Phase 0.** Re-probed 2026-08-20 —
Vercel Attack Challenge Mode is **ON**. `GET /`, `/robots.txt` and `/sitemap.xml`
all return `403` + `x-vercel-mitigated: challenge` (a "Vercel Security Checkpoint"
JS page), including under Googlebot and YandexBot user agents, 5/5 consecutive.
`bot.voltflow.life` answers 404 unchallenged, so it is a per-project firewall
toggle, not DNS. It must be turned off or given a verified-crawler bypass in the
Vercel dashboard; until then nothing else here is visible to a crawler. Also
outstanding: Yandex Webmaster registration (`src/proxy.ts` already whitelists the
`yandex_<hash>.html` token; the Google one is in `public/`).

Plans: `~/.claude/plans/how-to-improve-seo-sorted-gem.md` (Phases 1-6, the first
pass) and `~/.claude/plans/check-our-project-seo-polymorphic-noodle.md` (the KB
split and the metadata defects) — both local, not in the repo.

### Phase 3 resolution — split by job, not by audience

The (a)/(b)/(c) options below all traded one audience's UX against another's,
which is why this stalled. The actual problem was that `/telegram` did two
unrelated jobs: Mini App entry gate **and** public KB, welded together by
`KB_PREPAINT_GUARD`. `TelegramShell` and `KnowledgeHub` were already two wrappers
around the same `KnowledgeView`.

Shipped instead: the KB is the canonical public tree at `/knowledge/*` (one
namespace, the only one in the sitemap, ISR intact); `/telegram` keeps only
`TelegramEntryGate`, carries `robots: noindex`, and is absent from the sitemap;
old `/telegram/*` content paths 308 forward. BotFather still points at
`/telegram`, so no bot reconfiguration was needed. The pre-paint guard,
`revealKnowledgeBase()` and its 5s timeout are **deleted** — they existed only
because the gate and the KB shared a URL, so the move removed the risky code
rather than threading it through a redirect as the earlier plan proposed.

In-app chrome is chosen **client-side** (`KnowledgeHeader` reads the session in
the browser). Reading it on the server would make the route dynamic and cost the
`s-maxage=3600` CDN cache that makes the KB indexable at all.

Verified against the live site on 2026-08-19. This is not an "optimize the copy" item —
several independent blockers each make the site unindexable on their own:

| Probe | Result |
|---|---|
| `GET /robots.txt`, `GET /sitemap.xml` | **307 → `/login`** — neither file exists, and the `src/proxy.ts` matcher would redirect them if they did |
| `GET /` HTML | `<title>VoltFlow</title>`, no `og:*`, no `twitter:*`, no canonical, no JSON-LD anywhere in the repo |
| `<html lang>` | `en` — while the server-rendered body is Russian (215 words) |
| `GET /telegram/article/<garbage>` | **HTTP 200** with a "не найдена" card — a soft 404 |
| Links in `/telegram` SSR HTML | 4 article URLs, **0 category URLs** — ~35 articles and all 11 categories orphaned |
| KB article headers | `private, no-cache, no-store`, `x-vercel-cache: MISS` on every request |
| `www` / `http` / trailing slash | 308 → apex — **already correct**, no work needed |

### Decisions taken with the owner

1. **Move the public KB `/telegram/*` → `/knowledge/*`** with 308s. The `telegram` segment
   is the most prominent token in the SERP URL line and tells Google the page is about
   Telegram, not battery care. Zero pages are indexed today, so the move is free now and
   gets more expensive every month.
2. **Russian is the single indexable language.** `knowledge_articles` has no `locale`
   column, so locale-prefixed routes would serve a Russian body under English chrome —
   hreflang without translated content is a net negative. Fix `<html lang>` to `ru`; the
   EN/BY switcher stays client-side only.
3. **Technical scope only** this pass. Content depth and the landing bundle are recorded
   below, not built.

### Phases

- **0 (ops, blocking)** — Vercel Attack Challenge Mode (see the domain-migration section
  above) must stay off or gain a verified-crawler bypass; while on it serves crawlers a JS
  challenge and silently voids everything below. Also decide whether `/support` is public:
  it is prerendered and reads as a public donations page, but is not in `PUBLIC_PATHS`, so
  crawlers get 307'd to `/login`.
- **1** — `robots.ts`, `sitemap.ts`, real 404s, `noindex` on auth/search/admin, and a
  matcher exclusion so the two metadata routes stop being redirected to `/login`.
- **2** — `metadataBase`, per-route canonicals, default OG/Twitter, a static OG image,
  `<html lang="ru">`, and the `"use client"` split on the landing page (it currently cannot
  export metadata at all, which is why the homepage title is the bare default).
- **3** — the `/knowledge/*` move + 308s. **Device-test the Telegram Mini App first:**
  `KB_PREPAINT_GUARD` reads `location.hash` for `tgWebAppData`, and a regression there means
  the KB flashes before the gate hides it.
- **4** — a cookie-free anon Supabase client for public reads so the KB can go ISR, a
  server-rendered crawlable link index, and `images.remotePatterns`.
- **5** — JSON-LD (`Organization`/`WebSite`, `TechArticle`, `BreadcrumbList`,
  `CollectionPage`, `Product`).
- **6** — Google Search Console **and Yandex Webmaster** registration.

### Phase 3 is blocked on a UX decision, not on code

`/knowledge` is currently owned by `src/app/(app)/knowledge/page.tsx`, which sits
inside the `(app)` route group and is therefore wrapped in `MobileShell` (bottom
nav, in-app chrome). Moving the public KB hub to `/knowledge` collides with it, and
the resolution decides what an anonymous visitor sees:

- **(a)** Public hub at `src/app/knowledge/page.tsx`, delete the `(app)` one —
  authenticated users lose the in-app shell while browsing the KB.
- **(b)** Keep `(app)/knowledge/page.tsx` and branch on session — anonymous users
  get `MobileShell`, whose bottom nav links to auth-gated routes.
- **(c)** Leave the hub at `/knowledge` as-is and move only the detail routes.

`(app)/layout.tsx` does NOT enforce auth (the proxy does), so (b) is possible but
needs the nav hidden for anonymous visitors. Confirm the choice before building.

### Two traps found during research — do not skip

- **`useSearchParams` inside `<Suspense fallback={null}>`.** `TelegramShell` (via
  `src/app/telegram/page.tsx`) and `TelegramCategoryView` (via `category/[slug]/page.tsx`)
  both call `useSearchParams()` inside a `fallback={null}` boundary. Under *dynamic*
  rendering it resolves during SSR, so the HTML has content. Under *static* rendering Next
  prerenders the fallback and defers the subtree to the client — so enabling ISR without
  first adding the server-rendered link index would ship the hub and all 11 category pages
  as **empty HTML shells**, strictly worse than today. Article pages are safe
  (`ArticleRenderer` uses only `useRouter`/`useState`), so do articles first.
- **`next/og` and Cyrillic.** Satori's bundled fallback fonts do not reliably cover
  Cyrillic and the whole corpus is Russian; Space Grotesk is Latin-only. Per-article
  `ImageResponse` OG images would render tofu boxes in every social preview. Use a static
  PNG until a Cyrillic woff2 is bundled and passed via `fonts:`.

### CSP note for whoever hardens the policy later

JSON-LD needs **no** nonce today: the *enforced* CSP in `next.config.ts` has no `script-src`
and no `default-src`, and the report-only policy carries `unsafe-inline`. But
`application/ld+json` *is* governed by `script-src` under CSP3 — the day the report-only
policy is promoted to enforced and `unsafe-inline` is dropped (the whole point of promoting
it), every JSON-LD block breaks silently. Thread a nonce from `src/proxy.ts` or use
`sha256-` hashes at that point.

### Out of scope this pass — but these decide whether any of it earns traffic

- Articles average ~97 words (`battery-care` renders 97). Phases 1–5 get pages indexed;
  they do not get them ranked.
- The landing `<h1>` is the literal string "VoltFlow" — a brand word carrying no topical
  signal.
- 449 KB gzipped JS across 20 chunks on the landing. The prime suspect is measurable, not
  speculative: `src/lib/i18n.ts` is 227 KB of source holding all three dictionaries in one
  module and `useTranslation` is a client hook, so every locale ships to every client on
  every page. Also `createClient` at module scope in the landing (needed only for the
  `/?code=` OAuth edge case) and a first-paint `ipapi.co` round trip. TTFB is already 0.20s
  with a CDN HIT, so this is purely JS weight.
- The two content gaps in the next section are the cheapest wins once content is in scope.

---

## 🟡 Knowledge base content gaps (two missing articles)

The 12-query relevance eval (`npm run search:eval`) passes 12/12 — but two of those pass by
*correctly admitting we have no answer*:

- **«как заряжать зимой»** — the corpus has no winter-charging article. The closest match is
  *Зимняя омывающая жидкость* (winter washer fluid, 0.417), which is why search used to hand
  it over as an answer.
- **«чем отличается AC от DC»** — no AC-vs-DC explainer exists.

Both are questions a real BYD owner will certainly ask. The search side is now handled (it
says "Точного ответа не нашлось" instead of bluffing), so **this is a content task, not a
code task**: writing the two articles turns both cases from "honest miss" into "hit".

**Verified 2026-07-15 — don't write from scratch, there's a false start to reuse or
delete:** `src/data/charging-explainer.ts` already has entries titled "AC vs DC charging"
and "Winter charging behavior" (dated 2026-05-16, predates this backlog item). It has
**zero importers anywhere in the tree** — it was never wired into the searchable
`knowledge_articles` corpus the eval script tests against, so the eval's "missing" verdict
is still accurate for actual search results. Before writing new copy, read this file first:
either promote its content into `knowledge_articles` (fastest path) or confirm it's
unusable and delete the dead file instead of leaving orphaned content behind.

When they exist, flip their `expect` in `scripts/knowledge-search-eval.mjs` from `null` to
the new titles — the eval will then hold them to the same standard as everything else.

Optional, and deliberately deferred: **hybrid search** (vector + Postgres full-text, RRF
fusion). It is the textbook cure for "matched one adjective, ignored the topic". But at 19
documents with a 10/12 top-1 hit rate, the measurement says retrieval is not the bottleneck
— content is. Revisit if the corpus passes ~100 items or the eval regresses.

Proposed 2026-07-14; content work, no go-ahead needed from an engineering standpoint.

---

## 🟡 Separate car model from generation and choose model-specific dashboard art

The `cars` table currently stores only `model_generation` (`gen1_2024` or
`gen2_2025`), which is insufficient for users with Yuan Plus, Dolphin, Seal, or
another vehicle. The dashboard image mapping therefore cannot safely distinguish a
Yuan UP from another model.

**Options:**

1. Add a `model_key` column to `cars` with a constrained app-supported enum, default
   existing rows to `yuan_up`, expose the model selector in the car form, and map
   dashboard art by `model_key` while keeping generation separate — explicit,
   backwards-compatible, and safe for future model images.
2. Infer the model from the user-entered nickname — no migration, but unreliable and
   would show incorrect artwork for names like “Family car”.
3. Keep Yuan UP art for every car — no code or schema work, but misleading for every
   non-Yuan-UP vehicle.

**Recommendation:** option 1. Add an idempotent migration for `cars.model_key` with
   `yuan_up` as the existing-row default, define the allowed model keys in shared
   TypeScript, add localized model labels and a required Settings/car-form selector,
   and use a generic car icon when a model has no image. Keep `model_generation`
   independent because generation applies within a model. Existing RLS remains
   user-scoped; verify the migration, create/update flows, dashboard fallback, and
   localized settings labels before applying it to production.

Proposed 2026-07-12; awaiting go-ahead.

---

## 🟡 Lifetime-map pagination: race-safety vs. round-trip latency

`fetchLifetimeTrackPoints` (`src/lib/vehicle-analytics.ts`) pages through
`bydmate_trip_track_points` via `collectPagedRows` (`src/lib/bydmate/paged-query.ts`),
issuing up to 5 sequential `range()` requests for the default 5,000-point cap (shipped
2026-07-11 to fix the 414 error for long histories — see CHANGELOG). Code review
(2026-07-11) flagged two related issues neither fixed nor urgent enough to block:

1. **Offset drift under concurrent writes:** pages are ordered `device_time desc` with
   numeric `range(from, to)` offsets. If the vehicle is actively driving while the map
   loads, a new track point can land between page fetches and shift every later row's
   offset by one — a boundary row can appear duplicated or a row can be silently
   dropped, showing as a small jog/gap on the rendered polyline. The old single-query
   snapshot didn't have this window.
2. **Sequential round trips reintroduce latency:** 5 awaited-in-order requests instead
   of 1, for exactly the long-history vehicles the 414 fix targeted — risk of a slow
   response or Vercel timeout with no `maxDuration` override on the route.

**Options:**
1. **Keyset (cursor) pagination** — page by `.lt("device_time", lastSeenCursor)`
   instead of numeric offsets. Fixes the drift issue outright (immune to concurrent
   inserts above the cursor) but stays sequential, so it doesn't address latency.
2. **Fire all pages in parallel** (page count is known upfront: `ceil(limit/pageSize)`)
   — fixes latency (~1 round trip instead of 5) but narrows, doesn't eliminate, the
   drift window, and changes `collectPagedRows`'s short-circuit-on-short-page contract
   (would need a rewrite of its existing tests).
3. **Both:** parallel keyset pages aren't compositable (each cursor depends on the
   previous page's last row), so getting both properties needs a different design,
   e.g. a single server-side RPC that snapshots the page.
4. **Leave as-is** — the drift is a rare, cosmetic map glitch; the latency risk is
   real but unmeasured (no report of an actual timeout yet).

**Recommendation:** option 1 (keyset) first if the map glitch is ever reported by a
real user; otherwise leave as-is and revisit if `/api/vehicle/lifetime-map` shows up
slow in practice. Not urgent — awaiting go-ahead.

Related, same review pass: `collectPagedRows` itself isn't reused by the two
pre-existing hand-rolled pagination loops in `src/lib/bydmate/telemetry-history.ts`
and `src/lib/charging-session-reconcile.ts`. Worth migrating those to the shared
helper the next time either file is touched, not as a standalone task.

---

## 🟡 Partition `bydmate_telemetry_samples` by time (Plan A)

The high-volume ~1 Hz append-only table. Retention is `DELETE`-based (bloat + vacuum
pressure). **Plan B (BRIN index) is done** (see CHANGELOG). **Plan A (full declarative
range partitioning by `device_time`, monthly)** turns retention into `DROP PARTITION`
and shrinks indexes.

- Forces composite PK `(id, device_time)`; the existing unique
  `(user_id, vehicle_id, device_time)` already includes the partition key. ✅
- Subtle part: the prune rewrite — mixed retention tiers (free 30 d vs premium/admin
  forever) in one time partition means a hybrid of `DROP PARTITION` (past the longest
  tier) + per-user `DELETE` within retained partitions.
- Annotated, **not-applied** draft: [docs/PLAN_A_PARTITION_DRAFT.sql](docs/PLAN_A_PARTITION_DRAFT.sql).
- Needs user go-ahead **and** a pg_dump/host backup before applying.

Not urgent at current scale; worth doing before the userbase grows.

---

## 🔵 Promote `vehicle_id` to a real foreign key

`vehicle_id` is a soft `text` key across telemetry, trips, snapshots, commands, and
notifications (~36 occurrences), linked by `cars.vehicle_alias` (text) → `*.vehicle_id`
(text) string equality with **no referential integrity**. A typo or alias change
silently orphans data.

**Recommendation:** a real `vehicles` table (uuid PK), FK from all telemetry/trip/command
tables, keeping `vehicle_alias` as the external device id. Big, multi-RPC migration on
the hottest write path (ingest) — defensible to defer until the telemetry tables are
already being opened up (e.g. combine with the partitioning cutover above). Lower
priority than partitioning; build only if explicitly prioritized.

---

## ⚠️ APK: no-ADB basic mode — verdict REVISED 2026-07-06 (varies by firmware)

> **2026-07-06 correction:** a real user's **Yuan UP 2025 / DiLink 5** ran the v0.4.6
> «Диагностика BYD» button: `/storage/emulated/0/energydata/EC_database.db` **EXISTS**
> (876 rows, `canRead=true`, DiPlus not running, no ADB), and the APK's existing importer
> had already pulled **873 trips into its local DB**. So `energydata` presence **varies by
> firmware/model-year within Yuan UP** — the owner's car lacks it, the 2025 car has it.
> Basic mode is viable on such cars; the ⛔ below stands only for cars without the file.
> → The trip-summary cloud sync plan below is now **justified by a real user**.

### Original investigation (2026-07-02, owner's car)

Investigated adopting AndyShaman's no-ADB `energydata` read. **Dead end on the Yuan UP** —
verified on car `way` via ADB:

- `/storage/emulated/0/energydata/EC_database.db` (AndyShaman's source) **does not exist**
  on the Yuan UP — it's Leopard-3-only. `EnergyDataReader.kt` already reads it; nothing to
  read on this model.
- di+ `van_bm_db` (`/storage/emulated/0/vandiplus/db/van_bm_db`) has rich trip+charging
  history and a reader (`DiPlusDbReader`), but di+ only **writes** it when di+ works —
  which needs ADB. No ADB → empty.

**Conclusion:** on DiLink 5 there is no no-ADB source; ADB is required for any data. Docs +
onboarding reverted from "basic mode coming soon" to "ADB required." No APK work to do
unless a future model ships the `energydata` DB. See [[adb-data-source-reality]].

**Clarification vs upstream README (2026-07-05):** AndyShaman's no-ADB basic mode is real
but rests entirely on the `energydata` file — and per his own architecture table, live
SOC/temps/SoH/cells come from the **autoservice Binder under shell (ADB)** even upstream.
Basic mode ≠ live cockpit anywhere; it's trips/consumption + GPS only. His car (Leopard 3)
writes `energydata`; the Yuan UP doesn't.

---

## 🟡 Delivery cadence — cut invocations, not calculation (de-escalated 2026-08-19)

> **Status 2026-08-19 — no longer quota-blocked.** The account moved to **Vercel Pro**, so
> the Hobby overage that made this urgent is gone. This is now a monthly-cost question
> rather than a cliff; the plan below stands on its own merits and only the urgency
> changed. **P0 and P4 are the cheap ones** — P4 needs no APK release at all. See
> [CHANGELOG.md](CHANGELOG.md) 2026-08-19 for the decision record.

### Goal

Reduce Vercel function invocations at the source. The binding resource is **function
invocations**, and invocations are driven by **delivery cadence**, not by how much
arithmetic runs per sample. Owning sources are APK-side: `CommandDaemon` and
`CloudTelemetrySender` in `BYDMate-own`.

**Data ownership:** no user-facing data model changes. These are app-owned cadence constants
compiled into the APK; nothing moves between Postgres and client storage.

### Research findings — 2026-07-20

**The cloud-offload programme optimised the wrong resource for this goal.** Measured on prod:
the self-hosted database is **3.04% CPU / 386 MB**, the database is **1.17 GB**, and the fleet's
entire per-sample ingest work is ~11 minutes of DB time per week. Phases 3–4 save 0.68 ms/sample
(3.255 → 2.575 ms, 20.9%) on a resource that is free and idle. **They do not reduce invocations
at all** — the same HTTP requests are made, with less work inside them.

Vercel bills **Active CPU**, not wall-clock, so time spent waiting on the database is cheap.
Invocation count is the countable. Bandwidth is not a concern: 835 bytes/sample average against
~30,200 samples/day is roughly 1.5–2.5 GB/month versus a 100 GB allowance.

Requests per hour by state, derived from the documented cadences:

| State | Delivery interval | Requests/hour |
| --- | --- | --- |
| Parked / car-off heartbeat | 60 s | 60 |
| Charging bulk (<98%) | 60 s | 60 |
| Driving | 15 s | 240 |
| Charge tail (≥98%) | 15 s | 240 |
| **Fast mode (viewer watching)** | **3 s** | **1,200** |

```
invocations/day ≈ 240·(driving_h + tail_h) + 60·(parked_h + charging_h) + 1200·viewer_h
```

Measured fleet total is **5,675 invocations/day ≈ 172k/month** (telemetry route only). The naive
model predicts ~9,600/day, so not every car runs a daemon continuously — treat the model as an
upper bound.

**Ranking correction:** fast mode is the most expensive *per hour* by a wide margin, but the
parked heartbeat likely contributes as much or more *per day*, because it runs ~20 hours instead
of one. An earlier claim in this session that fast mode was the main multiplier was wrong on
daily totals.

### Options

1. **Do nothing.** *Pro:* no freshness cost. *Con:* invocations stay at ~172k/month with no
   headroom as the fleet grows. **Correct choice if the dashboard shows you are well under quota.**
2. **Parked/daemon delivery 60 s → 300 s (recommended).** 60 → 12 requests/hour, up to **960
   fewer requests/day per car**; plausibly 40–50% fleet-wide, ~172k → ~90k/month. *Cost:* the
   live snapshot may be up to 5 minutes stale **while parked and nothing is changing** — which is
   precisely the condition `live_only` already asserts. Viewer-gated fast mode covers the case
   where someone is actually looking.
3. **Driving 15 s → 30 s.** Halves 240 → 120/hour. *Cost:* real freshness loss for a non-watching
   viewer. Do only if option 2 is insufficient.
4. **Fast mode 3 s → 5 s.** 1,200 → 720 per viewer-hour. *Cost:* degrades the headline feature
   users actually see. Last resort.

### Recommendation

**Check the Vercel dashboard Usage page first.** If 172k/month is a small fraction of the
allowance, build nothing — the region pin already shipped is the right stopping point. Only if
headroom is tight, build option 2 alone and re-measure before considering 3 or 4.

### ✅ Dashboard checked 2026-07-20 — answer is "headroom is gone", and the model above was wrong

Vercel Usage, Jul 6 23:00 – Jul 20 (14 days), projected ×2.14 to a 30-day month:

| Metric | 14 days | Projected/mo | Hobby limit | Status |
| --- | --- | --- | --- | --- |
| Function Invocations | 721K | ~1.55M | 1M | 🔴 155% |
| Edge Requests | 736K | ~1.58M | 1M | 🔴 158% |
| Fluid Active CPU | 5h 29m | ~11.7h | 4h | 🔴 293% |
| Fluid Provisioned Memory | 175.5 GB-Hrs | ~376 GB-Hrs | 360 | 🟠 104% |
| Fast Origin Transfer | 2.06 GB | ~4.4 GB | 10 GB | 🟢 44% |
| Fast Data Transfer | 2.07 GB | ~4.4 GB | 100 GB | 🟢 4% |
| ISR Reads / Writes | 6.5K / 699 | negligible | 1M / 200K | 🟢 |

So the "build nothing" branch is dead. But the more important result is that **the cadence model
in this entry accounts for only ~11% of the bill.**

- This entry measured the telemetry route at **5,675 invocations/day**.
- Actual total is **721K / 14 = ~51,500 invocations/day**.
- **~45,800/day — roughly 89% — is not the telemetry route at all.**

**The missing 89% is almost certainly the command poll.** `CommandDaemon.kt:47` sets
`BASE_POLL_MS = 6000L` on a dedicated thread, and the comment at `CommandDaemon.kt:304` states it
is held at that interval **regardless of fast mode**. A continuously running daemon is therefore
`3600/6 × 24 = 14,400 invocations/day/car`, independent of driving/charging/parked state. The
residual divided by that is ~3.2 continuously-polling car-equivalents out of eight cars — a good
fit. `GET /api/bydmate/commands` is also not as cheap as its own comment claims: every poll runs
**three** database round trips (`resolveBydmateApiKeyProfile`, the
`enqueue_due_vehicle_command_schedules` RPC, then the select), even when the queue is empty.

This repeats the exact category error already recorded above for the cloud-offload programme: the
poll was optimised for *Postgres* cost (one indexed read, zero writes) while being the dominant
consumer of the resource that is actually metered (*invocations*).

**Attribution caveat:** the 89% split is inferred from the deterministic poll arithmetic, not read
off a per-route breakdown. Observability Events shows **0**, so the Hobby dashboard cannot break
usage down by route. Confirm before building — see P0 below. **Since 2026-08-19 this is
cheaper to settle:** Pro includes observability the Hobby dashboard did not, so P0 may now be
a matter of reading the per-route breakdown rather than instrumenting for it.

### Revised options — the command poll is now the primary lever

Ranked by invocations removed per unit of user-visible cost:

- **P0 — Confirm the attribution.** Log a counter per route for 48h, or compare the
  `/api/bydmate/commands` count against `/api/bydmate/telemetry` in Vercel's function view. Cheap,
  and everything below depends on it. Do not build blind.
- **P1 — Fold command delivery into the telemetry POST response (recommended).** The daemon
  already POSTs telemetry; return any pending commands in that response and keep a slow
  independent GET (60 s) purely as a floor for the car-off/no-telemetry case. Removes the 6 s poll
  as a separate invocation entirely: **~14,400 → ~1,440/day/car (−90%)**. Command latency then
  tracks the telemetry cadence, which is already fast exactly when it should be (driving, charging,
  fast mode) and slow only when parked with nobody watching. *Risk:* must not re-serialise the two
  network calls on the daemon's status thread — AGENTS.md records that serial round trips were the
  measured cause of 8–9 s status latency. Commands ride the *response* of a POST that already
  happens; the standalone floor poll stays on its own thread.
- **P2 — Adaptive poll interval.** Keep the separate poll but run it at 6 s only when a fast-mode
  window is live or the app-alive beacon is fresh, and 60 s otherwise. Smaller change than P1,
  ~−80% on idle cars, but leaves two request paths where one would do.
- **P3 — Parked telemetry 60 s → 300 s** (option 2 above). Still worth doing, but it now targets
  the ~11% slice, not the bulk. Sequence it after P1.
- **P4 — Serve `/api/bydmate/*` on the old host directly.** Already listed under "Domain migration
  → leftovers": every telemetry sample is currently a `308` plus a re-issued POST. Edge Requests
  (736K) sitting fractionally *above* Function Invocations (721K) is consistent with a redirect on
  a hot path. Halves edge requests for the telemetry path at no freshness cost.
- **Rejected — long-polling the command channel.** Holding the request open would cut invocations
  but bills wall-clock **provisioned memory**, which is already at 104% of quota. It trades a
  red metric for a redder one.

### ✅ Resolved 2026-08-19 — Vercel Pro adopted

Three metrics were over on a fleet of eight cars, and every lever above spends either APK
release cycles or user-visible freshness while the fleet upgrades gradually — so relief
would have arrived over weeks while the overage was immediate. **Vercel Pro was adopted
2026-08-19**, removing the constraint immediately and buying time to do P1 properly rather
than urgently. That was the standing recommendation here and in the now-closed
frontend-hosting entry, whose reasoning is preserved in [CHANGELOG.md](CHANGELOG.md)
2026-08-19.

What this does *not* settle: P1 + P3 were projected to bring invocations to ~200-300K/mo
with Active CPU down proportionally. On Pro that is a billing line rather than a cap, so
check actual Pro usage before deciding whether P1 pays for itself or is only hygiene.

### Risks

- **Edge-triggered pushes must remain immediate.** The daemon already reports gun connect/
  disconnect straight away and wakes at 6 s even when unwatched. Only the *idle rhythm* may
  stretch to 300 s. If an edge push were folded into the slower rhythm, charge-start
  notifications would be delayed by up to 5 minutes — a user-visible regression.
- **Do not touch the 15-minute forced-full rule** (`LIVE_ONLY_MAX_RUN_MS`). Phantom-drain
  analytics (`bydmate_phantom_drain_daily`) discards gaps ≥ 6 h, and that rule is what keeps
  stored parked samples ~15 min apart. Changing *delivery* interval does not affect it — queueing
  and the forced-full rule are separate — but a careless edit here would silently break
  `idle_hours`.
- **Two senders.** `CloudTelemetrySender` (app alive) and `CommandDaemon` (car off) are
  independent and the daemon builds its own payload; a fix in one is not a fix. Car-off is where
  parked actually lives, so the daemon is the one that matters most here.
- Requires an APK release and fleet upgrade to take effect — four of eight cars are on 0.5.0
  as of 2026-07-20, so the benefit arrives gradually.

Proposed 2026-07-20; revised 2026-07-20 against dashboard data; de-escalated 2026-08-19
when Vercel Pro was adopted. P0, P1 and P4 remain open and still await go-ahead.

---

## 🟠 Ingest-time offload counters — make the cloud-offload savings measurable

### Goal

Record, per vehicle per day, how much per-sample server work the client-side offload actually
avoided, so the value of phases 2–4 and the readiness of Phase 6 are observable instead of
argued. Owning sources: `src/app/api/bydmate/telemetry/route.ts` and a new small table.

**Data ownership:** these are **app-owned operational metrics**, not user data and not user
preferences — no client-side storage question arises. They live in **Postgres**, aggregated per
vehicle per UTC day, and carry no telemetry values, only counts.

### Why retrospective measurement cannot work (established 2026-07-20)

Attempted first; it fails for three independent reasons, all worth recording so nobody retries it:

1. **`live_only`'s saving is absent rows.** Phase 2 suppresses the history write entirely, so the
   saved samples never reach `bydmate_telemetry_samples`. You cannot count what was never
   written, and the cars upgraded at different times so there is no clean before/after.
2. **The Phase 0 state classifier is confounded for this purpose.** `speed <= 0.5 and not
   charging → parked` counts stop-and-go driving (1 Hz at traffic lights) as parked, which
   produced an impossible 178–420 "parked rows/hour" against a 30 s heartbeat's 120/h ceiling.
   The classifier is correct for gross state share, its original Phase 0 job, and wrong here.
3. **No matched comparison exists.** Isolating genuinely stationary hours (max speed 0, not
   charging) left exactly one car with ≥5 such hours in 7 days, and it was an old-APK car.

The facts needed are all known **at ingest time** — `route.ts` already parses `live_only`,
`client_hourly`, `client_trip` per sample and knows `hourlyBlocks.length` / `tripBlocks.length` —
and are then discarded.

### Options

1. **Do nothing.** *Pro:* zero cost. *Con:* the offload programme's value stays unmeasured and
   the Phase 6 gate keeps relying on version counts rather than on how much work old clients
   still cause.
2. **Counters table, one upsert per request (recommended).** New
   `bydmate_ingest_counters (user_id, vehicle_id, day_utc, …)` upserted once per HTTP request
   with counts derived from the already-parsed payloads: samples seen, `live_only` suppressed,
   `client_hourly` folded, `client_trip` tagged, hourly/trip blocks applied. *Pro:* directly
   answers "what did the offload save", feeds the existing admin Phase 6 view, and costs **one
   write per request, not per sample** — batches currently average 2.7–11.5 samples, so roughly
   one extra write per ~5 samples against the 5 writes/sample it measures. *Con:* it is still a
   new write on the hot path, and a new table.
3. **Structured logs only.** `console.log` the same counts and read them from Vercel. *Pro:* no
   schema at all. *Con:* short retention, not queryable historically, cannot feed the admin gate
   — fine for a spot check, useless as a trend.
4. **Per-sample path column on `bydmate_telemetry_samples`.** *Rejected:* adds a write and
   storage to the 954 MB table this whole programme exists to relieve.

### Recommendation — option 2

- Migration: `bydmate_ingest_counters`, PK `(user_id, vehicle_id, day_utc)`, integer columns
  `samples_seen`, `live_only_suppressed`, `client_hourly_samples`, `client_trip_samples`,
  `hourly_blocks_applied`, `trip_blocks_applied`, plus `updated_at`. Written only through a
  `SECURITY DEFINER` RPC (`bydmate_record_ingest_counters`) doing a single additive upsert;
  `IF NOT EXISTS`-idempotent per the self-hosted rule.
- `route.ts`: derive the counts from `payloads` (already in memory), fire the RPC **best-effort**
  in its own promise alongside the existing rollup calls — logged on failure, never failing the
  request, never part of ack accounting.
- **Log the failure path explicitly.** The v0.4.9 status ping shipped fire-and-forget with no
  logging and cost a whole test cycle to diagnose; do not repeat that here.
- Derived metrics (trips closed with `client_trip`, and therefore `bydmate_finalize_trip_energy`
  scans avoided) come from `bydmate_trips` and need no counter.

### Risks

- **It adds work to the path being optimised.** One write per request is small relative to the
  5 writes/sample it measures, but it is not free; if invocation cost dominates, prefer option 3.
- **Additive counters are not retry-safe** — a retried request double-counts. Acceptable for a
  diagnostic (the error is bounded by the retry rate and these are trend numbers, not billing),
  but it must be stated in the column comments so nobody later treats them as exact.
- Backfill is impossible for the same reasons the retrospective analysis failed; the series
  starts empty and only becomes useful as the remaining cars upgrade.

### Related finding worth acting on separately

The two fast-mode cars (`way`, `BYD`) show 4.4 and 2.7 samples per batch against 8.4–11.5
elsewhere — `way` at 10,602 HTTP invocations versus `cl`'s 1,455. **Viewer-gated fast status is
pushing invocation count up on exactly the cars where the offload pushed database work down.**
If Vercel invocations rather than Postgres write load are the real cost driver, those two
features are working against each other and the trade needs deciding on numbers. These counters
would make that visible too.

Proposed 2026-07-20; awaiting go-ahead.

---

## Notes / smaller debt

- **Overlapping tariff columns on `profiles`:** legacy `default_price_per_kwh` coexists
  with `home/commercial_ac/fast_dc_price_per_kwh`. The legacy column could be retired.
- **`numeric` for telemetry** that doesn't need exact decimals — `real`/`double precision`
  would be smaller/faster (lat/lon already use `double precision` — inconsistent).
- **Client `isJunkTrip` vs server discard** are out of sync (server is authoritative);
  sync Rules B/C into `trip-filter.ts` only if phantoms surface in the UI. See
  [docs/TRIPS.md](docs/TRIPS.md).

---

## ~~VPS service audit — retire dead tenants on the Supabase host~~ — PARTLY SHIPPED 2026-07-21

> Shipped: immich vhost removed, expired `mykid.ddns.net` cert deleted (certbot dry-run now fully
> green), `caddy` disabled, failed states cleared, 7 GB of Docker images/cache pruned.
> **Corrected during execution:** `/opt/immich` is **20 GB of live photo library data** (4,445 media
> files), not an app directory — the deletion proposed below was withdrawn and the data kept.
> `/opt/ai-gateway` retained at owner's request. See [CHANGELOG.md](CHANGELOG.md).
>
> **Still open:** (a) whether to retire `chat_agent` — its bot has been down 5 weeks on an
> `ImportError` typo (`get_persona_prompt_project_path` vs `get_persona_prompt_path`) and its
> database is **completely empty** (0 users / 0 messages / 0 conversations, 7.8 MB), so it is a
> one-line fix or a clean delete; (b) whether `cadvisor` (~0.2–0.5 core, 4d01h CPU in 26 days) backs
> any dashboard — still unproven, `sqlite3` is unavailable in the Grafana container; (c) whether to
> restore or retire immich itself, given the data is intact but its images were pruned.

### Goal

Reduce what runs on the 3-vCPU Contabo box that hosts production Supabase, after the
`ai-gateway` shutdown. Audited read-only 2026-07-21.

### Correction to the ai-gateway recovery claim

The CHANGELOG entry cites load average 3.05 -> 1.98. **Load average was the wrong metric.**
Re-measured 20 minutes later it is back to **3.11** — but CPU is **57-70% idle** versus **9.4%
idle** before the fix, and user CPU is **18-23%** versus **54.7%**. The fix worked; Linux load
average on this box counts short-lived runnable and D-state tasks (6,400-7,400 context
switches/sec across ~740 tasks) and is not a CPU-saturation signal here. **Judge this host by
`%idle`, not load average.**

### Findings — dead or unneeded

| Item | Evidence | Cost |
| --- | --- | --- |
| `/opt/immich` + `nginx sites-enabled/immich` | **Zero immich containers exist.** vhost still enabled | **21 GB** disk; vhost `proxy_pass`es to `127.0.0.1:8000`, now owned by `supabase-kong` |
| `/opt/ai-gateway` | service disabled 2026-07-21 | **2.7 GB** disk (TensorFlow venv) |
| `caddy.service` | **enabled + failed**, no journal entries; nginx is the real proxy | redundant proxy that could contend for :80/:443 on reboot |
| `chat_agent_bot` | **exited (1) five weeks ago** | its `chat_agent_postgres` still runs (1% CPU, 41 MB) serving a dead consumer |
| `certbot.service` | fails on `mykid.ddns.net` only | VoltFlow certs are healthy to **Oct 12 2026**; the stale cert keeps the unit red so a *real* renewal failure would look identical |
| Docker images/cache | `docker system df` | **12.11 GB** reclaimable images, 824 MB volumes, 1.97 GB build cache |
| Prometheus jobs `Offtech-NextCloud`, `mariadb-nextcloud` | no nextcloud on this host | dead scrape targets |
| `f1-news-bot-f1-news-telegram-1` | **unhealthy 12 days**; sibling leaks the 436 zombie curls | not VoltFlow's to fix |
| `ModemManager`, `iscsi`, `vmtoolsd` | cellular-modem / iSCSI / VMware agents on a KVM VPS | trivial CPU, but pointless |

**Biggest live consumer is now `cadvisor`** — 20-53% of a core, **4d01h accumulated CPU** over 26
days. Prometheus does scrape it. Whether any dashboard or alert *uses* `container_*` metrics is
**unproven** — `sqlite3` is unavailable inside the Grafana container, so the UI-created dashboards
in `grafana.db` could not be checked. Do not drop it on the filesystem grep alone.

**Disk is not under pressure:** 63 GB used of 387 GB (17%). Cleanup is hygiene, not urgent.

### Options

1. **Safe sweep (recommended).** Remove the immich vhost + `/opt/immich`, delete `/opt/ai-gateway`,
   `systemctl disable --now caddy`, `systemctl reset-failed ai-gateway caddy`, remove
   `chat_agent_bot` + its Postgres, drop the stale `mykid.ddns.net` cert so certbot goes green,
   `docker image prune -a`. *Gain:* ~36 GB disk, a truthful certbot signal, one less proxy that can
   fight nginx for :443, and the removal of a vhost pointing at Supabase's own port. *Risk:* low —
   all targets are already dead. Confirm immich and chat_agent are genuinely abandoned first.
2. **Sweep + investigate cadvisor.** As above, plus prove whether `container_*` metrics back any
   dashboard/alert; if not, drop cadvisor for ~0.2-0.5 core. *Risk:* losing container dashboards.
3. **Do nothing.** *Con:* the immich vhost keeps pointing at `supabase-kong`, and certbot stays
   permanently red.

### Recommendation

**Option 1 now** (no VoltFlow dependency, all targets already dead), then option 2's cadvisor
question separately once dashboard usage is confirmed. Leave the f1-news and chat_agent
*applications* alone beyond the exited container — they belong to other projects.

Proposed 2026-07-21; awaiting go-ahead.

---

## ~~Dashboard "Walk to my car" button — pedestrian handoff to the phone's maps app~~ — SHIPPED 2026-08-06

> **Closed 2026-08-11.** Shipped in commit `50a4b75` (2026-08-06 17:13,
> `feat(dashboard, vehicle): add "Walk to my car" button for GPS handoff to maps app`)
> and confirmed by the owner as live in production and working. The plan below is kept
> for the decision record only — no work remains.

### Goal

Add a button below the existing Dashboard content (after `DashboardDeferredSummaries`,
before the `Dialog`) that hands off the vehicle's last known GPS point to the phone's
native maps app for walking directions from the user's current position to the car.
Grilled via `/grill-with-docs` (2026-08-06); every point below is a confirmed decision,
not an open option.

### Research findings

- **The fallback logic this needs already exists**, inline in `LocationCard`
  (`src/components/vehicle/vehicle-live-view.tsx:1657-1753`, rendered on the separate
  `/vehicle` page, not the Dashboard): live snapshot location when fresh, else the last
  trip's final GPS track point (`useLatestBydmateTripsQuery` + `useBydmateTripTrackQuery`).
- **Exact GPS has a hard 24h ceiling for every tier**, not just free. Migration
  `20260720150000_security_gps_retention_and_mate_key_hash.sql`
  (`purge_old_bydmate_telemetry_by_tier()`) zeroes `bydmate_live_snapshots.location` after
  24h **unconditionally** — the `is_user_premium` tier check that protects other tables in
  the same function does not apply to this update. So the live-location half of the
  fallback chain is time-boxed regardless of plan; the last-trip fallback is what carries
  the feature past that window.
- **No existing turn-by-turn maps deep-link in the codebase.** The one precedent
  (`settings-view.tsx` `TariffLocationMapPreview`) links to the OpenStreetMap web viewer
  (a static map, not routable directions) — not reusable for this.
- **Platform detection already exists**: `isIos()` / `isStandalone()` in `src/lib/pwa.ts`,
  already consumed by `install-prompt.tsx` and `start-tracking-button.tsx`.
- **Relative-time formatting already exists**: `formatTimeAgo` (`src/lib/time-ago.ts`) is
  already imported into `dashboard-view.tsx` for an analogous "how long ago did the car
  report" caption (line 758).
- **The base trip-history hooks live in `src/hooks/`**
  (`use-bydmate-trips-query.ts`, `use-bydmate-trip-track-query.ts`), which is where the new
  shared hook belongs.

### Decisions (confirmed in the grilling session)

1. **Location source**: live snapshot (fresh ≤24h) → fallback to the last trip's final
   track point → else no location. Extract this out of `LocationCard` into a shared hook
   `useVehicleLastKnownLocation(vehicleId)` in `src/hooks/use-vehicle-last-known-location.ts`;
   refactor `LocationCard` to consume it instead of duplicating the resolution logic in two
   places (the project's own two-senders lesson in AGENTS.md: a fix in one copy is not a
   fix).
2. **No location at all** → hide the button entirely; no disabled state.
3. **Deep link, platform-branched via the existing `isIos()`**:
   - iOS → `https://maps.apple.com/?daddr={lat},{lon}&dirflg=w`
   - else → `https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=walking`
4. **No `navigator.geolocation` permission requested.** Both URLs above resolve "current
   location" as origin inside the native maps app itself once opened; the app only ever
   needs the destination coordinates it already has.
5. **Hidden while the vehicle is in driving mode** (via the existing
   `deriveDashboardVehicleMode`), in addition to rule 2 — guiding someone to a car they are
   currently driving is nonsensical.
6. **Staleness caption shown**, reusing `formatTimeAgo` + the existing
   `timeAgoSeconds/Minutes/Hours` i18n keys, labeled by source ("last seen" for live vs.
   "from last trip" for the fallback) so the user can judge trust before tapping through.
7. **Label**, matching the app's existing terse verb-first copy (`dashboard.addVehicle`
   "Add vehicle", `dashboard.startCharging` "Start charging") and its "авто" noun choice
   across locales:
   | Locale | Label |
   | --- | --- |
   | en | Walk to my car |
   | be | Дайсці да аўто |
   | ru | Дойти до авто |
8. **Visual weight**: secondary/outline button, matching `charging.checkAgain` /
   `dashboard.signIn`'s existing `variant="outline"` rounded-pill treatment — not the
   primary gradient CTA style (`dashboard.addVehicle`), since this is a convenience
   shortcut, not the dashboard's primary action.
9. **Placement**: new section after `DashboardDeferredSummaries`
   (`dashboard-view.tsx:1414-1428`), before the `Dialog` (line 1432).

### Data ownership and location

No new data model, no new Postgres column, no `localStorage`. Fully read-only against
existing app-owned vehicle telemetry (`bydmate_live_snapshots.location`,
`bydmate_trip_track_points`) — already governed by the existing RLS and 24h/tiered
retention rules, unchanged by this feature. The destination URL is built client-side from
that data and handed to the OS in one shot (`window.location`/anchor `href`); nothing is
written anywhere. This differs from the tariff-location case in AGENTS.md's past-rework
warning — that was new user-preference data needing an ownership decision; this reads an
existing telemetry field and persists nothing new.

Proposed 2026-08-06; awaiting go-ahead. **Should I build this?**

---

## 🟡 Negative-SOC sentinel: Postgres guard shipped 2026-08-10, root cause answered 2026-08-11

> **Status update 2026-08-10.** The sibling issue in this same investigation — a charging
> session closing `completed` short of target on stale math — **shipped and is verified
> working**: commit `1e4ca70` (2026-08-07 21:25, `feat(charging, telemetry): enhance
> session completion logic and sanitize negative SOC readings`) added
> `resolveAutoCompletionProgress()` (`src/features/charging/_server/charging-session-auto-complete.ts`),
> which refuses to complete a session unless server-measured progress has actually reached
> target. Verified against prod 2026-08-10: **zero** sessions have completed short of
> target since the fix deployed (previously 1 of 76). See CHANGELOG.md 2026-08-07. The one
> pre-fix row (`debd8803-2e96-4de1-af90-2c677db9d205`) is still uncorrected — repairing it
> is a separate data-repair decision, not yet made.
>
> The *same commit* also shipped `sanitizeDiplusSoc()` in
> `src/lib/bydmate/telemetry-sanitizer.ts`, intended to fix this entry. **It does not work
> in production.** Re-verifying this entry 2026-08-10 found the leak continuing past the
> fix, so this entry stays open with the new evidence below, promoted to 🟠 since it now has
> a confirmed-ineffective fix rather than just an open question.

### Finding (updated)

`bydmate_telemetry_samples.diplus_soc = -1` continues after the fix commit: **56
occurrences since 2026-08-07 18:25 UTC** (the fix's deploy time), as recent as **this
morning, 2026-08-10 07:17 UTC** (`Bulbazavr`). Original finding (379 occurrences across 9
vehicles since 2026-05-23) is unchanged in nature, just now known to persist post-fix.

### Root-cause trace — the fix targets a field that isn't the one actually written

Traced the full data path from JS sanitizer to the persisted column, live against prod:

1. `sanitizeDiplusSoc()` operates on `item.payload.diplus.soc` and deletes the key when out
   of `{min:0,max:100}`. Confirmed correct in isolation — its own test
   ("drops the DiPlus negative SOC sentinel without discarding valid telemetry") passes, and
   a focused run of both new test files is 10/10 green.
2. The sanitized `diplus` object flows unmodified as `p_diplus` into RPC
   `bydmate_ingest_telemetry` (`src/app/api/bydmate/telemetry/route.ts:247-263`), which
   builds `v_diplus := coalesce(p_diplus, '{}'::jsonb)` and — for non-`live_only` samples —
   calls `bydmate_apply_diplus_columns('public.bydmate_telemetry_samples'::regclass, ...,
   v_diplus, ...)`.
3. That function (read live via `pg_get_functiondef`) sets
   `diplus_soc = public.bydmate_jsonb_numeric($2, 'soc')` where `$2 = v_diplus` — i.e. it
   reads exactly the field the JS layer is supposed to have already stripped.

**So the SQL trace is airtight and the JS fix's own logic is correct — yet -1 still lands
in the column.** That means either (a) the affected traffic never goes through
`sanitizePayloadTelemetry` at all, or (b) something rebuilds/duplicates `diplus.soc` after
sanitization runs, before the RPC call. (a) is more likely given the project's documented
"two senders"/two-ingress-path pattern (AGENTS.md): confirmed the Supabase Edge Function
at `supabase/functions/bydmate-telemetry/index.ts` is, in the *repo*, a pure proxy to the
Next.js route (converted 2026-07-23, predates this fix) — so if it is actually deployed
and NOT stale, it should not bypass sanitization. Ruled out Vercel deploy staleness as the
cause: `vercel ls` shows deployments continuing normally through and after the fix commit,
and the *sibling* fix in the same commit (the completion guard, pure Next.js code) is
confirmed working in prod, so the Next.js deployment is current. **Not yet checked:**
whether the Android Mate app (`BYDMate-own`, a separate repo) calls the Supabase RPC
directly via a Postgres/PostgREST client for some code path, bypassing the Next.js route
(and therefore all JS-side sanitization) entirely — this is the leading remaining
hypothesis and needs the Android source, which isn't in this repo.

### Options

1. **Check the Android Mate app for a direct-to-Supabase ingest path (recommended first
   step).** If some APK version/path posts straight to
   `.../rest/v1/rpc/bydmate_ingest_telemetry_batch` instead of `/api/bydmate/telemetry`,
   sanitization needs to move server-side (into `bydmate_apply_diplus_columns` itself, or a
   `CHECK`/trigger on `bydmate_telemetry_samples`) so it can't be bypassed by any client.
   This matches the project's existing lesson that a fix in one sender is not a fix.
2. **Move the `-1` guard into Postgres regardless of root cause.** Add the range check
   directly inside `bydmate_jsonb_numeric` (or a `CHECK (diplus_soc IS NULL OR diplus_soc
   BETWEEN 0 AND 100)` constraint) so it holds for every ingress path, present and future,
   independent of which sender is at fault. *Pro:* closes the hole regardless of cause,
   defense-in-depth the project already leans on elsewhere (self-hosted `search_path` bugs,
   RLS). *Con:* doesn't explain *why* -1 is arriving, so option 1 is still worth doing to
   understand blast radius (is this only these ~9 vehicles' traffic, or could other invalid
   diplus fields be leaking the same way?).
3. **Leave it.** Same as originally: low but nonzero blast radius (56 occurrences across at
   least 5 vehicles in under 3 days), and now a *known-ineffective* fix sitting in the
   codebase, which risks someone believing this is already handled.

### Recommendation

Do both 1 and 2, in that order — 2 is cheap defense-in-depth and closes the hole
immediately regardless of what's found; 1 explains why the JS-layer fix (which is correct
code, just not on the path this traffic takes) didn't help, and matters for deciding
whether other JS-side telemetry sanitization has the same blind spot.

### ✅ Option 2 shipped 2026-08-10

Migration `20260810120000_guard_diplus_soc_range.sql`: `bydmate_apply_diplus_columns`
now clamps `diplus_soc` to `NULL` whenever the parsed value falls outside `0–100`, via a
`CASE` around the existing `bydmate_jsonb_numeric($2, 'soc')` read — same function serves
both `bydmate_telemetry_samples` and `bydmate_live_snapshots`, so both are covered by one
change regardless of which sender is responsible. Applied to self-hosted prod via `psql -f`
(the CLI can't reach the pooler over TLS). Verified: `pg_get_functiondef` on prod shows the
new `CASE` expression live. This closes the hole even though the root cause (which sender
bypasses the Next.js sanitizer) is still unknown.

**Also applied 2026-08-10:** session `debd8803` (see the sibling entry above) was
backfilled to its live-SOC-correct values — `current_percent: 100`,
`charged_energy_kwh: 22.55`, `estimated_cost: 8.2156415` (was 95.898% / 20.249 kWh / 7.377
BYN) — computed from the same `energyNeededKwh`/`energyFromGridKwh`/`costFromGridEnergy`
formulas the app itself uses (51%→100% on a 45.1 kWh pack at 98% efficiency,
0.36433 BYN/kWh).

### ~~Still open — option 1~~ — ANSWERED 2026-08-11 against the `BYDMate-own` source

The Postgres guard is a backstop, not an explanation, so the question was: why was -1
reaching the RPC despite the JS sanitizer being correct and tested? The leading hypothesis
was that the Android Mate app calls the Supabase RPC directly for some code path, bypassing
`/api/bydmate/telemetry` and all JS-side sanitization.

**That hypothesis is wrong.** Checked directly against
`/Users/way/Dev/Voltflow_Project/BYDMate-own`:

- A grep for `rest/v1`, `/rpc/`, `supabase`, and `bydmate_ingest` across the whole of
  `app/src/main/kotlin/` returns **no matches**. The APK has no Supabase client, no REST
  URL, and no RPC call — there is no bypass path, and there never was one.
- Both senders post to the same HTTP ingest route. The app uses
  `SettingsRepository.DEFAULT_CLOUD_SYNC_URL = "https://voltflow.life/api/bydmate/telemetry"`,
  and `CommandDaemon` normalizes any configured URL back to `…/api/bydmate/telemetry`
  before sending. Everything goes through the sanitized route.

**Actual root cause: the client never filters SOC at all, and -1 is a legitimate Di+
value.** `CloudTelemetryPayload` emits SOC with a bare `putIfPresent("soc", soc)` (both in
the `telemetry` block and the flattened `diplus` block), and a grep for any negative-SOC
guard (`soc in 0`, `>= 0`, `< 0`, `coerce`, `takeIf`) across `app/src/main/kotlin/` returns
**zero hits**. Di+'s -1 unavailable-sentinel is therefore forwarded verbatim, arriving at
`/api/bydmate/telemetry` through the front door.

So the sanitizer was never bypassed — it had a **coverage gap**, exactly as this issue's own
"the fix targets a field that isn't the one actually written" note suspected. The Postgres
clamp plus `sanitizeDiplusSoc` (commit `1e4ca70`) now cover it server-side.

**Follow-up worth doing (small, not urgent):** the same "client sends whatever Di+ reports,
server is the only validator" shape applies to *every* numeric telemetry field, not just
SOC. Any field whose Di+ sentinel falls outside its plausible range has the same exposure.
The durable fix is to keep range rules server-side in `numericTelemetryRules` and make sure
each flattened column is covered — do **not** rely on the APK to filter, since head units
update on their own schedule and an old APK will keep sending sentinels for a long time.

### Data ownership and location

No new data model. Same as originally: a validation change to existing app-owned ingest
(`bydmate_telemetry_samples`, `bydmate_apply_diplus_columns`) in Postgres.

Postgres guard + data repair shipped 2026-08-10; root-cause investigation (option 1) still
awaiting go-ahead if wanted.

---

## 🟡 Dashboard live-charging tile can still show a stale kW after a real stop, even though auto-stop is now fixed

Follow-up to the auto-session fix shipped 2026-08-14 (see CHANGELOG.md) for car `way`'s
stuck `charge_power_kw`. That fix closed the actual data-integrity bug (a `charging_sessions`
row could stay open indefinitely, and energy/cost keep accruing, past a real stop). This
entry is the cosmetic half deliberately left out of that go-ahead.

### Goal

Stop the dashboard's live-charging tile (and its ~5.7–5.8 kW-style power reading) from
showing "still charging" off a Di+ reading that's stuck on a cached value, independent of
whatever `charging_sessions` now correctly does.

### Finding

The tile's visibility gate — `vehicleMode === "app_charging" || "live_charging"`
(`src/components/dashboard/dashboard-view.tsx:1035`) — comes from
`deriveDashboardVehicleMode` (`src/lib/vehicle-live-mode.ts`), which calls
`isChargingTelemetry` → `isTelemetryCharging` directly against the latest live snapshot.
This is **independent of `charging_sessions.status`** by design (it's meant to show live
truth even before/without an app-tracked session) — so even after the shipped fix closes
the Postgres row, the tile can keep showing "Charging, 5.7 kW" for as long as Di+ keeps
re-sending the frozen reading on each parked heartbeat. The displayed number itself,
`resolveDisplayChargePowerKw` → `snapshotChargePowerKw`
(`src/features/charging/_domain/charging-live.ts:60-63,110-124`), reads
`latestBydmateSnapshot.telemetry.charge_power_kw` straight off the single current row with
no staleness/"unchanged" check of its own.

The auto-session fix's frozen-detection logic isn't a straightforward port here. It lives
in a stateful reducer (`nextAutoChargingSessionStep`) fed one authenticated ingest batch at
a time, persisting its "unchanged since" tracking server-side per user/vehicle in
`bydmate_auto_charging_session_state`. The dashboard tile, by contrast, is a client-rendered
pure function over a single `BydmateLiveSnapshotRow` — the latest upserted row in
`bydmate_live_snapshots`, which holds only current state, no history to diff against at
read time.

Also: `isTelemetryCharging` (which `isChargingTelemetry` wraps) has ~6 call sites —
dashboard live mode, the Telegram widget (`live-widget.ts`), drive-away detection,
vehicle-control guards, charge notifications, and reconciliation history — and CHANGELOG
2026-07-27 already flagged that reordering/changing this classifier needs its own proposal
because of that fan-out, not a fold-in to an unrelated fix.

### Options

1. **Persist "unchanged since" on `bydmate_live_snapshots` itself.** Add
   `charge_reading_unchanged_since` (+ a tracked last-power value), updated by the ingest
   RPC (`bydmate_apply_diplus_columns` or the live-snapshot upsert path) on every sample —
   mirroring the columns just shipped on `bydmate_auto_charging_session_state`, but scoped
   to the single always-current live row. Any downstream pure classifier
   (`isTelemetryCharging` and all ~6 call sites) could then consult it without needing full
   history. *Con:* touches the ingest RPC / snapshot upsert path — per AGENTS.md's own
   hard-won "two senders" rule, the highest-blast-radius part of the stack, since both
   `CloudTelemetrySender` and the `CommandDaemon` build their own payloads independently.
2. **Query recent `bydmate_telemetry_samples` history server-side** when building the
   dashboard page (last ~15 min for the active vehicle) and thread a computed "frozen"
   flag/duration down as a prop. *Con:* an extra query per dashboard load/live-refresh for
   a high-frequency table not indexed for this access pattern — cuts against the project's
   documented egress/CPU cost sensitivity (`docs/archive/EGRESS_CPU_MASTER_PLAN.md`).
3. **Reorder `isTelemetryCharging` to compare against the previous live snapshot.** Needs
   every one of its ~6 call sites to pass two snapshots (current + previous) instead of
   one, and per CHANGELOG 2026-07-27 needs a dedicated proposal given how many independent
   behaviors (Telegram widget, push notifications, vehicle-control guards, etc.) would
   change together.
4. **Leave the tile as-is.** The severe part — stuck-open session, ongoing energy/cost
   accrual — is already fixed. What's left is a cosmetic "still shows charging" tile for up
   to ~10–12 minutes past a genuine stop, self-correcting the moment the car is driven or
   Di+ sends a changed reading.

### Recommendation

Option 1 is the "do it right" fix and is the only one that also covers the other 5
`isTelemetryCharging` call sites, which share this exact exposure today just less visibly
(e.g. the Telegram widget could show the same stale "charging" state). Given the acute bug
is already resolved, treat this as deliberate follow-up rather than urgent, and do it
together with — not before — actually explaining *why* `way`'s gun state and power
readings both go stale in different ways (still an open question across the 2026-07-22,
2026-07-27, and 2026-08-13 investigations); a single ingest-path pass can address both.

### Data ownership and location

App-owned telemetry either way (`bydmate_live_snapshots` or `bydmate_telemetry_samples`),
already in Postgres — no new ownership question. Option 1 needs a migration on
`bydmate_live_snapshots` plus an ingest-RPC change, applied to self-hosted prod via
`psql -f` per AGENTS.md (the CLI can't reach the pooler over TLS).

---

## 🔵 Cell-voltage-spread (ΔV) health tracking — earlier bottleneck warning than SOH%

### Idea (user proposal, 2026-09-14)

Track per-cell voltage spread (ΔV) and its behavior under load/charging, plus signs of
rising internal resistance in individual cells, as an earlier warning of a future pack
bottleneck than an aggregate `SOH%` figure. Asked to check on-car whether Di+ actually
provides this data before designing anything.

### Evidence — checked against the running app, docs, and the actual car (2026-09-14)

**ΔV is already captured and stored — no new capability needed.**
`src/lib/voltflowmate/ingest-payload.ts` (`telemetrySchema` L29-62, `diplusSchema` L64-114)
and `src/app/api/bydmate/telemetry/route.ts`'s `expectedCellVoltage()` (L77-99) already
compute/store `telemetry.cell_voltage_min_v` / `cell_voltage_max_v` / `cell_delta_v` and
`diplus_min_cell_voltage_v` / `diplus_max_cell_voltage_v` / `diplus_cell_delta_v`, flattened
as columns on both `bydmate_telemetry_samples` and `bydmate_live_snapshots`
(migrations `20260519120000`, `20260521120000`, `20260708130000`). Two further places
already track it as a trend rather than an instant value: `charging_sessions
.end_max_cell_delta_v` (peak ΔV reached by the end of each charge, `20260717120000`) and
`bydmate_battery_snapshots.cell_delta_v` (a periodic snapshot alongside `soh_percent`,
`20260708140000`). None of this is documented in `docs/CHARGING_SESSIONS.md` today despite
living on `charging_sessions`.

**Only pack min/max/delta reach us — no true per-cell array.** Every ingest schema uses
Zod `.strip()`, so any key the Android app sends that isn't explicitly named is silently
dropped before Postgres ever sees it (already bit us once per `ingest-payload.ts` L54-59,
`soc_source` going missing on first on-car test). `diplusSchema` only names ~40 fields;
nothing resembling a per-cell voltage array or an internal-resistance field is named
anywhere in schema, sanitizer, DB columns, or docs.

**Confirmed live on the car via wireless ADB** (head unit reachable at `192.168.43.71:5555`,
`product:DiLink3.0 model:DiLink3_0_For_BYD_AUTO`, only while this Mac shares its tethered
network — this link, and the on-car verification rules in memory `lsn_ed206bdb310ca51f`,
came from agentmemory, not from this session's own history):
- `com.van.diplus` (the third-party Di+ bridge app) is installed at `versionName=2.0.0b6`.
  Its granted-permissions dump shows exactly two BMS-adjacent permission buckets:
  `BYDAUTO_CHARGING_GET`/`_COMMON` and `BYDAUTO_ENERGY_GET`/`_COMMON`. No
  `BYDAUTO_BMS_*` or `BYDAUTO_BATTERY_*` permission group exists at all in this Di+
  version's manifest — BYD's own permission model has no discrete "battery health"
  capability to request, only the two coarse buckets cell-voltage data already rides on.
- Our own installed app (`dev.scroodge.cloudevmate`) requests **no** `BYDAUTO_*`
  permissions itself; it must be reading through `com.van.diplus`'s already-granted
  access rather than declaring its own, so a future Di+ signal is only reachable if that
  bridge app exposes it.
- Attempting to pull `dev.scroodge.cloudevmate`'s APK over the wireless link for a static
  string search (to look for any `FID_`-style signal name suggesting a not-yet-wired
  resistance field) produced a truncated, non-zippable file — the link was too slow/
  unstable for that pull. Not re-attempted; not needed for the conclusion below.

**No internal-resistance signal found anywhere** — not in this repo's schemas, sanitizer,
migrations, or docs, and not as a named permission bucket in the currently-installed Di+
app. This reads as a genuine capability gap at the current Di+ version rather than an
unmapped field we already receive and discard.

### Options

1. **Build a ΔV trend view from data already stored (recommended first step).** Chart
   `charging_sessions.end_max_cell_delta_v` (peak-of-charge trend) and
   `bydmate_battery_snapshots.cell_delta_v` (periodic parked/idle trend) per vehicle over
   time, flagging a rising trend. No new column, no ingest change, no migration — this is
   the direct answer to "is my pack's cell spread getting worse," reusing exactly the
   diagnostic idea's premise (a trend beats a point-in-time SOH number).
2. **ΔV-under-load correlation.** Join `cell_delta_v` against `charge_power_kw` (or drive
   power) at matching timestamps in `bydmate_telemetry_samples`, both already stored in the
   same rows, to see whether spread widens disproportionately at high current — the closest
   available proxy for rising internal resistance without a new raw signal. New
   query/aggregation only, no new capture.
3. **Chase a real internal-resistance signal.** Not pursued now — no evidence it exists at
   the installed Di+ version. Would need a newer `com.van.diplus` release, BYD protocol
   documentation, or a differently-scoped third-party bridge; premature to design storage
   for a field we cannot currently observe.
4. **Do nothing beyond recording availability here.**

### Data ownership and location

No new data model and no migration for options 1-2 — every field involved
(`charging_sessions.end_max_cell_delta_v`, `bydmate_battery_snapshots.cell_delta_v`,
`bydmate_telemetry_samples.cell_delta_v`/`charge_power_kw`) already exists as app-owned
telemetry in Postgres, scoped by `user_id`/`vehicle_id` like the rest of the pipeline.
Both are read/aggregation work only.

### Recommendation

Build option 1 first — cheap, uses history that already exists, and directly delivers the
user's diagnostic idea (trend over point-in-time SOH%). Follow with option 2 if the trend
view proves useful. Leave option 3 (internal resistance) parked until a raw signal is
confirmed to exist on a newer Di+ release.

**Superseded 2026-09-14** by the broader "Battery Consistency / Battery Health" proposal
below, which subsumes option 2 (ΔV-under-load) as its phase 2 and supplies a canonical
calculation layer instead of an ad-hoc per-chart toggle.

---

## 🔵 Battery Consistency / Battery Health diagnostics (spec proposal, 2026-09-14)

### Goal (user-supplied spec)

Diagnose **HV pack consistency** — not individual cells — using cell-voltage spread
(`cellDeltaMv = (cell_voltage_max - cell_voltage_min) * 1000`), tracked as a **trend**
across comparable operating contexts (top-of-charge first; mid-SOC-rest and under-load
later), shown alongside (not merged with) vehicle-reported `SOH%`. Hard constraints from
the spec: never claim to identify a specific weak cell, never compute fake per-cell
internal resistance, never call ΔV "internal resistance", never treat missing telemetry
as zero, never mix incompatible operating contexts into one trend line, keep thresholds
provisional/centralized/documented.

### Architecture assessment — what already exists vs. what's missing (verified 2026-09-14)

**1. SOH source.** No `FID_SOH` (or any FID/autoservice SOH field) exists anywhere in the
repo — `supabase/migrations/20260708130000_add_autoservice_fid_fields.sql` adds
`autoservice_soc_percent`, `_power_kw`, `_gun_state`, `_bms_state`, `_charge_capacity_kwh`,
`_charge_battery_volt`, `_battery_type`, `_lifetime_mileage_km`, `_lifetime_kwh` — no SOH.
The only SOH anywhere is `telemetry.soh_percent` (`ingest-payload.ts:46`), the Mate
Android app's own on-device estimate. **There is no more-authoritative "vehicle-reported"
SOH to defer to.** The spec's "if FID_SOH exists, use it" branch does not apply; the UI
must keep labeling this figure as an app-side estimate, not upgrade its wording.

**2. Battery temperature.** Only a single average exists: `telemetry.battery_temp_c`
(`ingest-payload.ts:34`, clamped `-50..90` in `telemetry-sanitizer.ts:51`), rolled up as
`battery_temp_avg` (multiple migrations) and `diplus_avg_battery_temp_c`
(`20260521120000:38`). **No min/max battery temperature exists anywhere in the ingest
schema.** A dev-only fixtures page (`src/app/dev/bydmate-diplus/page.tsx:67,69`) lists
`max_battery_temp_c`/`min_battery_temp_c` as *display keys with no column mapping* — the
real Zod validator (`diplusSchema`, `ingest-payload.ts:64-114`, which `.strip()`s anything
unnamed) has no such keys, so even if Di+ ever sent them today they'd be silently dropped.
One migration (`20260826194941_telemetry_day_buckets.sql:64-65`) computes
`battery_temp_min`/`battery_temp_max` as `MIN()`/`MAX()` of the **daily average across
samples** — not a true simultaneous pack Tmin/Tmax. **`temperatureSpreadC` cannot be
computed today — this is a confirmed capability gap**, the same shape of gap as the
internal-resistance finding above. Per the spec's own rule ("do not force this metric if
data isn't available"), this diagnostic must be omitted, with the UI/docs saying so
explicitly rather than silently dropping it.

**3. Threshold convention.** No central config file — constants are exported `const`s
colocated with the logic that uses them, each with an explanatory comment, e.g.
`export const CHARGING_DRIVE_SPEED_KMH = 5;` (`charging-live.ts:14`),
`export const AUTO_CHARGING_ZERO_POWER_STALL_MS = 5 * 60_000;`
(`charging-auto-session-step.ts:41`). New provisional ΔV/status thresholds should follow
this exact pattern (one exported, commented constant per threshold), not a new config module.

**4. Existing robust/median pattern.** The project already has the idiom needed for "a
representative value over noisy samples":
`percentile_cont(0.5) within group (order by voltage) filter (where voltage between 6 and
18)` in `20260826210000_aux_voltage_resting_chemistry_ceiling.sql:78` (aux-voltage
rollup). Reuse this verbatim rather than inventing a new robust-stat approach.

**5. The key finding — a top-of-charge capture hook already exists and is already wired
everywhere, but uses a raw single-sample max.** `bydmate_capture_session_end_delta(p_session_id
uuid)` (current definition: `supabase/migrations/20260717130000_charge_end_delta_peak_soc.sql`,
`create or replace`-idempotent) already builds a `charging_samples` CTE over
`bydmate_telemetry_samples` bounded to the session's `[started_at, stopped_at]` window,
finds `peak_soc`, and picks one row via `order by cs.delta desc limit 1` (lines 47-76) —
**exactly the "single noisy measurement" problem the spec warns against, already shipped**.
It's called from all three session-close paths: manual stop (`actions.ts:83,214`), atomic
auto-close (`charging-auto-session-atomic.ts:83`), and reconciliation
(`charging-session-reconcile.ts:131`), writing `end_max_cell_delta_v` / `end_delta_soc` on
`charging_sessions`. **This is the natural, already-wired extension point**: add a
`percentile_cont(0.5)` computation over the *same* CTE, into one new nullable column —
zero new call sites needed, all three close paths get the new value for free.

**6-8 (carried from earlier research this session).** `SohTrendChart` and
`ChargeDeltaTrendChart` already render together in
`src/components/vehicle/vehicle-analytics-panels.tsx:793-886` (History → Analytics tab) —
the natural home for a cross-session "Cell consistency" section. The per-session chart
(`charging-delta-card.tsx`, on `/history/[id]`) hardcodes English strings despite matching
i18n keys already existing (`cellDeltaTitle`, `deltaBySoc`, `chargePower`, …) — a
pre-existing inconsistency, not something this feature must fix. `docs/CHARGING_SESSIONS.md`
documents neither `end_max_cell_delta_v` nor `end_delta_soc` today; `docs/DATABASE_SCHEMA.md:139-140`
is the only canonical wording that exists.

### Proposed smallest clean implementation (phase 1: top-of-charge only)

1. **One additive migration.** Extend `bydmate_capture_session_end_delta()` (still
   `create or replace`, still idempotent) to also compute
   `percentile_cont(0.5) within group (order by cs.delta) filter (where cs.soc >= peak.peak_soc - 1)`
   over its existing CTE and store it in a new nullable
   `charging_sessions.end_median_cell_delta_v numeric` column. `end_max_cell_delta_v` is
   left untouched (existing chart keeps working unchanged). No new table, no new trigger,
   no new call site.
2. **One canonical calculation module** (new file, e.g.
   `src/lib/voltflowmate/battery-consistency.ts`), covering: `cellDeltaMv` conversion
   (null-safe — missing Vmin/Vmax must stay `null`, never `0`), a trend comparison against
   the previous comparable measurement, and a provisional status label
   (`Excellent`/`Good`/`Watch`/`Poor`) via centrally-exported, commented threshold
   constants per finding 3 — explicitly marked provisional in a code comment, not derived
   from any external standard. `diagnostic_context` starts as a single literal
   `"top_charge"` (mid-SOC-rest / under-load deferred to phase 2, see below) so nothing
   ever mixes incompatible contexts on one trend line. SOH is passed through from
   `telemetry.soh_percent` and always labeled as an app-side estimate (finding 1).
   Temperature spread is not implemented (finding 2) — the module and UI say
   "insufficient data" rather than a fabricated 0/omitted-silently value.
3. **`db-map.ts` + selects.** Add `end_median_cell_delta_v: nullableNum(...)` next to the
   existing `end_max_cell_delta_v` mapping (`db-map.ts:127`), and add the column to the
   existing select lists that already carry `end_max_cell_delta_v`
   (`dashboard-bootstrap.ts:16` and wherever `use-sessions-query.ts` is fixed per AUD-15
   above — coordinate rather than duplicate that fix).
4. **UI: one new "Battery Health" section** in `vehicle-analytics-panels.tsx`, beside the
   existing SOH/ΔV sections, matching their custom-inline-SVG chart style (no new charting
   library). Shows: SOH (labeled "estimated by app"), cell consistency
   (`end_median_cell_delta_v` trend in mV, "Insufficient comparable measurements" when
   fewer than N sessions qualify), and a short explainer plus one info-tooltip stating
   plainly that VoltFlow cannot identify an individual weak cell because Di+ reports only
   pack min/max, not per-cell voltages (reusing the finding already written into the ΔV
   entry above).
5. **Historical backfill:** leave pre-existing closed sessions' new column `null` rather
   than backfilling — the median CTE only differs from the already-correct max capture in
   aggregation, so a backfill is cheap and safe (same pattern as the `20260717130000`
   migration's own recompute-every-closed-session `do $$ … $$` block) **if desired**, but
   is not required for the feature to work going forward; flag as an explicit yes/no choice
   before implementation rather than assuming it.
6. **Docs.** Add `end_median_cell_delta_v` to `docs/DATABASE_SCHEMA.md`, and add the
   missing `end_max_cell_delta_v`/`end_delta_soc`/new-column section to
   `docs/CHARGING_SESSIONS.md`, plus the same "what Di+ does/doesn't give us" limitations
   paragraph already drafted in the ΔV entry above (single source of truth for that
   wording — do not restate it differently in two docs).
7. **Tests.** Pure-function tests for the new module: `3.324 - 3.317 = 7mV` conversion;
   missing Vmin → `null`; missing Vmax → `null`; negative voltage rejected; median vs. max
   over a synthetic noisy window; contexts never mixed (a `"top_charge"` point and a
   hypothetical future `"under_load"` point never appear on the same computed series).
   Temperature-spread has no positive test — only a "returns unavailable, never fabricates
   a spread" case, since finding 2 confirms there's nothing to compute.

### Explicitly deferred (not phase 1)

Mid-SOC-rest (`midSocRestDeltaMv`) and under-load (`loadedDeltaMv`) contexts are additional
`WHERE`-clause variants of the same CTE shape (SOC and `charge_power_kw`/speed are already
in every `bydmate_telemetry_samples` row) and can follow once the top-of-charge median
ships and is validated — not built simultaneously, per the spec's own "do not force a
metric" principle and to keep the first migration reviewable. Temperature-spread stays
deferred indefinitely, pending an actual Tmin/Tmax field ever reaching the ingest schema.

### Data ownership and location

App-owned telemetry, no new ownership question. One new nullable column on the existing
`charging_sessions` table (already app-owned, already in Postgres, already migrated via
`psql -f` per AGENTS.md self-hosted rules) plus a client-side calculation module reading
already-stored fields. No new raw telemetry storage (spec's own constraint honored) and no
localStorage involved — this is diagnostic, not user preference, data.

### Open question before building

Backfill or not (see implementation point 5) — needs an explicit yes/no, since it changes
whether historical sessions ever show a "Cell consistency" trend or only sessions closed
after the migration ships.

**Resolved 2026-09-14: build phase 1, no backfill.**

### Implementation status (2026-09-14): local implementation complete, migration NOT applied to prod

Built and verified locally:
- `supabase/migrations/20260914120000_charge_end_delta_median.sql` — additive
  `end_median_cell_delta_v` column + `create or replace` of `bydmate_capture_session_end_delta()`
  to also compute the median. Not yet applied to the self-hosted production database (needs
  `psql -f` per `docs/OPS_LOCAL.md`; a separate explicit go-ahead before running it, since it's
  a production database write).
- `src/lib/voltflowmate/battery-consistency.ts` — canonical calculation module (trend, provisional
  status/trend classification, SOH-estimate labeling, temperature-spread "unavailable" result).
- `src/lib/voltflowmate/battery-consistency.test.mjs` — 13 tests, all passing, covering the
  spec's own minimum list (7mV conversion, missing/negative delta rejected, temperature always
  unavailable, SOH always app-estimate, contexts not mixed, median-based trend resists a single
  noisy session, empty-history honesty).
- `db-map.ts`, `types/database.ts`, `dashboard-bootstrap.ts`'s select list, and the dev-only
  `build-mock-charging-session.ts` fixture all updated for the new field.
- New "Battery health" section in `vehicle-analytics-panels.tsx` (History → Analytics tab,
  between the existing SOH and ΔV-chart sections): SOH (labeled as app estimate) + cell
  consistency (median mV, status/trend badges) + the two limitation footnotes (no per-cell
  diagnosis, temperature spread unavailable). i18n keys added to all three locales (en/be/ru).
- `docs/DATABASE_SCHEMA.md` and `docs/CHARGING_SESSIONS.md` updated with the new column and a
  "Battery Consistency diagnostics" section documenting the hard constraints.

Verification: `npm run test` — 491 pass, 3 pre-existing documented failures unrelated to this
change (see "Proposed — failures exposed by complete test discovery" above), including the 13
new tests. `npm run build` — clean, exit 0.

**Applied to production (2026-09-17):** `20260914120000_charge_end_delta_median.sql` is live
— `end_median_cell_delta_v numeric` confirmed present on `charging_sessions`. Applying it
surfaced an inherited privilege gap: `bydmate_capture_session_end_delta(uuid)` was callable
by `anon` (its `revoke ... from public` line, unchanged since `20260717130000`, never
explicitly revoked from `anon` — the same class of gap fixed for 19 other functions on
2026-09-11). Practical risk was low (the function is `security invoker` and every table it
touches is RLS-scoped to `auth.uid()`, null for anon), but closed anyway with
`20260917110000_harden_charge_end_delta_privileges.sql`, also applied — verified
`has_function_privilege` now returns `anon=false, authenticated=true, service_role=true`.

**Not done yet, needs a separate go-ahead:** committing/pushing (nothing has been committed
this turn).

---

## 🔴 Client-finalized trips bypass the junk filter — odometer-scale phantom `distance_km` (found 2026-09-17, user report)

### Finding (DB + source verified)

User `nikolayushak1998@gmail.com` reported History → Analytics → "Пробег" showing the whole
day's odometer instead of the day's driving distance. Screenshot: 7 Sep 2026, day card and
period-summary card both show **37709 km**.

Traced in prod (`bydmate_trips`, read-only): that day has 6 normal trips summing to ~84.8 km,
plus one row `370c4a6a-…`, `client_trip=true`, `distance_km=37624.6`, duration 341s, max speed
64 km/h → **implied average speed 396,986 km/h**. 84.8 + 37624.6 = 37709.4 ≈ the value shown.
A second one exists on the same account: `5f556b02-…`, 2026-08-02, `distance_km=33141.1`,
duration 1652s, max speed 74 km/h → implied 72,218 km/h. Both are classic "inherited trip-meter
phantom" values per `docs/TRIPS.md` Rule C (`distance*3600/duration_s > max(max_speed*1.5, 80)`),
just at odometer scale instead of the smaller inflation the doc already describes — the Android
app's own cumulative-block distance computation, not the server telemetry path, produced these.

The UI aggregation (`src/lib/history-day-summary.ts`, `src/lib/voltflowmate/telemetry-buckets.ts`)
is correct — it sums `trip.distance_km` for trips in range. The corruption is in the row itself.

**Root cause, live-DB-verified** (`pg_get_functiondef('public.bydmate_apply_client_trip')`):
this function (client-owned trip finalization from the Mate Android app's cumulative `trips[]`
block, `docs/TRIPS.md` "Client-owned trip finalization") writes
`distance_km = coalesce(nullif(p_block->>'distance_km','')::numeric, distance_km)` — the
client-reported value verbatim, no baseline-delta recomputation — and **never calls
`bydmate_discard_trip_if_junk`**. That filter only runs from the legacy/daemon telemetry
Open→Extend→Close state machine (per `docs/TRIPS.md` "Lifecycle" → "Close"), not from the
client-trip finalization path. So a bad reading from the app (reads the car's total odometer
instead of a trip delta — same failure class the doc already names, but on the client this time)
is persisted and displayed as-is, with no server-side sanity check at all on this path.

Not a one-off: 2 occurrences on 1 account 5 weeks apart. Will recur for this user and plausibly
for others (scan pending, see below).

### Options

1. **(Recommended) Run the existing `bydmate_discard_trip_if_junk(p_trip_id)` at the end of
   `bydmate_apply_client_trip`, only when the block carries `ended_at` (i.e. the trip actually
   closes) — same trigger condition already used for the finalization-audit insert.** Reuses the
   already-tested Rules A/B/C (zero-distance jitter, short-low-speed maneuvers, physically
   impossible implied speed) as the single source of truth for "is this trip junk," exactly the
   check that would have caught both phantom rows here. Minimal diff: one `perform` call added
   to an existing `CREATE OR REPLACE FUNCTION`, no schema change. Verified safe against the
   deferred `bydmate_refresh_trip_insight_input_on_close` trigger and the
   `bydmate_trip_finalization_audits` `ON DELETE CASCADE` FK — this is the same "audit region,
   then possible delete" ordering the legacy Close path already relies on
   (`docs/TRIPS.md`: "deferred trigger runs after junk-trip deletion, so discarded rows have no
   projection").
2. Add a separate plausibility clamp/reject inside `bydmate_apply_client_trip` (mirror Rule C's
   formula inline, but fall back to the previous `distance_km` instead of deleting the trip).
   Preserves the trip's real energy/SOC/GPS data for the ~4-30 min of genuine driving instead of
   discarding the whole event. More new logic to maintain in parallel with the existing filter;
   duplicates a threshold that already exists and is already documented as the fix for exactly
   this phantom-distance class.

**Recommendation: option 1.** It's the smallest change, reuses code the junk-filter docs already
say is meant for this exact case, and keeps one authoritative definition of "junk trip" instead
of two. Trade-off accepted: the ~4-6 min of genuine driving inside a junk-tagged client trip is
discarded along with the corrupt distance (same as every other trip the filter already deletes
today) — its energy/SOC data isn't separately recoverable without option 2's extra bookkeeping,
which isn't justified for a handful of trips per incident.

### Data ownership and location

No new data model — app-owned telemetry pipeline, existing `bydmate_trips` table, existing
`bydmate_discard_trip_if_junk` function. No user-facing preference/tariff/location data touched.

### Plan (user-approved 2026-09-17: "исправь код... после этого надо будет пофиксить значения
этого пользователя и в самом конце просканировать базу на наличие подобных багов у остальных")

1. Ship option 1 as a new idempotent migration (`CREATE OR REPLACE FUNCTION`), applied to
   self-hosted prod via `psql -f` per `docs/OPS_LOCAL.md`.
2. Delete this user's 2 confirmed phantom rows (`370c4a6a-…`, `5f556b02-…`) via
   `bydmate_discard_trip_if_junk`, the same function the fixed code now calls automatically —
   not a manual ad hoc DELETE.
3. Run the `docs/TRIPS.md` Rule A/B/C preview query (read-only, `begin read only … rollback`)
   across **all** users to find any other already-stored junk rows the old code let through, and
   report findings before deleting anything for other accounts (separate go-ahead for those).

---

## 🟠 Premium monetization: visible entitlement badge, feature-gating upsell, and a payment-registration admin (proposed, 2026-09-17)

### Current state (verified in this checkout)

- Entitlement already exists as two Postgres columns: `profiles.is_premium` (manual flag) and
  `profiles.premium_until` (term expiry), combined with `admin_users` membership by the single
  canonical predicate `resolveEffectivePremium()` (`src/lib/premium-entitlement.ts`). Every
  server check (`isDashboardEntitled`, `retention-status`, `admin_users_*` RPCs) already goes
  through it — good, keep doing that.
  Only two features are actually gated today: (1) the car head-unit cluster/dashboard screen
  projection (`isDashboardEntitled`), and (2) telemetry/trip/route retention — 30 days free vs.
  retained while active for premium/admin (`docs/PREMIUM_ADMIN.md`).
- The only free-tier "you're missing something" UI is one card, `FreeRetentionNotice`
  (`src/components/premium/free-retention-notice.tsx`), shown in Settings only, only about
  retention days. There is **no premium badge anywhere** — a premium user looks identical to a
  free user everywhere in the app today.
- "Buying" premium is fully manual: the free-tier card links to `/support` and shows a mailto
  to the owner's personal inbox (`src/lib/premium-upgrade-mailto.ts`); there is no payment
  gateway anywhere in this repo (checked — no Stripe/YooKassa/PayPal/etc.). The admin side
  already has real tooling: `/admin/users` → `AdminUsersPanel` lets an admin filter by premium
  state and grant/clear premium via a manual flag + `premium_until` date picker with +30/90/365d
  presets (`src/app/api/admin/users/[id]/premium/route.ts`). That already covers most of "удобный
  механизм... выключения premium функций" — it does not yet record *why* premium was granted
  (no amount, method, or reason), only the resulting date.

### Blocking prerequisite — do not build more gates on top of this

**AUD-02** (logged above, unresolved): `profiles.is_premium` and `premium_until` are writable by
the owning authenticated user through the normal own-row RLS policy, with no protective trigger.
A user can currently self-grant premium with a raw REST `PATCH` to their own profile row —
every entitlement check in the app (including the new badge/gates this plan proposes) trusts
those same two columns. Shipping more visible premium gates before this is fixed makes the hole
*more* attractive to find, not less. **AUD-16** (also logged above) is the same
`FreeRetentionNotice` surface this plan extends, so fold its "unbounded retention, not 365 days"
copy fix into the same pass rather than editing that card twice.
**Recommendation: fix AUD-02 and AUD-16 first**, as their own approved backlog items, before any
of the phases below touch `profiles`-derived UI.

### Data ownership and location — confirmation required before implementation

- Entitlement state (`is_premium`, `premium_until`, `admin_users`) is **unchanged**: already
  app-owned Postgres data, not a user preference, not localStorage. This plan does not move it.
- A new payment record (Phase 4 below) would also be **app-owned operational/administrative
  data in Postgres**, admin-only RLS — never user-owned, never localStorage, and never written
  by the client the payer uses.

### Phase 1 — Visible premium badge (low risk, cheap, do first after the security fix)

Show a small "Premium" badge wherever identity/account state already renders (Settings account
header, and optionally the vehicle/dashboard header). Source it from the same server-resolved
`resolveEffectivePremium()` result the app already computes for retention/dashboard checks
(e.g. a small `/api/me/entitlement` read, or pass it down from a server component) — **not** a
raw client read of `profiles.is_premium`, so the badge can't be spoofed the same way AUD-02
describes and stays correct the moment that fix ships.

### Phase 2 — Reusable "locked feature" upsell pattern

Generalize `FreeRetentionNotice` into a shared `PremiumFeatureGate`/locked-card component:
feature preview + lock icon + one-line benefit + upgrade CTA, reusing the existing `/support`
flow. Every feature chosen in Phase 3 renders through this one component instead of bespoke
copy per feature, so the tone stays consistent and the payment-flow decision in Phase 4/5 only
has to change one place.

### Phase 3 — What to gate (a menu, not a decision — needs your picks)

Keep free (these build the trust/network effect that turns free users into buyers — gating them
would cut the funnel that produces premium purchases, matching your ask not to kill interest in
the app's unique features): core charging-session and trip tracking, live status, knowledge base
+ semantic search, community listings, service records/reminders themselves.

Already gated, no change needed: cluster/dashboard car-screen projection; >30-day telemetry/
trip/route retention.

Candidates to add (pick some, not necessarily all):

| Candidate | Why it's a safe cut for free | Why premium wants it |
| --- | --- | --- |
| Deep Battery Consistency / SOH diagnostics view (shipped 2026-09-17, commit `b97aa4d`) | New, not part of daily charging workflow; free keeps a basic SOH number | Enthusiast/long-term-ownership feature, high perceived value |
| Formalize viewer-gated "fast" 3–9s live refresh (`profiles.live_fast_until`) as premium | Currently free for any viewer; not core to using the app day-to-day | Directly visible, tangible speed perk while watching the car |
| Full-history data export (cap free export at the same 30-day free retention window) | Matches the retention tier that already exists — no new concept | Natural pairing with "your data disappears after 30 days" messaging |
| Multiple cars in one garage (free = 1 car) | **Needs a check first** — confirm today's actual per-account car cap before committing to this; if currently unlimited for free, this is a very standard freemium lever, but changing it after users already added 2+ cars is disruptive | Households/multi-car owners are a natural paying segment |

**User-confirmed 2026-09-17:** ship all four for v1 — diagnostics gate, fast-mode
formalization, export cap, and multi-car cap (free = 1 car). Verified: there is currently **no**
per-account car limit anywhere in `src/` (grepped for a cap/max-cars check — none exists), so
this is a genuinely new restriction, not a relabeling. Because existing free accounts may
already have 2+ cars, the multi-car cap needs a grandfather rule: **existing free accounts keep
every car already linked at rollout** (no forced downgrade/deletion), the 1-car cap applies only
to *adding a new* car from that point on. State this explicitly in the upsell copy so it doesn't
read as a bait-and-switch.

### Phase 4 — Admin payment registration + audit trail

Today an admin grant is just "set `premium_until`," with no record of amount, method, or who
processed it. Add a `premium_payments` table (app-owned Postgres, admin-only RLS): `user_id`,
`amount`, `currency`, `method` (free-text/enum — bank transfer, cash, other; no gateway
integration implied), `recorded_by_admin_id`, `note`, `created_at`, `applied_until`. The existing
`PremiumEditor` in `AdminUsersPanel` gains a "Register payment" mini-form that inserts the ledger
row and extends `premium_until` in one action instead of two. Build this together with the
already-approved-but-unbuilt "Admin audit log" (this file, "Advanced admin workspace" section,
phase 2) — same shape of data, one migration instead of two.

### Phase 5 — Real payment gateway — declined for now

**User-confirmed 2026-09-17:** stay with manual bank-transfer + admin registration (Phase 4).
No payment gateway work in this pass; revisit only if asked later.

### Confirmed scope (2026-09-17) — ready to build pending final go-ahead

1. Fix **AUD-02** (self-grant hole) and **AUD-16** (stale 365-day retention copy) first.
2. Phase 1 badge + Phase 2 reusable lock/upsell component.
3. Phase 3 gates, all four: SOH/Battery-Consistency deep diagnostics, fast-mode (`live_fast_until`)
   formalization, free export capped at the 30-day retention window, and a new 1-car free cap
   with existing multi-car free accounts grandfathered.
4. Phase 4 `premium_payments` ledger + admin "Register payment" form, built together with the
   already-approved Admin audit log.
5. Phase 5 (real payment gateway) — explicitly not building this pass.

---
