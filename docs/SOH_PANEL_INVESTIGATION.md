# SOH Panel Production Investigation

Date: 2026-09-03

Scope: read-only production investigation of the Analytics tab's Battery health
(SOH) panel. No application code, database schema, or production data was
changed during the investigation.

## Conclusion

The owner has valid SOH telemetry. The panel says "No SOH history available
yet" because the exact year-long `bydmate_soh_daily` RPC used by the app times
out, the API turns that into HTTP 500, and the component renders query errors
with the same copy as a successful empty response.

This is primarily a query-performance problem, hidden by a separate client-side
error-state problem. It is not an owner data-absence problem.

## Exact app-call result

For anchor date `2026-09-03`, the hardcoded year range resolves to:

- `p_from`: `2025-09-04T00:00:00.000Z`
- `p_to`: `2026-09-03T23:59:59.999Z`
- owner user ID: `4e5c7688-8e10-43b2-b562-81fe3d3d6788`
- vehicle ID: `way`

Called as the authenticated role with the production 8-second statement
timeout, `bydmate_soh_daily` did **not return a result set**. PostgreSQL returned:

```text
ERROR: canceling statement due to statement timeout
CONTEXT: SQL function "bydmate_soh_daily" statement 1
Time: 8050.590 ms
```

Therefore the year call's returned row count is **unavailable**, rather than
zero: the call fails before it can return rows. An outer `LIMIT 5` did not help
because the SQL function must finish its aggregation first.

As a bounded confirmation that the RPC does return the owner's existing data,
the same RPC for 2026-09-03 alone returned **1 row** in about **465 ms**:

- SOH: **97%**
- device time: **2026-09-03 13:02:26.835 UTC**

## SOH source and population

The RPC reads `bydmate_telemetry_samples.telemetry->'soh_percent'` through
`bydmate_jsonb_numeric`, accepts values from 0 through 100, and chooses the
latest valid sample for each UTC day.

For the owner vehicle on 2026-09-03:

- total raw samples: **5,325**
- samples where the SOH key is present: **5,325**
- samples with numeric non-null SOH: **5,325**
- NULL rate: **0.000%**
- newest valid owner value: **97% at 2026-09-03 13:02:26.835 UTC**

Across current production live snapshots for the 14 configured Mate vehicles:

- snapshots with non-null SOH: **12/14**
- snapshots with null SOH: **2/14**
- current snapshot NULL rate: **14.29%**

The newest valid raw SOH found production-wide was **100% at 2026-09-03
13:03:42.659 UTC**.

## Fleet coverage

The production set of 14 vehicles is the set of `cars` rows with a nonblank
Mate `vehicle_alias`.

- vehicles with valid raw SOH in the app's one-year window: **10/14**
- vehicles without valid raw SOH in that window: **4/14**

There are 18 identities in `bydmate_live_snapshots`; 14 is the configured-car
scope requested here. The fact that 12 configured vehicles have current live
SOH but only 10 have retained raw SOH history is consistent with the live
snapshot carry-forward behavior and raw telemetry retention.

## Query shape and timeout cause

`bydmate_soh_daily` aggregates directly over
`public.bydmate_telemetry_samples`; it does not read a daily rollup. Its plan:

1. Uses the partial `(user_id, vehicle_id, device_time desc)` SOH index to find
   candidate entries.
2. Performs a bitmap heap scan to fetch the JSON telemetry values.
3. parses and validates `soh_percent`.
4. sorts by UTC date and descending device time.
5. applies `DISTINCT ON` to retain one row per day.

The production planner estimated **187,718 matching index entries** for the
owner's year window. The raw telemetry table was **2,543 MB**, with **1,153 MB**
of indexes. Because the SOH value is stored in JSON and is not present in the
partial index, the query still fetches scattered heap pages.

This is the same raw-history aggregation shape described in
`docs/AUX_ROLLUP_DESIGN.md`. It can additionally suffer from sibling-panel
connection-pool starvation, but sibling load was not required for this repro:
the isolated authenticated RPC already exceeded its 8-second timeout.

## How the failure becomes misleading copy

1. `fetchSohTelemetryHistory` hardcodes `resolveTelemetryWindow("year", ...)`.
2. The timed-out Supabase RPC throws an error.
3. `/api/vehicle/telemetry/soh` catches it and returns generic HTTP 500.
4. `useVoltflowMateSohHistoryQuery` turns the non-success response into a query
   error.
5. `vehicle-analytics-panels.tsx` uses one branch for
   `sohQuery.error || data.length === 0` and displays `sohNoData` in both cases.

## Recommendations (not implemented)

### Query/data path

- Treat the owner incident as query-side, not data-side.
- Materialize one SOH row per vehicle/day and change `bydmate_soh_daily` to an
  indexed daily-rollup read, following the auxiliary-battery rollup pattern.
- Backfill only retained raw history and populate completed days incrementally.
- Separately decide whether the panel intentionally always shows one year. If
  not, pass the selected analytics range instead of hardcoding `year`. Shorter
  ranges reduce work but are not a substitute for a reliable year reader.

### UI error handling

- Render `sohQuery.error` separately, with copy such as "Couldn't load SOH
  history" and a retry action.
- Use "No SOH history available yet" only after a successful response with zero
  points.
- Preserve safe error context in server logs so timeouts, missing RPCs, and
  authorization failures can be distinguished.
