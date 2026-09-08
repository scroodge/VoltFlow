# Analytics Panel Performance Investigation

## Status and safety boundary

Investigation date: **2026-09-04**.

This is a read-only production investigation. It did not apply a migration,
change a schema, replace a reader, enqueue work, or register a cron job. All
production probes used the owner tenant and vehicle explicitly, the live
`statement_timeout = 8s`, and either an exact time window, a fixed trip-id set,
or the application's existing row limit.

One initial metadata query mistakenly included an unbounded tenant-level row
count. PostgreSQL cancelled it at eight seconds before the remaining catalog
queries ran. It made no change, was abandoned, and was not repeated. All plans
and measurements below came from bounded probes.

The warm full-page timings that triggered this investigation were:

| Request under normal Analytics sibling load | Server result | Duration |
| --- | --- | ---: |
| Phantom drain | HTTP 200 after fallback | 17.9 s |
| Route insights | HTTP 200 | 11.3 s |
| Lifetime map | HTTP 200 | 10.7 s |
| Period overview, year | HTTP 200 | 3.4 s |

These route durations do not all mean that a single SQL statement exceeded the
eight-second limit. The production plans and isolated calls distinguish the
cases below.

## Executive finding

Only **phantom drain** reproduces the SOH/12 V failure class: a multi-day
window function over scattered raw telemetry. Its real 14-day RPC exceeded the
live statement timeout. It should use the proven server-owned daily rollup
architecture.

The other three panels do not need daily rollups:

- **Route insights** is a bounded, trip-level batch. Its exact 80-trip RPC took
  1.997 s alone. It becomes slow when competing for pool connections and
  returns a large derived payload.
- **Lifetime map** repeats the same parallel sequential scan five times because
  it paginates to 5,000 points without a suitable tenant/time access path. A
  stable one-call reader plus predicate/index repair is cheaper and more
  faithful than a daily aggregate.
- **Period overview** already starts from trip/session summaries. Its range
  queries are fast, but it adds a raw 10,000-sample compatibility scan, up to
  40 concurrent temperature queries, quadratic-style application matching,
  and large JSON responses. This is a fan-out/read-model problem, not a daily
  time-series aggregation problem.

Error handling also needs independent correction. Phantom drain and route
insights render failed queries as empty data. Period overview can turn failed
subqueries into HTTP 200 partial results. Lifetime map is the only one of these
three lower panels that already has a distinct error presentation.

## 1. Phantom drain

### Backing route and reader

The panel calls:

```text
GET /api/vehicle/analytics?type=phantom&vehicle_id=<vehicle>
```

`fetchPhantomDrain` calls:

```sql
public.bydmate_phantom_drain_daily(
  p_user_id,
  p_vehicle_id,
  now() - interval '14 days',
  now()
)
```

The RPC reads `bydmate_telemetry_samples`, classifies every sample with
`bydmate_is_parked_unplugged`, applies three ordered window passes, groups
continuous parked intervals, and then groups them by UTC day. It has exact
`user_id`, `vehicle_id`, lower-time, and upper-time predicates. It contains no
nullable vehicle OR and no `generate_series`.

On **any** RPC error, including a statement timeout, the application starts a
paginated raw-telemetry fallback. That fallback downloads every matching raw
sample in 1,000-row pages and repeats the parked-interval calculation in
JavaScript. The intended deployment-compatibility fallback therefore amplifies
a database timeout into many more database requests.

### Production plan and timing

A representative one-day source scan used
`bydmate_telemetry_samples_user_vehicle_device_unique` with all four required
bounds. The index was selected correctly, but the heap remained expensive:

```text
Bitmap Index Scan:  9,592 index entries, 116 index buffers
Bitmap Heap Scan:   8,445 returned rows, 5,048 heap blocks
Sort:               external merge, 4,384 kB disk
Execution:          3,689.005 ms cold
```

The same one-day RPC completed warm in **499.683 ms** and returned one daily
row. The application's real 14-day RPC was cancelled in **8.045 s** by the
statement timeout.

An isolated HTTP call then received no bytes within a 30-second client cap.
The server spent that interval in the raw fallback. Under the previously
captured warm full-page load, the route eventually returned HTTP 200 in 17.9 s;
another captured run took about 70 s. The exact fallback duration varies with
cache and sibling pressure, but it is not a viable recovery path.

### What the user sees

- While the timed-out RPC is being replaced by the fallback, the panel remains
  on its loading skeleton for tens of seconds.
- If the fallback eventually succeeds, the chart appears; the timeout is never
  disclosed.
- If both paths fail and the route returns HTTP 500, React Query has an error
  and no data, but the component checks only `rows.length === 0`. It renders
  the normal `phantomEmpty` copy. A failure is therefore presented as no
  phantom-drain history.

### Recommendation

This is a **daily-rollup candidate** and the highest-priority database fix.
Reuse the proven module exactly:

1. a server-only `(user_id, vehicle_id, date)` daily table;
2. a server-only idempotent queue;
3. one tenant/vehicle/day materialiser per transaction;
4. bounded, paced backfill from retained raw data;
5. staggered enqueue/process/purge jobs;
6. independent rollup retention;
7. a stable `bydmate_phantom_drain_daily` reader seam;
8. frozen-current-reader parity against production vehicle-days before switch.

The current calculation deliberately breaks intervals at UTC date boundaries,
so a completed UTC day is independently materialisable. Preserve the exact
parked predicate, six-hour gap rule, four-hour interval threshold, first/last
valid SOC choice, and sum-of-interval-drains semantics.

Separately and sooner, restrict the raw fallback to the missing-function error
used during a deployment race. A timeout or network error must be surfaced,
not expanded into paginated raw reads. Add explicit loading/error/empty states
to the panel.

## 2. Route insights

### Backing route and reader

The panel calls:

```text
GET /api/vehicle/analytics?type=route-insights&vehicle_id=<vehicle>
```

The route:

1. reads the latest 80 `bydmate_trips` having more than one track point;
2. reads the vehicle's `bydmate_route_labels`;
3. calls `bydmate_route_insight_inputs` with exactly those trip ids;
4. for each owned trip, lateral-reads up to 500
   `bydmate_trip_track_points` and up to 200 bounded raw telemetry samples;
5. clusters and downsamples the result in the application.

The RPC explicitly binds user, vehicle, trip-id array, and per-trip time. It
contains no nullable vehicle OR and no `generate_series`.

If the RPC errors, `fetchRouteInsightInputs` returns `null` instead of throwing.
The caller then performs an N+1 fallback: one track query and one raw
temperature query per trip.

### Production plans and timing

Representative production plans were:

| Bounded operation | Plan evidence | Execution |
| --- | --- | ---: |
| Latest 80 trip ids | Bitmap heap scan of the owner/vehicle prefix; 784 eligible rows, top-N sort | 4.544 ms |
| One trip's track, limit 500 | `trip_time_idx`; 74 points, 6 buffers | 2.631 ms |
| One trip's raw temperatures, limit 200 | exact user/vehicle/time composite index; 99 rows, 60 buffers | 9.695 ms |
| RPC for one trip | function scan, 150 buffers | 8.206 ms |
| Exact application RPC for 80 trips | 80 rows | **1.997 s** |

The trip planner estimated 12 qualifying rows but found 784. It chose
`bydmate_trips_source_idx` and a top-N sort instead of the existing
user/vehicle/started-time index. The estimate is poor, but measured execution
is only 4.5 ms and is not the present bottleneck.

The isolated HTTP route returned **200 in 1.417 s** with a **115,535-byte**
payload. Under normal sibling load it returned **200 in 11.3 s**. No
statement timeout was observed in either the exact 80-trip RPC or the HTTP
route; the >8-second page timing is pool wait plus bounded computation, not the
same raw year-scan failure as SOH.

### What the user sees

- During the 11.3-second full-load call, the route-insight loading skeleton is
  shown and the section later fills normally.
- If the outer route returns HTTP 500, the component discards
  `routeInsightsQuery.error`, passes empty arrays, and `RouteInsightsSection`
  renders `routeInsightsEmpty`. Failure and genuinely insufficient repeated
  routes are indistinguishable.
- An RPC error can also be hidden by the N+1 fallback, prolonging loading and
  increasing pool pressure.

### Recommendation

This is **not a daily-rollup candidate**. Routes are per-trip facts and are
grouped by origin/destination, not calendar day.

Cheapest fixes, in order:

1. Add an explicit error state and retry action. Restrict the N+1 compatibility
   fallback to a missing-RPC error.
2. Defer this noncritical request until the selected-period/SOH requests settle
   or the section approaches the viewport. This removes it from the initial
   pool stampede without changing results.
3. If isolated latency or fleet scale later requires it, materialise immutable
   **per-trip** insight inputs at trip finalisation: route key, temperature
   averages, and a bounded representative track. This should be a per-trip read
   model, not a daily rollup.
4. Refresh planner statistics and recheck the 12-versus-784 trip estimate, but
   do not add an index based on that estimate alone; the measured query is
   already fast.

## 3. Lifetime map

### Backing route and query

The panel calls:

```text
GET /api/vehicle/lifetime-map?vehicle_id=<vehicle>
```

There is no RPC. `fetchLifetimeTrackPoints` issues up to five sequential
PostgREST queries of 1,000 rows to obtain a 5,000-point cap. Each page joins
`bydmate_trip_track_points` to `bydmate_trips`, filters the point owner and the
joined trip vehicle, orders all matches by descending point time, and applies
an offset.

There is no nullable OR and no `generate_series`. There is also no
`bydmate_trip_track_points(user_id, device_time)` index. The application does
not explicitly add `bydmate_trips.user_id = p_user_id` to the joined table;
authenticated RLS supplies ownership in the normal user path, but the stable
reader should state it directly as well.

### Production plan and timing

The first 1,000-point page performed:

```text
Parallel Seq Scan on track points:
  77,319 owner rows kept across workers
  192,576 rows removed by owner filter
  5,126 table buffers
Seq Scan on trips, repeated by 3 workers:
  851 vehicle rows kept
  12,966 rows removed per worker
Top-N sort and Gather Merge
Execution: 187.753 ms
```

The fifth page (`LIMIT 1000 OFFSET 4000`) repeated the same table scans and
completed in **117.872 ms** warm. Pagination therefore repeats a fleet-level
scan and join five times even though the final result is capped.

The isolated route returned **200 in 1.927 s** with a **663,438-byte** payload.
Under normal sibling load it returned **200 in 10.7 s**. No individual SQL
statement timed out in the bounded production probes. The risk is repeated
scan/pool/payload cost that grows with the shared track table.

### What the user sees

During the slow full-page call, the embedded map remains a skeleton and then
renders normally. Unlike phantom drain and route insights, `mapQuery.error` is
passed to `RouteMap`, which renders `vehicle.errors.history`; an HTTP 500 is
not presented as an empty map. The message is generic, but the three-way state
is already correct.

### Recommendation

This is **not a daily-rollup candidate**. A route polyline cannot be recovered
from a daily scalar aggregate, and the product explicitly wants the latest
5,000 ordered points.

Use a stable, ownership-scoped RPC that returns all 5,000 points in one call.
Inside it, bind user and vehicle on the trip side and use one of these measured
access paths:

- add `(user_id, device_time desc)` on track points, include `trip_id`, and
  join against owned vehicle trip ids; or
- fetch the bounded recent owned trip ids first, then use the existing
  `(trip_id, device_time)` index and globally limit/order their points.

Compare both with production `EXPLAIN (ANALYZE, BUFFERS)` before choosing. The
acceptance gate is one statement, no parallel sequential scan of the shared
track table, no offset rescans, identical latest-5,000 ordering, and a clearly
smaller route time under sibling load. Lazy/viewport loading is also appropriate
because this map is below the primary analytics.

## 4. Period overview

### Backing route and queries

The selected Analytics range calls:

```text
GET /api/vehicle/analytics?type=period-overview
    &from=<resolved range start>&to=<resolved range end>
    &vehicle_id=<vehicle>
```

Day additionally requests overlap semantics and the no-charge price estimate.
The route starts three branches with `Promise.allSettled`:

1. trips plus energy and temperature enrichment;
2. charging sessions;
3. day-only no-charge price estimation.

The base trip and session records are already summary/read-model rows. Raw
telemetry is read for two compatibility enrichments:

- `enrichTripsWithEnergy` always fetches up to 10,000 telemetry samples across
  the whole trip span, even when many trips already store both energy values;
- `fetchPeriodTripsEnriched` starts up to 40 separate raw-temperature queries,
  one for each recent trip.

After the 10,000-row fetch, every sample searches the trip array with
`trips.find`. For the owner's year response that is up to about 8.5 million
date/vehicle comparisons before the 40 temperature requests are considered.

### Production plans, ranges, and timing

Bounded year plans:

| Operation | Plan evidence | Execution |
| --- | --- | ---: |
| 851 year trips | owner/vehicle bitmap heap scan, 242 buffers | 2.376 ms |
| 8 day-overlap trips | same tenant prefix; `ended_at is null OR ended_at >= from` applied as a filter | 0.900 ms |
| 10,000 raw energy samples | exact user/vehicle/time composite index; 8,831 buffers | 1.041 s |
| 142 year charging sessions | owner bitmap scan, 17 buffers | 0.562 ms |

The day overlap condition is an OR, but it is not the SOH optional-vehicle
shape: the selective user and vehicle equalities remain outside the OR. The
measured query is below one millisecond. No period query uses
`generate_series`.

Stored-energy coverage by selected range:

| Range | Trips | Trips missing either energy value | Trips with tracks |
| --- | ---: | ---: | ---: |
| Day | 8 | 4 | 4 |
| Week | 63 | 30 | 33 |
| Month | 271 | 50 | 219 |
| Quarter | 718 | 64 | 665 |
| Year | 851 | 197 | 784 |

Isolated HTTP results:

| Range | HTTP | Duration | Payload |
| --- | ---: | ---: | ---: |
| Day | 200 | 1.027 s | 5,930 B |
| Week | 200 | 1.117 s | 44,937 B |
| Month | 200 | 0.992 s | 184,255 B |
| Quarter | 200 | 0.757 s | 538,146 B |
| Year | 200 | 1.041 s | 650,060 B |

Under normal year-page sibling load the route returned HTTP 200 in **3.4 s**.
No outer-route timeout was observed at any selected range.

### What the user sees

`Promise.allSettled` logs rejected branches but still returns HTTP 200:

- failed trips become `trips: []`;
- failed sessions become `sessions: []`;
- failed no-charge estimation becomes `null`.

React Query therefore reports success. Depending on which branch failed, the
user can see zero totals, no trips, no charging bars, missing price estimates,
or the cell-balance “no full charge” copy. The cell-balance component also
explicitly merges `periodOverviewQuery.error` with its legitimate no-data
state. The route does not tell the client that the result is partial.

### Recommendation

This is **not a daily-rollup candidate**. The durable domain grain is trip and
charging session, and those tables already exist.

Use cheaper repairs:

1. Return explicit branch status (or fail the route) when trips or sessions
   cannot be loaded. Give dependent panels separate error and empty states.
2. Pass only trips missing energy to raw energy enrichment. Do not open the
   raw query at all when every trip already has stored energy.
3. Replace the 40 concurrent raw-temperature calls with one tenant/vehicle/
   trip-id-bounded RPC, or persist per-trip temperature averages at trip
   finalisation. Limit database concurrency while the compatibility path
   remains.
4. Replace the linear `trips.find` per sample with an interval cursor or other
   bounded mapping. Also address the 10,000-sample cap, which can silently omit
   older missing-energy trips in long ranges.
5. Return only fields used by Analytics or aggregate chart inputs server-side;
   quarter/year responses currently exceed 0.5 MB.

## Predicate-shape audit

| Panel | Nullable OR like old SOH? | `generate_series`? | Finding |
| --- | --- | --- | --- |
| Phantom drain | No | No | Correct tenant/time index shape; raw heap volume and window aggregation are the problem. |
| Route insights | No | No | Correct bounded predicates; 80 per-trip lateral reads and fallback fan-out contend under load. |
| Lifetime map | No | No | Missing tenant/time track-point access path; repeated parallel sequential scan per page. |
| Period overview | Only the correct day-overlap `ended_at is null OR ended_at >= from` filter | No | Tenant/vehicle equality remains selective; measured at 0.9 ms. Fan-out and application work dominate. |

None reuses the broken `bydmate_enqueue_soh_backfill` `generate_series` shape.

## Recommended work order

1. **Truthful failure states and fallback containment.** Split
   loading/error/empty for phantom drain and route insights; split period
   partial/error/empty states; restrict phantom and route compatibility
   fallbacks to missing-function errors. This is the cheapest correctness and
   load-shedding change.
2. **Initial-load scheduling.** Keep selected-period telemetry/SOH/period
   overview critical. Defer phantom drain, route insights, and lifetime map
   until critical queries settle or their sections approach the viewport. This
   directly attacks the measured pool starvation and is reversible.
3. **Phantom daily rollup.** It is the only proven eight-second SQL timeout and
   the only panel matching the raw daily aggregate pattern. Require frozen
   baseline plus production parity before switching.
4. **Lifetime one-call reader and access path.** Eliminate five offset pages and
   repeated shared-table scans; compare the two bounded index strategies above.
5. **Period trip-level enrichment repair.** Skip unnecessary energy scans,
   batch temperature inputs, replace linear sample-to-trip matching, report
   partial failures, and trim payloads.
6. **Route-insight per-trip read model only if still needed.** First remeasure
   after steps 1–5. Its isolated route is already 1.417 s, so a new persistent
   model is not justified until contention and scheduling are fixed.

## Acceptance evidence required before any rollout

- No implementation or production change should follow from this document
  without owner review.
- Every proposed reader must keep explicit user and vehicle predicates and be
  tested as `authenticated` under the live eight-second timeout.
- Phantom parity must freeze the current implementation and compare production
  days, including multiple parked intervals, cross-midnight input, six-hour
  gaps, missing/invalid SOC, and no-eligible-day deletion.
- Lifetime parity must compare the exact ordered latest 5,000 points, including
  ties and multi-trip boundaries.
- Period and route changes need response-contract tests proving HTTP/database
  failures cannot become successful empty data.
- Remeasure both isolated routes and one warm Analytics page with normal sibling
  load; isolated improvement alone is insufficient.

## Approved steps 1–2 validation

Implementation validation date: **2026-09-04**. No migration, schema change, or
reader switch was made.

The browser loaded the owner vehicle's year Analytics view through the local
development proxy against production data. The capture was warm (the route and
client chunks had already compiled) and retained the page's normal sibling
requests. The critical requests all started at `12:31:25.101–12:31:25.104Z`;
the deferred group did not start until `12:31:28.569–12:31:28.570Z`, after the
last critical request settled.

| Request | Before | After approved scheduling | Result |
| --- | ---: | ---: | --- |
| Selected-period telemetry | not separately captured | 0.912 s | HTTP 200 |
| SOH | not separately captured | 2.517 s | HTTP 200 |
| Period overview, year | 3.4 s | 3.284 s | HTTP 200 |
| Phantom drain | 17.9 s, HTTP 200 after fallback | 9.013 s | HTTP 500; explicit panel error |
| Route insights | 11.3 s | 12.453 s | HTTP 200 |
| Lifetime map | 10.7 s | 10.459 s | HTTP 200 |

The important scheduling result is the **3.465 s start separation** between
the critical and noncritical groups. The lower-panel durations remain variable
and slow when they run together; this change intentionally does not implement
the unapproved query/schema work recommended later in this document.

The phantom timeout now stops at the failed RPC instead of starting the raw
compatibility scan. A fresh browser document showed the localized load-error
message and retry action after the HTTP 500; it did not show the legitimate
empty-state copy. Route insights returned normally in this capture. Automated
tests separately exercise its HTTP 500, database-timeout, and empty-result
states, along with the same three states for phantom drain and period overview.
