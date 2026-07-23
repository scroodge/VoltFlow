# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

<!-- repository security/performance remediation shipped 2026-07-23; see CHANGELOG.md -->
<!--

### Research findings

- `telegram_live_messages` is created without RLS or explicit role revocation even
  though it stores user IDs, vehicle IDs, Telegram chat IDs, and message IDs.
- The Telegram webhook accepts requests without authentication when
  `TELEGRAM_WEBHOOK_SECRET` is unset.
- BYDMate command acknowledgements parse an unbounded body before API-key
  authentication and perform one sequential database update per item.
- `touchUserActivity` and account deletion are server actions importing the browser
  Supabase client, so request cookies are not available to the server-side auth check.
- Admin user filters and enrichment issue queries per profile; SOH fallback can issue
  roughly 366 raw queries after any RPC error.
- The Next.js and Edge telemetry ingress paths have different sanitization and
  post-ingest side effects.
- Several repository-local components/data modules are unreferenced, and large UI
  modules contain mixed orchestration, domain logic, and rendering responsibilities.

### Options and trade-offs

1. **Phased remediation (recommended).** First add the database/webhook/request
   guards and correct server-action auth; then replace the admin/SOH query fan-outs;
   then unify telemetry post-processing and remove confirmed dead code. This limits
   blast radius and makes each security fix independently verifiable.
2. **Single remediation release.** Faster overall, but combines migrations, ingress
   behavior, auth, and admin query changes into one rollback unit. Not recommended.
3. **Report-only cleanup.** Leaves the confirmed privacy and denial-of-service risks
   in place. Not acceptable for the security findings.

### Recommendation

Implement option 1 in this order:

1. Add idempotent RLS/role hardening for `telegram_live_messages`; make the Telegram
   webhook fail closed; authenticate and bound command acknowledgements before parsing.
2. Switch server actions to the request-bound Supabase server client and add focused
   regression tests for activity touch and account deletion.
3. Replace admin per-user counts/latest lookups with grouped queries/RPCs and restrict
   SOH fallback to a missing-function error.
4. Define one shared telemetry post-ingest contract for both ingress paths.
5. Extract duplicated helpers, split the vehicle live component incrementally, and
   delete only repository-local dead-code candidates after one final reference check.

No new user-facing data model is proposed. Existing Telegram metadata, telemetry,
vehicle commands, and activity remain user-owned data in Postgres; security changes
only tighten access. No localStorage ownership changes are needed for this plan.

Proposed 2026-07-23; awaiting go-ahead. **Should I build this?**
-->

## Repository audit remediation (shipped 2026-07-24; see CHANGELOG.md)

## ⏸️ Superseded: Auto-charging detection regression: yesterday's gun_state override blocks real AC charging

### Goal

Restore correct automatic charging-session detection for car `way` (and any vehicle
reporting a similar Di+ gun-state pattern) without reintroducing the false-session bug
that yesterday's fix (commit `3d5b69d`) was trying to close.

### Research findings

- User reported (2026-07-23) that car `way` is on a live AC charge right now, but the PWA
  shows nothing and no `charging_sessions` row exists. The last live snapshot/telemetry
  sample (07:12:14 device time, still the newest as of the report) reports
  `diplus_charge_gun_state = 1`, `diplus_power_kw = 0`.
- Commit `3d5b69d` (2026-07-22 22:14, "fix(telemetry): handle stale charge state after
  unplugging") reordered `isMateAutoSessionCharging`
  (`src/lib/bydmate/telemetry-charging.ts:76`) to check `gun_state === 1` → return `false`
  **before** checking `charge_power_kw`, instead of after. Previously a positive
  `charge_power_kw` reading won regardless of gun state; now `gun_state === 1`
  unconditionally overrides it.
- Queried every telemetry sample from car `way`'s last confirmed real AC charge
  (`charging_sessions` id `3c9e2751`, 49%→100%, 2026-07-22 11:21:52–18:20:19 UTC):

  | gun_state | samples | share | avg `diplus_power_kw` |
  |---|---|---|---|
  | 1 | 2230 | 71% | **+5.84 kW** |
  | 2 | 911 | 29% | −3.98 kW (all merged from a secondary `autoservice_*` fallback source, used when OBD/DiPars was unavailable) |

  `gun_state = 1` was the *majority* reading during real, active charging, with power
  consistent with an AC charger actually delivering current — not a stale/unplugged
  signal. Samples while genuinely driving (definitely unplugged) also read `gun_state = 1`,
  so the field does not reliably distinguish plugged/unplugged at all for this vehicle's
  DiPars source; the real charging signal is `charge_power_kw` itself.
- The regression test added in that commit (`telemetry-charging.test.mjs:57`, "car way,
  2026-07-22 15:18:58 UTC") documents the motivating incident as "stale... from a charge
  that had already ended ~1h10m earlier" — but 15:18:58 UTC falls *inside* session
  `3c9e2751`'s open window (11:21:52–18:20:19), which was still an active, continuous
  charge at that moment. The premise behind yesterday's fix does not match what the
  session history actually shows.
- Net effect: yesterday's fix closed one observed false-positive (a low/noisy power
  reading treated as a stale post-unplug artifact) by introducing a rule that discards
  the *majority* of genuine charging samples for this vehicle, which is the direct cause
  of today's non-detection.

### Options

1. **Revert the check order (recommended).** Put `charge_power_kw > threshold` back
   first; keep the `gun_state === 1` override only as a fallback when power is at/below
   threshold (its original position, pre-`3d5b69d`). This restores real-power charging
   detection immediately and keeps the override for exactly the case it was designed for
   (stale `is_charging`/near-zero leftover power after a real unplug), without discarding
   samples where power is genuinely flowing.
2. **Drop the gun_state override entirely**, relying only on `charge_power_kw` (with the
   existing plausibility caps) and the `is_charging` fallback. Simpler, but loses the
   protection against the original stale-reading false-positive bug entirely.
3. **Require corroboration before trusting gun_state as "unplugged."** Only let
   `gun_state === 1` override when power is also at/near zero *and* stays there for the
   same consecutive-sample window used for auto-stop (i.e. reuse the existing
   2-consecutive-sample rule instead of trusting a single sample). More robust than
   option 1 but a bigger behavior change; needs its own test coverage for the interaction
   with auto-stop.

### Recommendation

Option 1. It's the smallest change, directly undoes the specific reordering that caused
today's regression, and keeps the override doing its original, narrower job (discarding
stale near-zero readings) rather than discarding real charging power. Correct or remove
`telemetry-charging.test.mjs:57`'s inaccurate premise/comment once the session timeline
is fixed, and add a regression test asserting a real positive `charge_power_kw` wins even
when `gun_state === 1` (matching the 71%-of-samples pattern just measured).

### Data ownership

No new data model — this is a pure bug fix inside existing telemetry-interpretation logic
in `src/lib/bydmate/telemetry-charging.ts`. No migration, no new user-owned or app-owned
storage.

Proposed 2026-07-23; awaiting go-ahead. **Should I build this?**

---

## ~~Security hardening: PWA, GPS privacy, vehicle credentials, and website defenses~~ — SHIPPED 2026-07-20

> Built and deployed in commits `625a608`, `ce8056f`, and `d9ef280`; production migrations
> `20260720150000` and `20260720153000` are applied. See [CHANGELOG.md](CHANGELOG.md) for the
> shipped behavior. Retained below for the original findings and trade-offs.

### Goal

Close the security-review findings without weakening live vehicle status, trip history, or
Telegram Mini App support. The priority is to minimise precise-location persistence, remove
private PWA responses from offline storage, protect the Mate credential, and add browser and
supply-chain defenses.

### Research findings

- `bydmate_live_snapshots` retains a JSON `location` and the ingest payload, but the scheduled
  retention job only removes old telemetry samples, track points, and hourly rows. A stale
  last-known location therefore has no explicit expiry.
- The production service worker precaches and runtime-caches authenticated routes; sign-out
  revokes the Supabase session but does not clear Cache Storage or `voltflow:last_gps`.
- Browser GPS used for tariff matching is persisted as exact coordinates in unscoped
  `localStorage`, so it can survive sign-out and be reused by another account in the same
  browser profile.
- The Mate cloud API key is stored as plaintext in `profiles` and is matched by equality.
  It must remain a long-lived device credential, but the database should not need its raw
  value after pairing.
- The live site has HSTS, but no CSP, clickjacking protection, `nosniff`, or referrer policy.
  The Telegram Web App, Vercel analytics, and OpenStreetMap embed mean a CSP must be introduced
  in report-only mode before enforcement.
- `npm audit --omit=dev` reports one high advisory (transitive `hono` through production
  dependency `shadcn`), six moderate, and one low. `next@16.2.6` is also flagged through its
  bundled PostCSS dependency. Reachability of the Hono advisory in the deployed request path
  is not established, but the production dependency graph must be corrected.
- The public privacy policies say Premium telemetry/tracks are retained for 365 days, whereas
  the current retention implementation documents Premium/Admin as unlimited. This is a
  user-facing privacy commitment and must be reconciled with the chosen retention behavior.

### Data ownership and location — confirmation required before implementation

- **Exact GPS, tracks, saved tariff locations, and home geofences are user-owned data.**
  Their canonical cloud copy is in **Postgres** under existing RLS; browser GPS used solely
  for a one-time tariff match must be **transient in memory**, never `localStorage`.
- **The latest live location is user-owned Postgres data**, but only while fresh. The proposed
  default is to remove coordinates (including coordinates duplicated in the snapshot payload)
  after **24 hours** without a newer valid GPS sample. Live non-location telemetry remains.
- **The Mate API credential, cache names, CSP reports, and security audit events are app-owned
  operational data.** Credential hashes/fingerprints live in Postgres; cache state lives only
  in the browser and is cleared at logout. No raw credential, GPS coordinate, or request body
  is placed in audit logs.

Two choices need explicit confirmation before any migration or behavior change:

1. Confirm the 24-hour expiry for a stale `bydmate_live_snapshots` location.
2. **Confirmed 2026-07-20:** Premium data, including exact tracks, remains retained forever.
   Update the public privacy policy and provide a visible per-user cleanup/export path; do not
   introduce a Premium retention purge.

### Options

1. **Phased defense-in-depth (recommended).** Fix local PWA storage and stale live locations
   first, then migrate credential storage with a controlled re-pair/rotation path, introduce
   CSP in report-only mode, and update dependencies and privacy disclosure. This immediately
   reduces exposure while preserving live status and gives Telegram/CSP compatibility a safe
   rollout. Trade-off: several small releases and a one-time Mate re-pair for rotated keys.
2. **One large hardening release.** Ship cache, retention, key, header, validation, dependency,
   and policy changes together. Trade-off: difficult rollback; any CSP or pairing regression
   could interrupt real vehicle telemetry. Do not choose.
3. **End-to-end encrypt route tracks now.** Reduces cloud-operator visibility but conflicts with
   server-side trip inference, route analytics, exports, and realtime reads; it also does not
   solve browser caching, stale snapshots, or device compromise. Defer unless a separate threat
   model requires it.

### Recommendation

Choose option 1. Premium data remains retained forever; make that retention truthful in every
privacy-policy language and give users an informed cleanup/export choice without automatic
historic-track deletion.

### Implementation phases after approval

1. **Production baseline and regression harness.** Record current deployed headers, Supabase
   RLS/grants/publication state, scheduled-purge health, and which response types are cached.
   Add focused tests for GPS expiry, cache-clearing messages, key hashing/rotation, and payload
   field stripping. Test with two accounts to prove a user cannot read another user's snapshot,
   track, command, or saved location.
2. **PWA local-data boundary.** Restrict the service worker to static assets and public Telegram
   content; never precache or runtime-cache authenticated HTML. Version and delete legacy app
   caches on activation. On sign-out and account deletion, send the worker a clear message and
   remove `voltflow:last_gps` plus account-scoped local preferences. Keep tariff GPS in memory;
   if a short recovery fallback proves necessary, use a user-scoped key with a short TTL.
3. **Cloud GPS lifecycle and user controls.** Add an idempotent migration that records GPS
   freshness, clears stale snapshot coordinates and location-bearing raw payload fields after
   the confirmed TTL, and preserves non-location live status. Ensure live/map APIs suppress
   stale coordinates. Keep current RLS and location plausibility checks. Add clear, separate
   controls for saved tariff locations, home geofences, and historical track cleanup; preserve
   forever-retained Premium history and update every policy language together.
4. **Mate credential rotation.** Add a peppered HMAC/hash and non-sensitive fingerprint for the
   device key; authenticate using the hash, then remove plaintext reads after a compatibility
   window. Change Settings from revealing a reusable raw credential to a pair/rotate flow.
   Rotation invalidates the old key, records only a timestamp/fingerprint, and requires Mate to
   redeem a fresh short-lived link code. Rate-limit and monitor failed device authentication
   without logging secrets.
5. **Website and ingest hardening.** Add a report-only nonce-based CSP, then enforce it after
   testing Telegram, analytics, maps, authentication, and images. Add `frame-ancestors` with
   the necessary Telegram allowance rather than a blanket `DENY`, plus `nosniff`, referrer, and
   permissions policies. Replace ingest `.passthrough()` persistence with explicit allowlists
   for stored fields, bounded request sizes, and edge/application rate limits appropriate to
   Mate's batch cadence.
6. **Supply chain and release verification.** Upgrade to patched compatible Next.js and the
   transitive Hono chain; move `shadcn` to development-only only after proving it is not needed
   at runtime. Commit the lockfile, rerun production dependency audit, build, focused tests,
   and a deployed-header check. Verify service-worker Cache Storage after login/logout/offline,
   a real Mate re-pair/rotation, RLS with two real test users, and the purge job's first run.

### Acceptance criteria

- No authenticated route response or exact browser GPS remains available after sign-out,
  account deletion, or an offline reopen in the same browser profile.
- A stale snapshot returns no latitude/longitude after the confirmed TTL while current SOC and
  status still work; GPS opt-out clears the latest cloud coordinates promptly.
- A raw Mate key is never read back from Postgres after migration, old keys fail after rotation,
  and a valid newly paired Mate continues ingest/poll/ack without interruption.
- Enforced headers pass Telegram Mini App, login, map, PWA install, and analytics checks.
- Production audit has no high advisory, privacy policy matches actual retention, and RLS tests
  prove cross-account snapshot/track/command/location reads and writes are denied.

---

## ~~Low-latency live status: 2–5 s for all vehicle statuses~~ — SHIPPED 2026-07-20

> Built as **option B (viewer-gated fast mode)** and verified in prod; see
> [CHANGELOG.md](CHANGELOG.md) → "Viewer-gated fast live status". Retained below only for the
> rejected alternatives and the cost reasoning behind the choice.

### Goal

Every status the PWA shows (drive / charge / park, plus SOC, charge power, gun, gear)
reflects reality within **2–5 s**, not the current 30–60 s. Stated by the owner
2026-07-20 after the v0.4.9 transition ping proved too narrow.

### Why v0.4.9 is not enough

It pings only on **moving/charging edges**, only from `CloudTelemetrySender` (the app).
Everything else still waits for the batch flush. Measured cadences today:

| Path | Sample | Delivery (flush) |
| --- | --- | --- |
| Driving / charge tail ≥98% | 1 s | 15 s |
| Charging bulk <98% | 10 s | **60 s** |
| Parked (app running) | 30 s | **60 s** |
| Car off (`CommandDaemon`) | — | **60 s**, and no ping code at all |

Plus a PWA-side floor: `BYDMATE_LIVE_REFETCH_DEBOUNCE_MS = 5_000`
(`src/hooks/use-bydmate-live-query.ts:14`) debounces Realtime events, so even an
instant push cannot surface faster than ~5 s.

Also unresolved: the 0.4.9 ping path has **no logging**, so it has never been confirmed
to fire. Add logging in whichever option is chosen.

### The core tension

The live snapshot is only as fresh as **delivery**, and delivery is batched on purpose —
that is the entire cloud-offload programme (`BYDMate-own/docs/CLOUD_OFFLOAD_PLAN.md`,
phases 0–3 shipped). A `live_only` push is the cheapest possible write (one snapshot
upsert; no history / hourly / trip rows), but each one is still a Vercel invocation plus a
Supabase round trip. Going from 1 POST/min to one every 3 s during a charge is ~20× the
invocations — directly against the work just completed.

### Options

**A — Always-on fast `live_only` heartbeat (~3 s, change-gated).**
Extend the existing Phase-2 `live_only` mechanism from "parked and unchanged" to "any
state, on change", with deadbands (e.g. power ±0.3 kW) so a steady charge does not spam.
*Pro:* simple, uniform, hits target everywhere. *Con:* biggest cost increase (~5–20×
invocations while charging/driving); partially undoes the offload savings.

**B — Viewer-gated fast mode (recommended).**
The PWA signals "someone is watching" when the live/dashboard view mounts; the car
switches to a ~3 s `live_only` cadence for N minutes, then falls back to today's rhythm.
Reuses the **existing** command channel (`vehicle_commands`, already polled by
`VehicleCommandPoller` and by the daemon every 6 s), so the daemon gets the same fast mode
for free — which is what fixes *plugging in while the car is off*.
*Pro:* hits 2–5 s exactly when it matters, ~zero cost when nobody is looking; preserves
the offload work. *Con:* most work; ~6 s one-time activation lag when opening the app
(bounded by the existing poll interval).

**C — Just shorten the intervals.**
Charging-bulk flush 60→10 s, parked 60→15 s, PWA debounce 5→1 s.
*Pro:* smallest change. *Con:* lands at ~10–15 s, **not** 2–5 s; still multiplies
invocations, just less.

### Required in all options

- Cut `BYDMATE_LIVE_REFETCH_DEBOUNCE_MS` 5_000 → ~1_000, else 2–5 s is unreachable.
- Give `CommandDaemon` the same treatment as Phase 2b (it bypasses `CloudTelemetrySender`
  entirely), or car-off plug-in stays slow.
- Add logging to the ping/heartbeat path so latency is verifiable instead of inferred.

### Recommendation

**Option B.** It is the only one that reaches 2–5 s without multiplying backend cost, and
it reuses the command channel that already exists. If the extra work is unwelcome, A is
the honest fallback — but it should be a deliberate decision to spend invocations, since
it erodes phases 0–3.

### Data ownership

No new user data. The "viewer active" signal in option B is ephemeral app-owned state
(a short-lived flag/command row, TTL in minutes), not a user preference — nothing to
persist beyond its expiry.

---

## Admin users: business KPIs and infrastructure-observability boundary

### Goal

Extend `/admin/users` with clear all-time and daily business statistics, without making
the paginated user list slower or treating infrastructure monitoring as application data.

### Research findings

- The page already renders two compact metric tiles from `GET /api/admin/users`:
  distinct users whose live snapshot was received since the current **UTC** day began,
  and the current total number of `profiles`.
- `profiles.created_at` can calculate registrations, and `bydmate_trips` is the
  authoritative stored-trip table. Junk trips are discarded by the server, so its rows
  are the correct basis for “trips recorded”.
- Deleting an Auth account cascades to `profiles`, removing the only current record.
  The inactivity cron deletes accounts through `supabaseAdmin.auth.admin.deleteUser()`;
  there is no durable history of past removals. A historic “unregistered” total therefore
  cannot be recovered truthfully.
- The Contabo monitoring stack is live: Prometheus has healthy targets for host metrics,
  containers, Postgres, GoTrue, PostgREST, Realtime, Supavisor, and Kong; Grafana already
  provisions a Supabase dashboard and alerts. Prometheus exposes host CPU, memory, root
  filesystem, container, and Postgres-exporter metrics. It is the right source for server
  load, not the VoltFlow business database.

### Proposed cards and metric definitions

Keep the existing total-user card and add the following compact, responsive tiles above
the filters and user list:

| Card | Definition | Period |
| --- | --- | --- |
| Connected today | Distinct `user_id` values with a live snapshot `received_at` since the Minsk calendar day began | Today, Europe/Minsk |
| Registered users | Current `profiles` row count | All time/current |
| Registered / removed | `+` profile-created and `−` profile-deleted counters | Today, Europe/Minsk |
| Trips recorded | Valid rows currently stored in `bydmate_trips`, including an in-progress trip | All time/current |

Use the current restrained admin visual vocabulary, tabular numerals, and short labels.
On a narrow phone, preserve readability with a two-column grid; use a denser multi-column
layout only when there is room. Show the time zone in helper copy or a tooltip so “today”
is unambiguous. Do not replace the existing summary tiles or introduce charts in this
first pass.

### Data ownership and location — confirmation required before implementation

The new lifecycle measurement is **app-owned operational aggregate data in Postgres**,
not a user preference and not user-owned content. Store only the daily Minsk date and
two counters (`registered_count`, `removed_count`) in a private admin metrics table;
do not retain deleted-user email, vehicle, GPS, or a residual user identifier just to
calculate a count. The client receives already-aggregated numbers from an admin-only
route and stores nothing in `localStorage`.

Current profiles can be backfilled into registration-day aggregates. Historic account
removals are irretrievable and must be displayed as “tracked from deployment” rather
than invented. The profile insert/delete triggers will maintain new daily counters,
including the deletion cascade caused by the inactivity cleanup.

### Options

1. **One aggregated admin stats RPC plus privacy-minimised daily lifecycle counters
   (recommended).** Add an idempotent migration for the daily app-owned aggregate and
   profile triggers, backfill registrations from current profiles, and expose exact
   database-side counts through a service-role-only RPC after the existing `requireAdmin`
   guard. This is accurate going forward, avoids N+1/count-download work, and does not
   preserve deleted-user data. Trade-off: historic removals stay unavailable.
2. **Use only existing tables.** Add all-time trips and today’s registrations in the
   existing route, and show removals as unavailable. Lowest schema impact, but it does
   not answer the requested removed-user metric and the current connection query downloads
   up to 5,000 rows to emulate `COUNT(DISTINCT ...)`.
3. **Store a lifecycle event per account.** Supports per-user audit history but retains
   identifiers after deletion and is unnecessary for aggregate dashboard cards. Reject
   unless a later administrative audit requirement explicitly needs it.

### Recommendation

Build option 1. Define “unregistered” as an account removed from Auth, whether by the
inactivity job or a future account-deletion path. Treat the cards as operational facts,
not billing or entitlement authority. Keep infrastructure health in Grafana for this
phase: it already has the Prometheus signals and avoids adding a new server-to-app
credential/proxy boundary just to duplicate a monitoring dashboard.

### Implementation steps after approval

1. Add an idempotent migration that creates the private daily aggregate table, backfills
   registration counts from `profiles.created_at` by `Europe/Minsk` date, and attaches
   `AFTER INSERT` / `AFTER DELETE` profile triggers that atomically increment the matching
   day. Add a service-role-only `admin_users_dashboard_stats()` function that returns the
   four card values with a database-side distinct connection count. Confirm the delete
   trigger fires for an Auth-to-profile cascade before considering the metric complete.
2. Update `src/app/api/admin/users/route.ts` to call the aggregation function only after
   `requireAdmin()` succeeds; replace the capped snapshot download with its exact count
   and extend the typed `stats` response. Preserve the existing pagination/filter behavior
   and never expose this RPC to anon/authenticated browser roles.
3. Update `src/components/admin/users/admin-users-panel.tsx` to render the four proposed
   cards, including an explicit `+registered / −removed` treatment and Minsk-day copy.
   Keep the existing user cards and filters unchanged.
4. Add focused Node tests for metric-response mapping and a migration-level SQL smoke
   check for idempotence, backfill, counter updates, and cascaded deletion. Run the
   project’s appropriate build/test checks only if separately requested.
5. In Grafana, verify the existing Supabase dashboard covers host CPU, memory, disk,
   containers, Postgres, API/auth/realtime/pooler availability, and add alert thresholds
   there if desired. Do not build a VoltFlow “server load” card unless a later decision
   explicitly authorizes a protected Prometheus proxy, caching policy, and Grafana-access
   security review.

### Follow-up observability option

If a compact in-app health summary becomes genuinely useful later, add it as a separate
admin-only phase: a server-only Prometheus proxy returns a cached, coarse status
(`healthy`, `degraded`, `unreachable`) rather than raw infrastructure metrics. That phase
needs explicit approval because it adds an infrastructure credential and an external
dependency to the application request path.

### Useful later KPIs — explicitly out of the first build

- **Mate activation rate:** registered users who have ever sent an accepted live snapshot,
  shown as both a count and a percentage of current registered users. This distinguishes
  an account signup from a successfully connected car.
- **Telemetry-active users (7 / 30 days):** distinct users with accepted telemetry in the
  period. This is a more useful product-health measure than an all-time user total.
- **Mate update coverage:** users whose most recently reported Mate version is below the
  current supported release, plus the version breakdown. This turns the existing
  per-user version field into an upgrade-risk signal.

These are derived, app-owned operational metrics from existing Postgres facts; they add
no user preference, no local storage, and no additional lifecycle data model. Plan and
approve them as a separate follow-up once the four baseline cards are working.

Shipped 2026-07-18; see [CHANGELOG.md](CHANGELOG.md#admin-users-dashboard-kpis-and-lifecycle-metrics).

---

## Advanced admin workspace: attention queue, activation, and audit history

### Goal

Evolve `/admin/users` from a user report into an operational workspace: identify users
who need help or follow-up, show whether signup becomes lasting Mate usage, and preserve
accountability for privileged admin changes.

### Phases

1. **Needs-attention queue (recommended first).** Derived server-side from existing facts:
   outdated Mate versions, connected cars with stale telemetry, users who never activate
   Mate, and premium terms nearing expiry. No new user-facing data model.
2. **Activation and retention.** Show `registered → car linked → first telemetry → active
   after 7 days`, weekly/monthly active telemetry users, and signup-cohort retention.
   Use app-owned Postgres aggregates for efficient historical reads.
3. **Admin audit log.** Record premium/admin-role changes, acting admin, affected account,
   timestamp, prior/new values, and an optional reason.

### Data ownership and location — confirmation required before implementation

The Phase C audit log is **app-owned operational data in Postgres**, not user preference
data and not `localStorage`. It retains administrative history, so its retention policy,
visible fields, and access scope must be confirmed before building. Phases A/B derive
their results from existing user, car, snapshot, telemetry, release, and entitlement facts.

### Recommendation

Build Phase A before any more headline cards. It creates a short, actionable work queue.
Keep host and Supabase infrastructure health in Grafana rather than duplicating it in the
application. Then plan Phase C separately with explicit audit-retention and visibility
decisions.

Phase A shipped 2026-07-18; Phases B/C remain proposed. See
[CHANGELOG.md](CHANGELOG.md#admin-users-needs-attention-queue).

---

## Agent workflow — explicit verification only

### Finding

The user wants implementation work to stop after the requested code change.
Builds, lint, tests, server control, and other verification commands should run
only after the user explicitly asks for verification. This avoids unnecessary
local process contention and keeps the agent focused on the requested edit.

### Options

1. **Add a durable rule to `AGENTS.md`, recommended.** Put it next to the
   command guidance so every future task treats verification as opt-in.
2. Keep the instruction only in long-term memory. This would not reliably guide
   agents that read the repository without the shared personal context.

### Scope

Documentation and workflow only. No application behavior, user data, storage,
or migrations change.

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

**Recommendation: A now, B as a follow-up.** A is nearly free and immediately extends the
already-shipped work to the widget; B adds the standalone case without an always-on cost.
A depends on G2 — see below.

#### G2 — Server-side persistence classes (this is P1, and it gates G1)

Give `live_only` a route-level short-circuit mirroring what the RPC already does: skip
auto-session, charge notifications and the persisted-verify select; gate `last_active_at`
to roughly 1/hour; reorder the widget path to read the throttle row first and build HTML
only when the edit will actually be sent. Target: a fast-mode push drops from ~12-15 round
trips to ~3.

This must land **before** G1. Widening the widget's cadence without it multiplies exactly
the per-push cost that cloud-offload phases 0-3 were built to remove.

#### G3 — Durable trip-end finalization

Unchanged from P0 below. The `drive → P → power off` case can still lose a trip end. This
is the reliability half of objective 2 and is independent of the latency work.

### Data ownership and location for G1-G3

**No new user-owned data, and no new user preference.** The fast-mode window remains
ephemeral app-owned state in the two existing nullable `profiles` columns
(`live_fast_until`, `live_fast_vehicle_id`) with an expiry — extend-only, never an explicit
off switch. G1 option B persists nothing beyond stamping those same columns. G2 removes
writes rather than adding them. G3's finalization audit record is app-owned server state in
Postgres, as already specified below. Existing GPS consent is untouched.

### Observed constraints

- The Telegram widget is throttled to 30 seconds and renders only current SOC, odometer,
  state, speed, charging power/time-to-full, and optional last location. It does not need
  one-second history.
- PWA live views read `bydmate_live_snapshots`; a 5–10 second moving update and a
  30–60 second charging update satisfy the current 90-second live-SOC freshness rule.
- Raw samples currently also feed server-side trip inference, route tracks, detailed
  day/trip charts, SOH/energy diagnostics, and exports. Removing them in one cutover would
  change those features and risks missed trip-end events when the head unit powers off.
- In the current APK, a `P` sample stays in the 10-minute drive latch and the async flush
  is not guaranteed before an immediate process/power loss. Room persistence helps only
  after the enqueue completes; the daemon's 60-second parked/off send is best effort.

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

1. **P0 — reliable stop/off finalization.** Add a durable finalization outbox record before
   shutdown, bounded best-effort flush, daemon/next-start replay, and a server grace-time
   fallback. Measure finalization latency and missed closures.
2. **P1 — reduce current ingest fan-out.** Gate charge-notification work to charging
   changes, check widget eligibility/throttle before unrelated reads, debounce profile
   activity writes, and avoid full auto-session reads when no charging/open-session signal
   exists. No wire-contract change.
3. **P2 — v2 events in shadow mode.** Add event ids, sequence, algorithm version and
   idempotency validation. Upload `trip_segment`/end events alongside existing samples;
   compare distance, SOC, start/end, and track fidelity per trip.
4. **P3 — measured cutover and retention.** Reduce ordinary raw persistence only when
   parity thresholds hold. Keep adaptive route points and short diagnostic retention;
   retain cloud aggregates and final facts for all supported history views.

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
  `308` + a re-issued POST. Flipping `volt-flow-beige.vercel.app` to *Connect to an
  environment → Production* and moving the redirect into `src/proxy.ts` with a path
  exemption would halve the request count. Efficiency, not correctness.
- **Vercel Attack Challenge Mode is intermittently ON** (`x-vercel-mitigated: challenge`),
  which challenges every non-browser client. It is the reason Telegram traffic detours via
  `bot.voltflow.life`. A WAF bypass for `/api/bydmate/*` would be healthier than routing
  around it.
- **Push subscriptions are origin-scoped.** A user who reinstalls the PWA from the new
  origin gets a *second* subscription → possible duplicate charge notifications until the
  old one expires. Worth a dedupe pass.
- **No `sitemap.ts` / `robots.ts`** — the marketing + knowledge pages have no canonical host
  declared for SEO.

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

## ✅ DiLink 5 full data collection — DONE 2026-07-09

See [CHANGELOG](CHANGELOG.md) for full details. All 3 phases shipped + applied to prod.
APK-side (BYDMate-own repo) still needs implementation for autoservice Binder reads.

---

### energydata trip-summary cloud sync — web + APK halves DONE, docs follow-up pending

**Web half shipped 2026-07-06, APK half shipped 2026-07-08** (VoltFlow Mate v0.4.7,
`TripSummaryCloudSync` in BYDMate-own) — see [CHANGELOG](CHANGELOG.md). Migration
`20260706190000_bydmate_trip_summary_source.sql` (`bydmate_trips.source` +
`bydmate_ingest_trip_summaries` RPC, applied to prod) + `POST /api/bydmate/trip-summaries`
+ "BYD log" trip badge.

**Audit 2026-07-08:** Real user `konev.alexey@gmail.com` — 874 trips, 8,330 km synced.
EC_database.db schema: `_id, month, date, start_timestamp, end_timestamp, is_deleted,
duration, trip, electricity, fuel`. Gap: `fuel` column not sent. Phase 1 fixes this.

**Docs/onboarding follow-up (web, not yet done):** replace the flat "ADB required on
DiLink 5" with: "check whether your car writes energydata via the «Диагностика BYD»
button (VoltFlow Mate v0.4.6+) — if yes, trips/consumption sync without ADB; live data
still needs ADB."

---


## 🟠 Delivery cadence vs the Vercel free plan — cut invocations, not calculation

### Goal

Keep VoltFlow on Vercel's free plan. The binding resource is **function invocations**, and
invocations are driven by **delivery cadence**, not by how much arithmetic runs per sample.
Owning sources are APK-side: `CommandDaemon` and `CloudTelemetrySender` in `BYDMate-own`.

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
usage down by route. Confirm before building — see P0 below.

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

### The honest alternative: Vercel Pro

Three metrics are over on a fleet of eight cars. P1 + P3 plausibly gets invocations to ~200–300K/mo
and Active CPU proportionally down, which restores real headroom. But every lever here spends
either APK release cycles or user-visible freshness, and the fleet upgrades gradually (four of
eight cars on 0.5.0 as of 2026-07-20), so relief arrives over weeks while the overage is now.
**Vercel Pro at $20/mo removes the constraint immediately and buys time to do P1 properly rather
than urgently.** Recommend deciding this explicitly rather than defaulting to "stay free" — the
engineering time to hit the free tier is worth more than $20/mo unless staying free is a goal in
itself.

Dashboard data supplied by owner 2026-07-20; revised plan awaiting go-ahead.

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

Proposed 2026-07-20; awaiting go-ahead.

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

## Frontend hosting: stay on Vercel, or move to the Contabo VPS alongside Supabase?

### Goal

Decide whether the Next.js frontend should be co-located on the self-hosted Supabase VPS.
The question arose from two pressures: the "status must reach PWA/WEB/TELEGRAM/TGWIDGET almost
immediately" goal, and the Vercel Hobby quota overage recorded in the delivery-cadence entry
above. Investigated read-only 2026-07-21.

### Research findings

**Topology.** Frontend is on Vercel pinned to `fra1` (Frankfurt) via `vercel.json`. The Supabase
VPS `144.91.127.194` (`vmi3078244.contaboserver.net`) geolocates to **Lauterbourg, Grand Est,
France** — roughly 120 km from Frankfurt, same European backbone.

**Co-locating cannot improve live-status latency. Two independent reasons:**

1. **The live path does not traverse Vercel at all.** The PWA and widget subscribe to Supabase
   Realtime `postgres_changes` straight from the browser — `src/hooks/use-bydmate-live-query.ts:81`,
   `src/hooks/use-vehicle-commands-query.ts:45`,
   `src/components/charging/charging-session-screen.tsx:197`. Traffic goes browser → VPS directly.
   Moving the Next.js server changes nothing on this path.
2. **The one hop Vercel does sit on is already negligible.** Car → `fra1` → Supabase in
   Lauterbourg costs single-digit milliseconds on the Vercel→DB leg. Per AGENTS.md the measured
   status budget is **~3 s** (daemon push) to **5–9 s** (app path), dominated by daemon loop
   pacing and batch delivery. Saving ~10 ms against ~5,000 ms is unmeasurable.

**The VPS has no spare capacity, and it is not a VoltFlow-only box.** Measured 2026-07-21:

| Resource | Reading |
| --- | --- |
| CPU | 3 vCPU, load average **3.05–3.28** — fully saturated |
| CPU breakdown | 54.7% user, 34.0% sys, **9.4% idle**, 0.0% iowait (real CPU, not I/O stall) |
| Memory | 7.9 GB total, 4.4 GB used, **3.5 GB available** |
| Disk | 387 GB total, 63 GB used (17%) — ample |

The box also runs `amnezia` (WireGuard VPN), `f1-news-bot` (+ its own Postgres and Redis),
`chat_agent_postgres`, `uptime-kuma`, `hellomate-bot`, Grafana/Prometheus/Loki/cadvisor, and
`ai-gateway`. Supabase is one tenant among many.

**Root cause of the saturation — an unrelated crash loop (see the dedicated entry below).**
Summed container CPU is under 25%, so the load is not Supabase. It is `ai-gateway.service`
restarting forever and reloading TensorFlow each time.

### Options

1. **Stay on Vercel, fix invocations at the source (recommended).** The overage is caused by the
   6 s command poll, not by hosting location — see the delivery-cadence entry's P1 (fold command
   delivery into the telemetry POST response, ~-90% invocations) and P4 (drop the `308` on
   `/api/bydmate/*`, free). *Pro:* keeps CDN, preview deploys, managed TLS, autoscaling; fixes the
   actual cause. *Con:* P1 needs an APK release cycle and the fleet upgrades gradually.
2. **Vercel Pro, $20/mo.** *Pro:* removes the constraint today, buys time to do option 1 properly
   rather than urgently. *Con:* recurring cost. Already recommended in the entry above.
3. **Hybrid — move only `/api/bydmate/telemetry` and `/commands` to the VPS.** These are ~100% of
   the invocation problem. A Deno skeleton already exists at `supabase/functions/bydmate-telemetry/`.
   *Pro:* removes the billing driver, keeps Vercel for user-facing pages. *Con:* the Deno path has
   **minimal validation only** — no auto-session, reconcile, or charge notifications — so this is a
   real port of `src/app/api/bydmate/telemetry/route.ts` (452 lines), and it duplicates ingest logic
   across two runtimes, which AGENTS.md already flags as a recurring source of bugs in the
   two-sender case. Also needs CPU the box does not currently have.
4. **Full migration of the frontend to the VPS — not recommended.** *Pro:* no invocation billing;
   one deployment target. *Con:* zero latency benefit (findings above); the box is at ~90% CPU
   before adding a Node server plus builds; collapses app and database into a single failure
   domain on one unredundant VPS; loses CDN, preview deployments, managed TLS and autoscaling;
   adds reverse-proxy, process-supervisor, and deploy-pipeline ops burden.

### Recommendation

**Do not move the frontend.** The premise that co-location improves freshness does not hold — the
live path already bypasses Vercel entirely, and the remaining hop is ~10 ms against a ~5 s budget.
Treat hosting and the quota overage as separate problems: take **option 2 now** ($20/mo, immediate)
and **option 1 (P1 + P4)** as the durable fix. Revisit option 3 only if the invocation count stays
over quota *after* P1 ships, and only once the VPS has real CPU headroom.

Proposed 2026-07-21; awaiting go-ahead.

---

## ~~VPS: `ai-gateway` crash loop is burning ~1 of 3 CPU cores on the Supabase host~~ — SHIPPED 2026-07-21

> Resolved 2026-07-21 by taking **option 2**: `systemctl disable --now ai-gateway`. Measured
> recovery: load 3.05–3.28 → 1.98, CPU idle 9.4% → 76.0%. Also found and removed a latent
> port collision with `supabase-kong` on `:8000`. See [CHANGELOG.md](CHANGELOG.md) for the
> shipped outcome. Retained below for the original findings and trade-offs.

### Goal

Recover the CPU capacity that a non-VoltFlow service is consuming on the box that hosts the
production database. Found 2026-07-21 while investigating the hosting question above.

### Research findings

`ai-gateway.service` ("AI Gateway (OpenAI API proxy)", `/opt/ai-gateway`) is in a permanent
crash-restart loop. **systemd restart counter: 350,805.**

Root cause is a filesystem permission error at import time:

```
File "/opt/ai-gateway/app/services/face_embedding_service.py", line 13
  from deepface import DeepFace
File ".../deepface/commons/folder_utils.py", line 19, in initialize_folder
  os.makedirs(deepface_home_path, exist_ok=True)
PermissionError: [Errno 13] Permission denied: '/opt/ai-gateway/.deepface'
```

- `/opt/ai-gateway` is `drwxr-xr-x 7 501 staff` — owned by **UID 501 / group `staff`**, which is a
  macOS-style owner. The tree was almost certainly copied from a Mac and never re-owned.
- The unit runs `User=www-data / Group=www-data`, which therefore cannot create `.deepface`.
- `Restart=on-failure`, `RestartSec=5`, with no `StartLimitBurst`, so the loop never gives up.
- Each attempt imports TensorFlow before failing — **~9.3 s of CPU per restart**.

**Cost.** ~9.3 s CPU × 350,805 restarts ≈ **907 CPU-hours ≈ 37.8 CPU-days** burned. At ~15 s per
cycle the counter implies ~61 days of looping against a 64-day uptime — it has been running since
roughly boot. Instantaneously it pins about one full core, i.e. **~33% of a 3-vCPU box**, which is
the bulk of the load-3.0 saturation measured above.

**Separately: 436 zombie `curl` processes** are parented to PID 1229302 (`python start_local.py`,
cwd `/app`) inside container `f1-news-bot-f1-news-main-1` — an unrelated project. It spawns `curl`
subprocesses and never reaps them; individual zombies range from 20 minutes to 9+ days old,
accumulating since 2026-07-09. **This is cosmetic, not the load cause** — zombies hold a PID table
slot and nothing else, and at 736 PIDs against a `pid_max` of 4,194,304 there is no exhaustion
risk. It is a latent bug in that project, not a VoltFlow issue.

### Options

1. **Fix ownership (recommended).** `chown -R www-data:www-data /opt/ai-gateway`, or set
   `Environment=DEEPFACE_HOME=/var/lib/ai-gateway` in the unit with a writable directory.
   *Pro:* recovers ~33% of the machine and the service starts working. *Con:* needs confirmation
   that the AI gateway is still wanted, and it may fail on the next missing dependency.
2. **Disable the unit.** `systemctl disable --now ai-gateway`. *Pro:* recovers the CPU immediately
   with no dependency risk. *Con:* whatever depends on the proxy stays down.
3. **Add a start limit only.** `StartLimitBurst=5` / `StartLimitIntervalSec=300` so systemd gives
   up instead of looping forever. *Pro:* prevents this class of loop permanently. *Con:* does not
   fix the gateway; best applied alongside option 1 or 2.
4. **Do nothing.** *Con:* one core stays lost and the database shares a saturated host.

### Recommendation

Decide first whether `ai-gateway` is still wanted. If yes: **option 1 + option 3**. If no:
**option 2**. Either way apply **option 3** so a future import error cannot silently consume a core
for two months again. This is VPS ops and touches no file in this repository — it needs shell
access to the Contabo host, not a code change.

Worth a follow-up: the same box has no alerting for "systemd unit restart counter climbing", which
is why this ran undetected for ~61 days despite Grafana/Prometheus/`uptime-kuma` all being present.

Shipped 2026-07-21 via option 2 — see [CHANGELOG.md](CHANGELOG.md).
