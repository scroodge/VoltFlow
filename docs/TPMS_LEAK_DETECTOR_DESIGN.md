# Cross-wheel TPMS slow-leak detector design

Status: design only, awaiting implementation approval. No feature code or database
change is part of this document.

Date: 2026-08-28. Inputs: `docs/TPMS_DATA_INVENTORY.md`, the current
`EvAcChargeTimer` analytics and rollup implementations, and the established 12 V
self-baselining pattern.

## Recommendation

Build a **cross-wheel differential detector**, not a temperature-compensated absolute
pressure detector.

For each wheel, compare its pressure with the other three wheels, learn that wheel's
normal positional offset, and look only for a sustained negative departure from that
offset. Shared thermal and drive-cycle pressure changes then cancel as common mode.
This naturally supports cars whose front and rear tyres have different specified
pressures because each position gets its own baseline.

The design should ship in two stages:

1. durable, sanitized daily TPMS rollups plus a read-only Analytics graph and a silent
   detector result;
2. after replaying production history and validating false-positive behavior, enable
   the user-facing “possible slow leak” interpretation.

Do **not** add Telegram or web-push notifications in this scope. Alerting is a separate
owner decision after the detector has production evidence.

Do **not** add an ambient-temperature absolute alert as a v1 backstop. It would detect
some common-mode loss, but the car's outside-air sensor is not tyre temperature and
would recreate the false-positive problem this design is intended to avoid. Preserve
the limitation honestly: four tyres leaking at similar rates are invisible to a purely
differential detector. A future ambient-regressed common-mode experiment may be useful
as a clearly weaker, separately validated signal, not as part of this detector's verdict.

## Domain language

Use these terms consistently in code, SQL, tests, and UI copy:

- **Qualified sample**: one telemetry sample in which all four pressures pass the TPMS
  validity rule.
- **Peer pressure**: the median pressure of the other three wheels for one wheel.
- **Wheel offset**: a wheel's pressure minus its peer pressure in the same sample.
- **Daily wheel offset**: the median wheel offset across a completed UTC day.
- **Baseline epoch**: one uninterrupted equipment/configuration regime between confirmed
  pressure discontinuities such as rotation, replacement, or top-up.
- **Baseline offset**: the median daily wheel offset for one position within the current
  baseline epoch and trailing window.
- **Divergence**: daily wheel offset minus baseline offset. Negative means that wheel has
  fallen relative to its peers.
- **Step candidate**: an abrupt vector change that may be maintenance rather than a leak.
- **Possible slow leak**: the sole positive detector result; it is not a safety diagnosis.
- **Insufficient history**: a deliberate silent result, not “healthy.”

## 1. Differential and self-baseline

For a qualified pressure vector

```text
P(t) = [FL(t), FR(t), RL(t), RR(t)]
```

define, for each wheel `i`:

```text
peer_i(t)   = median(P_j(t) for j != i)
offset_i(t) = P_i(t) - peer_i(t)
```

The wheel itself is never included in its comparator. A leaking wheel therefore cannot
pull its own reference down and mask part of its loss.

The median of the other three is recommended over their arithmetic mean. It is still a
true leave-one-out comparison, but one abnormal peer cannot move the comparator by one
third of its error. This keeps a single leaking wheel's signal concentrated on that
wheel instead of creating smaller opposite-sign movements on all three siblings.

For each completed UTC day, compute the median of each wheel's sample offsets. For wheel
`i`, within the current baseline epoch:

```text
baseline_i = median(daily_offset_i over the prior 90 calendar days)
divergence_i(day) = daily_offset_i(day) - baseline_i
```

The baseline excludes the day being evaluated. It uses at most the preceding 90 calendar
days and only qualified daily rows from the current epoch.

### Front/rear specification differences

Yes, the per-position baseline absorbs normal front/rear differences. For example, if
both fronts normally run 250 kPa and both rears 270 kPa, front positions will learn a
stable negative offset and rear positions a stable positive offset. The detector uses
departure from those learned offsets, not proximity to zero and not one fleet-wide tyre
target.

It also absorbs smaller stable left/right differences caused by sensor calibration or
vehicle loading. A baseline is always scoped to `(user_id, vehicle_id, wheel position,
baseline epoch)`; it is never shared between vehicles or positions.

### Initial detector rule

The first implementation should expose one pure domain module with a small interface:

```text
evaluateTpmsLeak(dailyRows) ->
  insufficient_history |
  stable |
  step_pending |
  possible_slow_leak(wheel, divergenceKpa, slopeKpaPerWeek, sustainedDays)
```

All validity, epoch segmentation, robust baseline math, step handling, and evidence
counts stay behind this interface. The graph and any future alert adapter consume the
same result; callers must not reproduce thresholds.

Recommended conservative starting rule for `possible_slow_leak`:

- current divergence is at most **-10 kPa**;
- divergence is at most -10 kPa on at least **3 of the latest 4 qualified days**;
- a robust Theil-Sen slope over the latest 14 qualified days is at most
  **-1.5 kPa/week**;
- the wheel is not in a pending or recently reset step epoch;
- the other three wheels do not show a matching common-mode decline.

The threshold is intentionally 10 kPa: it is well above the 1 kPa integer resolution
and ordinary small cross-wheel jitter, while still representing a meaningful loss.
It is a calibration candidate, not an unquestioned truth. Before enabling the label,
replay every production stream and publish counts of candidate episodes, duration,
wheel, preceding pressure, and whether they coincide with detected steps. Thresholds
must be adjusted from that evidence rather than tuned to fixtures.

Do not create “healthy / watch / danger” categories. `stable` means only “no sustained
cross-wheel divergence found in the available data.” It does not certify tyre safety.

## 2. Confounders and baseline re-anchoring

The range carry-over precedent in
`src/features/charging/_domain/charging-math.ts` and
`src/features/charging/_domain/charging-live.ts` establishes the useful principle:
derived continuity may bridge a bounded gap, but a fresh observed discontinuity becomes
the new truth. TPMS should apply that principle through explicit baseline epochs rather
than slowly averaging a maintenance step into the old baseline.

### Step detection input

Operate on consecutive qualified daily pressure vectors, not individual 1 Hz rows. Let
`Q(day)` be the four per-wheel daily median pressures. Estimate ordinary short-term noise
per position from the median absolute deviation (MAD) of recent daily changes.

A position is a step candidate when its one-day change is at least:

```text
max(8 kPa, 4 * recent change MAD)
```

Eight kPa is the initial floor because it exceeds integer sensor jitter without waiting
for the 10 kPa slow-leak threshold. As with detector thresholds, production replay must
validate it.

A step becomes **confirmed** only after two later qualified days remain within 3 kPa of
the candidate post-step level. Until then the result is `step_pending`; the slow-leak
verdict stays silent rather than interpreting an unresolved discontinuity.

### Tyre rotation

Rotation changes which physical tyre/sensor occupies each position, so learned offsets
can swap abruptly. At a step candidate, compare the post-step pressure vector with every
permutation of the pre-step vector:

- classify as a rotation candidate when a non-identity permutation reduces robust
  matching error materially and fits within 3 kPa per matched position;
- require the two-day plateau confirmation;
- then close the old epoch and open a new epoch for **all four positions**.

Do not attempt to keep following a physical sensor across positions: the payload has no
sensor identity. The detector's domain is wheel position, so a rotation starts new
position baselines.

Rotation can be mathematically invisible when all tyres had nearly equal pressure. That
is harmless because the old and new offsets are then effectively equivalent.

### Top-up

An abrupt positive step in one or more positions followed by a plateau is maintenance,
not a leak. After confirmation:

- one-position top-up opens a new epoch for that position;
- multi-position or common-mode top-up opens a new epoch for all affected positions;
- all detector evidence before the epoch boundary remains visible on the graph but does
  not contribute to the new baseline.

### Tyre replacement

Replacement can move pressure either up or down and can affect one or all positions.
Multi-position coherent steps and permutation-like changes use the automatic rules above.
An isolated negative step is fundamentally ambiguous: telemetry alone cannot distinguish
a replacement installed at lower pressure from a rapid pressure loss.

The safe treatment is:

1. immediately annotate a **sudden pressure change** in the graph;
2. suppress the slow-leak verdict while the step is unresolved;
3. if it settles to a plateau for seven qualified days, automatically open a new epoch
   and label the annotation “baseline restarted after pressure step”;
4. if it continues downward, cancel re-anchoring and evaluate it as leak evidence.

This seven-day silence is a deliberate limitation. The feature is a slow-leak trend tool,
not an acute puncture warning, and should never imply that users can ignore the vehicle's
native TPMS warning. A later maintenance-confirmation action could re-anchor immediately,
but adding that workflow is not required for v1.

### Baseline after any reset

Never blend the old and new epochs. After re-anchoring, the detector returns
`insufficient_history` until the new epoch independently satisfies the minimum-history
gate. This is stricter than an exponentially weighted baseline, but it prevents routine
maintenance from leaving a long false leak tail.

## 3. Prerequisites

### 3.1 Sentinel and plausibility handling

Current TPMS persistence is unclamped. Production contains 303,596 zero wheel-readings,
including three zero-only vehicle streams. Zero means unavailable, not zero pressure.

Define one shared analytical validity function:

```text
validTpmsKpa(p) = finite numeric AND 100 < p <= 500
qualifiedSample = validTpmsKpa(FL) AND validTpmsKpa(FR)
                  AND validTpmsKpa(RL) AND validTpmsKpa(RR)
```

This matches the existing live display's lower-bound behavior and retains observed severe
low readings such as 107 kPa for analysis. The upper bound admits unusually high
passenger-vehicle readings without accepting arbitrary sentinels. It is an analytics
filter, not a claim that 101 or 500 kPa is safe.

If any wheel is invalid, discard the whole sample before peer or differential math. Never
substitute, carry forward, average three wheels, or turn an absent wheel into zero. Store
counts of rejected and qualified samples in the rollup so data quality remains visible.

This shared rule must be used by the one-day materializer, current-day reader, pure
detector module, and chart normalization. Duplicated hardcoded bands would recreate the
same raw-field exposure in several places.

Adding an ingest clamp is worth considering separately because it protects all future
consumers, but it is not sufficient for this feature: historical zeros already exist and
rollup materialization must remain defensive.

### 3.2 Server-owned TPMS daily rollup

A detector baseline cannot depend on raw telemetry that disappears after 30 days, and a
multi-day reader must not aggregate `bydmate_telemetry_samples` on demand. The one-week
12 V raw query took 105 seconds and exhausted the authenticated timeout; that production
outage pattern must not be repeated.

Follow the shipped auxiliary-voltage design with a dedicated server-owned table:

`public.bydmate_tpms_daily_rollups`

| Column | Type | Purpose |
|---|---|---|
| `user_id` | `uuid not null` | Owner scope |
| `vehicle_id` | `text not null` | Vehicle stream |
| `date` | `date not null` | Completed UTC day |
| `pressure_fl/fr/rl/rr_median_kpa` | `numeric` | Daily per-position median pressure from qualified samples |
| `offset_fl/fr/rl/rr_median_kpa` | `numeric` | Daily median leave-one-out wheel offset |
| `offset_fl/fr/rl/rr_mad_kpa` | `numeric` | Within-day offset variability / quality evidence |
| `qualified_sample_count` | `integer not null` | Samples contributing to all four wheels |
| `rejected_sample_count` | `integer not null` | Rows with any present TPMS value but failing qualification |
| `first_qualified_at` / `last_qualified_at` | `timestamptz` | Coverage span and auditability |
| `computed_at` | `timestamptz not null default now()` | Materialization freshness |

Primary key: `(user_id, vehicle_id, date)`. Keep rollups for five years independently of
raw retention, matching auxiliary voltage. Do not add TPMS to
`bydmate_telemetry_hourly`: it has both server and APK writers, which would duplicate
aggregation rules in SQL and Kotlin.

The rollup stores observations, not detector verdicts or baseline epochs. Epoch detection
is deterministic domain logic over daily rows, allowing thresholds to evolve without
rewriting historical aggregates.

Create a separate server-only queue keyed by `(user_id, vehicle_id, date)`. An idempotent
one-day materializer:

1. accepts only a completed UTC day;
2. reads exactly one vehicle/day from raw telemetry;
3. applies the shared validity rule before all math;
4. upserts one daily row or removes an obsolete row when no qualified sample exists;
5. removes its queue item in the same transaction.

Cron enqueues completed days, and a bounded worker claims a small number with
`FOR UPDATE SKIP LOCKED`. Schedule it offset from the existing aux-voltage worker so two
heap-heavy materializers do not compete. Start at one vehicle-day per invocation and
increase only after measured production timings. Nothing runs on telemetry ingest.

The reader is an ownership-scoped `SECURITY INVOKER` RPC performing an indexed range read.
The table and queue use RLS; `authenticated` may select owned rollups but cannot write;
maintenance functions fix `search_path`, revoke `PUBLIC` execution, and grant only the
cron/service role needed by the current self-hosted deployment.

Backfill is queue-based, resumable, and limited to raw history that still exists. Never
run one fleet-wide aggregate transaction. Before the reader switch, preserve a restricted
raw baseline function and prove daily parity with a null-safe full join on production,
including zero-only, partial-invalid, sparse, dense, and pressure-step days.

### Current-day path

Completed-day rollups are the authority for baselines and sustained verdicts. For the Day
graph only, extend the existing bounded day-bucket path to return the four flat TPMS columns
and compute display differentials in the shared domain module. This is acceptable because
the day query is already bounded and bucketed; it must not become a new multi-day raw scan.
Current-day points may enrich the graph but cannot satisfy a multi-day sustained detector
rule until the completed-day rollup exists.

## 4. Data sufficiency and silent degradation

Production reality is narrow: 9 of 14 streams have any usable pressure, only eight have
substantial histories, three are zero-only, and most usable history starts in late July.
The feature must not turn missing data into reassurance or warnings.

A baseline is sufficient only when the current epoch has:

- at least **14 qualified completed days**;
- those days span at least **21 calendar days**;
- at least **3 qualified days in the latest 4 completed days**;
- at least 10 qualified samples on each contributing day, spanning at least 30 minutes;
- no unresolved step candidate.

Fourteen days follows the shipped 12 V self-baseline precedent; the 21-day span prevents
one dense fortnight from masquerading as a slow trend. The recency requirement prevents
an old baseline from evaluating a car that has stopped reporting.

Results:

- no usable stream / zero-only / incomplete wheel tuple: show a neutral “Tyre-pressure
  history unavailable” state and no detector language;
- some usable data but below the gate: show the graph where possible plus “Learning your
  normal wheel differences: N of 14 days”; no stable/leak verdict;
- stale history: show historical graph and “Not enough recent readings”; no verdict;
- after maintenance re-anchor: restart the count at zero for affected positions and explain
  that the baseline is learning again.

The server response should carry evidence counts and explicit insufficiency reasons so the
UI never reconstructs these gates from nulls.

## 5. Analytics surface and graph

Place a **Tyre pressure balance** panel in History -> Analytics next to the 12 V health
work. Its purpose is explanation first, verdict second.

### Primary graph: relative drift

Plot four wheel divergence series in kPa:

```text
daily wheel offset - that wheel's current-epoch baseline offset
```

- zero line: that position's learned normal relationship to its peers;
- one stable color per wheel (FL, FR, RL, RR), with redundant labels/line styles so color
  is not the only distinction;
- negative is below peers relative to normal;
- break lines across missing days with the shared gap helpers;
- annotate epoch boundaries and pending/confirmed steps;
- shade only sustained detector episodes, not every threshold crossing;
- tooltip: date/time, all four actual pressures, selected wheel's peer pressure, learned
  offset, divergence, and data-quality count.

For Day, use bucketed qualified samples and the historical baseline; for week/month/
quarter/year, use daily rollups. The Y-axis is differential kPa, not the user's display
unit, unless the whole panel consistently converts thresholds, labels, tooltips, and
accessible text together. Prefer honoring the existing profile pressure unit while keeping
all detector math and storage in kPa.

Reuse `src/components/vehicle/chart-interaction.tsx`:

- `STD_CHART` for geometry;
- `chartLineGapMs`, `splitByTimeGap`, and `buildBrokenLinePaths` for honest gaps;
- `clientToSvg`, `nearestPointByTime`, `nearestIndexByX`, `ChartHoverCrosshair`,
  `ChartDataTooltip`, and `InteractiveChartShell` for pointer interaction and tooltips.

Do not hand-roll a second interaction model. Match the 12 V panel's range behavior,
calendar anchors, loading/error/empty states, stat-card density, accessible SVG labeling,
and hover conventions.

### Supporting text and stats

Above or below the graph, show:

- detector state in plain language;
- the wheel and sustained divergence only for `possible_slow_leak`;
- baseline progress / evidence-day count;
- “Compares each wheel with the other three; shared temperature changes mostly cancel”;
- “Cannot detect all four tyres losing pressure together; always follow the vehicle's
  native TPMS warning and door-jamb pressure specification.”

Do not present a fleet norm, recommended pressure, safety grade, or predicted time to flat.

## 6. What the method cannot detect

- all four wheels leaking at approximately the same rate;
- two axle pairs declining symmetrically enough to preserve learned offsets;
- a leak during a long reporting gap;
- acute punctures reliably (this is a daily slow-trend detector);
- whether an abrupt isolated negative step was service or damage;
- absolute under/over-inflation when all positions share it;
- tyre condition, tread, load suitability, or manufacturer pressure compliance.

An ambient-regressed absolute backstop is technically possible: learn each vehicle's
common-mode pressure as a function of outside temperature and flag a sustained residual.
It is not recommended for v1 because ambient is not tyre temperature and heat soak differs
after driving, braking, sun, and garage transitions. If investigated later, it must have a
separate result (`possible_common_mode_loss`), a higher evidence gate, no safety language,
and independent production replay. It must never be combined with differential evidence in
a way that makes a weak ambient proxy appear stronger.

## 7. Module and data-flow design

The detector should be a deep module at the domain seam:

```text
raw telemetry
  -> one-day server materializer (validity + daily observations)
  -> indexed TPMS daily rollups
  -> ownership-scoped reader
  -> evaluateTpmsLeak(dailyRows)
       [epoch segmentation, baseline, slope, sustained evidence]
  -> Analytics panel / future alert adapter
```

Recommended implementation locality after approval:

- SQL migration(s): rollup table, queue, one-day materializer, worker, reader, retention;
- `src/lib/voltflowmate/tpms.ts`: shared types, kPa validation, peer/offset math;
- `src/lib/voltflowmate/tpms-leak-detector.ts`: the single detector interface and pure
  deterministic implementation;
- history query/hook adapter: fetch daily rows without exposing database mechanics to UI;
- one chart module using shared chart interaction primitives;
- Analytics panel wiring and localized copy.

The exact filenames may follow repository conventions during implementation, but do not
split threshold logic across SQL, hooks, and React. SQL owns durable daily observations;
the domain module owns interpretation; React owns presentation.

## 8. Verification and rollout gates

Implementation is not ready to expose a leak verdict until all gates pass:

1. Unit tests for four-wheel math prove the evaluated wheel is excluded from its peer,
   front/rear offsets baseline correctly, common-mode changes cancel, and one-wheel drift
   remains visible.
2. Validity tests cover null, numeric zero, all known zero-only streams, 100/101/500/501,
   partial wheel tuples, and non-finite inputs.
3. Epoch tests cover rotation permutations, all/single top-up, one/all replacement,
   isolated negative steps, failed plateau confirmation, continued decline, reporting gaps,
   and post-reset silence.
4. Rollup parity compares the preserved raw implementation with materialized rows using
   production days and requires zero mismatches.
5. Query plans show the public multi-day reader uses the rollup primary key and remains
   comfortably inside the 8-second authenticated timeout under concurrent Analytics load.
6. Backfill runs in bounded queue batches with measured per-day timings and no ingest
   contention.
7. Fleet replay reports, without user identifiers: eligible streams, insufficient-history
   streams, step candidates by class, re-anchors, possible-leak episodes, duration, maximum
   divergence, and sensitivity at nearby threshold choices.
8. The first release may show graph + “learning/stable” evidence but keeps the positive leak
   label behind a server-controlled flag until owner review of replay evidence.

## 9. Explicitly deferred

- Telegram and web-push alerting;
- native APK changes;
- ambient-temperature absolute/common-mode detection;
- user-entered manufacturer pressure targets;
- maintenance-confirmation/reset workflow;
- fleet-level pressure recommendations;
- acute puncture detection.

Implementation should begin only after approval of this design and, before enabling any
positive detector wording, separate approval of the production replay results.
