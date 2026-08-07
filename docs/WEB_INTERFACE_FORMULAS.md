# Web interface formulas

This reference lists the product values VoltFlow calculates and shows in the web
interface. It is organized by page so a displayed number can be traced to its formula,
meaning, and owning implementation.

Canonical domain behavior remains in [Charging sessions](CHARGING_SESSIONS.md),
[Trips](TRIPS.md), and [Telemetry](../supabase/TELEMETRY.md). If this reference conflicts
with one of those documents, reconcile the conflict rather than treating this summary as
a new source of truth.

## Scope, notation, and terminology

Included: user-visible product calculations performed in the browser, Next.js server,
or database read model. Raw telemetry displayed unchanged is identified where useful but
is not a formula. Excluded: SVG/map geometry, chart coordinates, pagination, validation-
only thresholds, image sizing, and ordinary number/date formatting.

### Formula notation

| Symbol or term | Meaning | Unit or range |
| --- | --- | --- |
| `C` | Configured usable battery capacity when the battery is full | kWh |
| `SOC` | Battery state of charge: how full the battery is | 0–100% |
| `start SOC` | Battery percentage at the start of a charge or trip | 0–100% |
| `current SOC` | Latest selected battery percentage: preferably live, otherwise telemetry or an estimate | 0–100% |
| `target SOC` | Battery percentage at which the user wants charging to stop | 0–100% |
| `SOC gain` | `current SOC − start SOC`; percentage points added during charging | Percentage points |
| `SOC drop` | `start SOC − end SOC`; percentage points used during driving | Percentage points |
| `SOH` | Battery state of health relative to nominal capacity | Percent |
| `η` | Tariff-specific charging efficiency: the share of grid energy stored in the battery | Percent |
| `P` | Charging power: the rate at which energy is delivered | kW |
| `live P` | Fresh grid-side charging power reported by the vehicle | kW |
| `P_grid` | Grid-side power used for a displayed power value or grid-energy ETA | kW |
| `P_batt` | Battery-side equivalent power used by SOC projection: `P_grid × η/100` | kW |
| `p` | Electricity price for one grid-side kWh | Currency/kWh |
| `d` | Driving distance | km |
| `battery energy` | Energy stored in or removed from the battery cells | kWh |
| `grid energy` | Electricity drawn from the wall or charging provider; includes charging losses and auxiliary use | kWh |
| `remaining battery energy` | Battery-side energy still needed to move from current SOC to target SOC | kWh |
| `remaining grid energy` | Electricity the charger is expected to draw from now until target SOC, including losses | kWh |
| `charged grid energy` | Electricity estimated to have been drawn by the charging session so far | kWh |
| `usable energy` | Energy currently available for driving after applying SOC and, in the AI range model, SOH | kWh |
| `traction energy` | Gross energy used by the motor to move the car | kWh |
| `regen energy` | Energy recovered through regenerative braking | kWh |
| `net driving energy` | `traction energy − regen energy` | kWh |
| `consumption` | Energy used to travel 100 km | kWh/100 km |
| `predicted consumption` | Forecast consumption blended from multiple current and historical signals | kWh/100 km |
| `percent/second` | Estimated charging rate: `(P / C × 100) / 3600` | Percentage points/second |
| `elapsed seconds` | Wall-clock seconds since the session began | Seconds |
| `active seconds` | Charging seconds used in the estimate, capped at the calculated completion time | Seconds |
| `weight` | Relative influence assigned to one input in a blended forecast | Unitless |
| `environment factor` | Bounded multiplier representing temperature, speed, HVAC, and tyre-pressure effects | Unitless multiplier |
| `clamp(value, min, max)` | Restrict a value so it cannot fall below `min` or exceed `max` | Same unit as value |
| `Σ` | Sum all matching values | Depends on the values |

### Meaning of the main terms

| Term | Plain-language meaning | Example |
| --- | --- | --- |
| Battery capacity | The amount of energy the battery can hold when full. This is the car's configured usable capacity, not the current energy in the battery. | A 45.1 kWh battery at 50% contains about 22.6 kWh before applying any SOH adjustment. |
| Battery-side energy | Energy that actually reaches or leaves the battery cells. During charging it is smaller than the electricity drawn from the charger because some energy is lost or used by cooling, heating, and electronics. | If 18 kWh reaches the battery at 90% efficiency, the charger supplies about 20 kWh. |
| Grid-side energy | Electricity drawn from the wall or charging provider. This is the value relevant to the electricity bill. | `18 battery kWh / 0.90 efficiency = 20 grid kWh`. |
| Energy needed by the battery | Battery-side energy required to move from the current SOC to the target SOC. | A 45 kWh battery moving from 40% to 80% needs `45 × 40% = 18 battery kWh`. |
| Remaining grid energy | Estimated electricity the charger still needs to supply before the battery reaches the selected target. It includes charging losses and is therefore normally greater than the remaining battery-side energy. | From 40% to 80% on a 45 kWh battery at 90% efficiency: `18 / 0.90 = 20 grid kWh remaining`. |
| Charged grid energy | Estimated electricity already supplied by the charger during the current session. This drives the estimated cost. | A 20% SOC gain in a 45 kWh battery at 90% efficiency is `45 × 20% / 0.90 = 10 grid kWh`. |
| Charging efficiency | Percentage of charger energy that becomes stored battery energy. VoltFlow uses tariff-specific values because AC and fast DC losses differ. | At 90% efficiency, 10 grid kWh stores about 9 battery kWh. |
| Charging power | How quickly energy is being delivered at this moment or on average. Power is kW; energy accumulated over time is kWh. | A steady 7 kW charger supplies about 7 kWh in one hour. |
| Traction energy | Energy used to move the car. It is a gross driving-energy value before subtracting energy later recovered through regeneration. | A trip may use 5 kWh for traction and recover 0.7 kWh through regen. |
| Regenerated energy | Energy recovered when the motor slows the car and sends electricity back to the battery. | With 5 kWh traction and 0.7 kWh regen, net battery use is about 4.3 kWh. |
| Net consumption | Driving consumption after subtracting regenerated energy. | `(5 − 0.7) / 25 km × 100 = 17.2 kWh/100 km`. |
| Gross driving energy | Total traction energy before subtracting regeneration. History uses this for the charged-versus-driven energy balance. | In the example above, gross driving energy is 5 kWh. |
| SOC gain/drop | Difference between two battery percentages, expressed in percentage points rather than a relative percent change. | Moving from 40% to 60% is a 20-point SOC gain. |
| Distance-weighted average | An average where longer trips influence the result more than shorter trips. | A 100 km trip contributes ten times as much as a 10 km trip. |
| Median | The middle value after sorting observations. It is less sensitive to one unusually high or low trip than an arithmetic average. | For `14, 15, 30`, the median is 15. |
| Estimate or fallback | A calculated substitute used when a preferred measured value is unavailable. It should not be read as a direct vehicle measurement. | Wall-clock charging progress is a fallback when live SOC is stale. |
| Forecast | A projection that intentionally blends several signals and assumptions. It may differ from both the car's raw value and a simple historical average. | AI estimated range blends recent consumption, live power/speed, weather effects, and SOH. |

### Worked charging example

Assume a 45 kWh battery is at 40%, the target is 80%, efficiency is 90%, charging
power is 7 kW, and electricity costs 0.50 per kWh:

1. SOC still required: `80% − 40% = 40 percentage points`.
2. Battery-side energy still required: `45 × 40 / 100 = 18 kWh`.
3. **Remaining grid energy:** `18 / 0.90 = 20 kWh`. This is the electricity the charger
   is expected to draw to put 18 kWh into the battery.
4. Estimated time: `20 / 7 = 2.86 hours`, or about 2 h 51 min.
5. Estimated cost: `20 × 0.50 = 10.00` in the selected currency.

## Dashboard (`/dashboard`)

| Dashboard element | Formula or rule | Explanation |
| --- | --- | --- |
| Available battery energy | `C × clamp(SOC, 0, 100) / 100` | Converts current battery percentage into available kWh. |
| Battery display | `available kWh / C` | Shows available energy beside full pack capacity. |
| Estimated range | `usable energy / predicted consumption × 100` | Projects distance from available battery energy and blended consumption. |
| SOH-adjusted capacity | `C × clamp(SOH, 70, 105) / 100` | Adjusts usable capacity for measured battery health. |
| Predicted consumption | `Σ(estimate × weight) / Σweight` | Blends current-trip, recent-trip, energy-derived, instantaneous-power, reported-range, and historical estimates. |
| Instantaneous consumption input | `power kW / speed km/h × 100` | Converts live traction power and speed to kWh/100 km when speed is suitable. |
| Reported-range consumption input | `(usable battery × SOC/100) / reported range × 100` | Derives the consumption implied by the car's own range figure. |
| Environment adjustment | `predicted consumption × environment factor` | Applies bounded penalties for temperature, high speed, HVAC, and low tyre pressure. |
| Energy to charge to 100% | `C × (100 − SOC) / 100 / (η/100)` | Estimates grid energy required to fill the battery. |
| Estimated charge cost | `required grid energy × p` | Prices the estimated grid energy. |
| AC time to 100% | `required grid energy / P` | Assumes constant AC charging power. |
| DC time to 100% | Sum of SOC-band times | Uses selected power to 70%, then caps it at 45 kW to 90%, 25 kW to 95%, and 15 kW to 100%. |
| Active-charge remaining SOC | `max(0, target SOC − current SOC)` | Percentage points remaining to the target. |
| Active-charge remaining time | `remaining grid energy to 100% / P_grid` | Dashboard active charging shows the time to 100%; `P_grid` is the resolved active-session power, including the guarded AC observed-average rule below. |
| Active-charge resolved power | `resolveChargingEtaPowerKw(live P, observed session energy/time, fallback)` | Fresh live power wins; after 15 minutes and 2 SOC points, a mature integer-only AC reading may use the observed average when both values share an integer bucket. DC and already-decimal live readings remain live; otherwise the session/car/default fallback is used. |
| Latest charge duration | `stop time − start time` | Elapsed time of the latest charging session. |
| Latest trip SOC pair | `start SOC → end SOC` | Raw stored trip values displayed together; not a derived energy result. |

Owning sources: [`dashboard-view.tsx`](../src/components/dashboard/dashboard-view.tsx),
[`charging-math.ts`](../src/features/charging/_domain/charging-math.ts),
[`range-estimate.ts`](../src/lib/bydmate/range-estimate.ts), and
[`dashboard-deferred-summaries.tsx`](../src/components/dashboard/dashboard-deferred-summaries.tsx).

## Charging calculator (`/charging`)

| Displayed result | Formula | Explanation |
| --- | --- | --- |
| Battery energy needed | `C × (target SOC − current SOC) / 100` | Energy that must reach the battery. |
| Grid energy needed | `battery energy / (η/100)` | Includes charging losses. |
| Charging time | `grid energy / P` | Estimates duration at the selected power. |
| Estimated cost | `grid energy × p` | Prices the estimated grid energy. |
| Percentage gained per hour | `P / C × 100` | Approximate SOC charging rate per hour. |

Owning sources: [`charging-math.ts`](../src/features/charging/_domain/charging-math.ts)
and [`calculator.ts`](../src/lib/telegram/calculator.ts).

## Active charging-session detail

SOC, energy, and cost follow the canonical priority: fresh live SOC (up to 90 seconds),
then in-session telemetry, then wall-clock math. A time estimate must not replace fresh
vehicle truth.

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Current SOC | Fresh live SOC, then telemetry, then wall-clock estimate | Selects the most trustworthy source. |
| To battery (estimated) | `C × (current SOC − start SOC) / 100` | Energy represented by the measured or selected SOC gain; it cannot exceed the configured pack capacity for a full 0–100% charge. |
| From charger (estimated) | `C × (current SOC − start SOC) / 100 / (η/100)` | Grid-side energy used for charging cost. It can exceed pack capacity because it includes charging losses and auxiliary load. A receipt-corrected completed session is labelled “From charger” without the estimate marker. |
| Live charging cost | `charged grid energy × p` | Running estimated session cost. |
| Elapsed time | `now − start time` | Time since the session began. |
| Remaining grid energy | `C × (target SOC − current SOC) / 100 / (η/100)` | Electricity the charger is expected to draw from now until the target, including charging losses. It is not the energy currently stored in the battery. |
| Live remaining time | `remaining grid energy / P_grid` | Dashboard, `/vehicle`, active-session detail, and the Telegram live widget share the resolved displayed power. Session-detail projections convert it to `P_batt = P_grid × η/100` before applying the SOC-rate helper; this is algebraically equivalent to dividing grid energy by grid power. Telegram reads active sessions in one user-scoped batch after its existing update throttle and falls back to raw/default power when session context is unavailable. |
| Forward SOC projections | `start SOC + (P_batt / C × 100) × elapsed seconds / 3600` | Active-session detail uses the resolved power and efficiency for the next-target countdown, estimated finish, and projected SOC at the next 07:00 anchor. |
| Wall-clock SOC fallback | `start SOC + percent/second × elapsed seconds` | Estimates SOC without usable live data. |
| Wall-clock energy fallback | `P × active seconds / 3600` | Estimates energy from configured power and time. |
| Wall-clock cost fallback | `p × P × active seconds / 3600` | Estimates cost from time, power, and price. |
| Wall-clock remaining time | `(target SOC − current SOC) / percent/second` | Estimates time left at the configured rate. |
| SOC safety ceiling | `min(target SOC, latest real SOC + rate × seconds since reading)` | Stops wall-clock progress running far ahead of the last real SOC. |
| Completion | `current SOC ≥ target SOC` plus live-data guards | Avoids persisting math-only completion over fresh vehicle truth. |
| Display charge power | Quantization-aware AC estimate, else live `charge_power_kw`, else session/car/default fallback | For a mature AC session (at least 15 minutes and 2 SOC points), an integer live reading can use the complete observed average when both values share the same integer bucket (`1` plus observed `1.4` displays `~1.4 kW`). DC, already-decimal live values, and disagreeing buckets keep live power. The same `P_grid` drives ETA and forward projections. |

Owning sources: [`charging-live.ts`](../src/features/charging/_domain/charging-live.ts),
[`charging-math.ts`](../src/features/charging/_domain/charging-math.ts),
[`dashboard-view.tsx`](../src/components/dashboard/dashboard-view.tsx),
[`vehicle-live-view.tsx`](../src/components/vehicle/vehicle-live-view.tsx), and
[`charging-session-screen.tsx`](../src/features/charging/_ui/charging-session-screen.tsx),
plus [`live-widget-charging.ts`](../src/lib/telegram/live-widget-charging.ts) for Telegram.

> The BMS `kwh_charged` counter is diagnostic. Primary energy, cost, and charge-power
> presentation do not use it because it is battery-cell-side and misses auxiliary load.

## Completed-session correction

| Displayed result | Formula | Explanation |
| --- | --- | --- |
| Corrected price per kWh | `total paid / billed kWh` | Effective provider price derived from the receipt. |
| Measured charging efficiency | `((SOC gain/100) × C / billed kWh) × 100` | Compares energy stored in the battery with provider-billed grid energy. |
| Average charge power | `Σpositive charge_power_kw / count(positive charge_power_kw)` | Uses only charging-window telemetry samples with positive reported charging power; it does not use the BMS `kwh_charged` counter. |
| Average battery temperature | `Σbattery temperature / valid sample count` | Charging-session temperature context. |
| Average outside temperature | `Σoutside temperature / valid sample count` | Ambient charging context. |

Owning sources: [`energy-correction-card.tsx`](../src/features/charging/_ui/energy-correction-card.tsx)
and [`charging-efficiency-learning.ts`](../src/lib/charging-efficiency-learning.ts).

## Manual charging-session form

| Previewed result | Formula | Explanation |
| --- | --- | --- |
| Duration | `(stop time − start time) / 3,600,000` | Converts the entered period to hours. |
| Average charging power | `billed kWh / duration hours`, capped at 350 kW | Reconstructs average power from receipt data. |
| Effective price | `total paid / billed kWh` | Receipt price per kWh. |
| Battery-side energy | `billed kWh × η/100` | Removes estimated grid-to-battery losses. |
| Estimated SOC gain | `battery-side energy / C × 100`, clamped to 1–100% | Reconstructs the approximate percentage gained. |
| Target SOC | `start SOC + estimated SOC gain`, capped at 100% | Anchors the reconstructed gain to nearby telemetry when possible. |

Owning source: [`manual-session.ts`](../src/features/charging/_domain/manual-session.ts).

## History summary (`/history`)

These calculations are reused for day, week, month, quarter, and year summaries.

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Charging cost | Sum of `estimated_cost` for sessions with a positive price | Total priced charging cost in the selected period. |
| Charging duration | `Σ(stop time − start time)` | Total time spent charging. |
| Charged energy | `Σfinished-session charged energy` | Includes completed and stopped sessions. |
| Distance | `Σtrip distance` | Total period distance. |
| Driving energy | `Σtrip traction energy` | Gross traction energy used by trips. |
| Regenerated energy | `Σtrip regen energy` | Energy recovered by regenerative braking. |
| Average net consumption | `(driving energy − regen energy) / distance × 100` | Period consumption net of regeneration. |
| Energy balance | `charged energy − driving energy` | Compares charged grid energy with gross traction use. |
| Balance verdict | Surplus above +0.5 kWh; deficit below −0.5; otherwise balanced | Treats small measurement differences as neutral. |
| Session/trip counts | Number of matching rows | Counts, not estimates. |

Owning source: [`history-day-summary.ts`](../src/lib/history-day-summary.ts).

## History charging-session cards

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| SOC gain | `current SOC − start SOC` | Percentage gained during the session. |
| Duration | `stop time − start time` | Elapsed session time. |
| Energy | SOC-derived grid energy or corrected billed energy | Uses the stored session result. |
| Cost | `charged energy × price`, unless manually corrected | Uses estimated or corrected session cost. |

Owning source: [`charging-math.ts`](../src/features/charging/_domain/charging-math.ts).

## Vehicle overview (`/vehicle`)

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| AI estimated range | `available energy / predicted consumption × 100` | Same blended range model as Dashboard. |
| Math range | `km per 1% SOC × current SOC` | Projects range directly from recent distance/SOC performance. If the SOC-delta window is unusable, falls back to `C / consumption kWh/100 km`. |
| Kilometres per 1% SOC | `Σrecent distance / Σrecent SOC drop` | Uses newest usable trips covering a rolling roughly 50 km window; the current trip may use live distance and SOC. |
| km/% fallback | `C / consumption kWh/100 km` | Capacity/consumption fallback when SOC deltas are insufficient. |
| Distance since last charge | Sum of trip distance after the latest finished charge | Includes live ongoing-trip distance where appropriate. |
| Ongoing trip distance | `max(stored trip distance, live trip distance)` | Keeps the displayed distance from moving backwards. |
| Trip duration | `end time − start time` | Elapsed trip time. |
| Current driving consumption | Raw current-trip consumption | Passed through from telemetry; not recalculated by the page. |

Owning sources: [`hero-drive-metrics.ts`](../src/lib/bydmate/hero-drive-metrics.ts),
[`range-estimate.ts`](../src/lib/bydmate/range-estimate.ts), and
[`vehicle-live-view.tsx`](../src/components/vehicle/vehicle-live-view.tsx).

## Vehicle trips

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Traction-energy fallback | `distance × reported consumption / 100` | Reconstructs energy when an older trip lacks measured traction energy. |
| Energy per kilometre | `traction energy / distance` | Gross traction energy used per kilometre. |
| Net consumption | `(traction energy − regen energy) / distance × 100` | Trip consumption after regenerative recovery. |
| SOC change | `start SOC − end SOC` | Battery percentage consumed by the trip. |
| Average speed | Upstream trip-sample average | Calculated during ingestion and displayed by the web UI. |
| Maximum speed | Maximum valid trip-sample speed | Calculated upstream and displayed by the web UI. |

Owning source: [`trip-metrics.ts`](../src/lib/bydmate/trip-metrics.ts). See
[Trips](TRIPS.md) for server-side trip lifecycle and distance rules.

## Vehicle analytics: day view

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Day average consumption | `Σ(trip consumption × trip distance) / Σdistance` | Longer trips contribute proportionally more. |
| Total measured trip energy | `Σtraction energy` only when every displayed trip is measured | Avoids presenting a partial total as complete. |
| 30-day baseline | Median consumption of qualifying trips of at least 2 km | Outlier-resistant personal comparison. |
| Difference from baseline | `(day average − baseline) / baseline × 100` | Percentage better or worse than normal. |
| Best/worst trip | Minimum/maximum qualifying trip consumption | Selects the most and least efficient trips. |
| Regen share | `Σregen energy / Σtraction energy × 100` | Recovered energy as a share of traction energy. |
| High-vs-low regen comparison | Distance-weighted averages split at median regen share | Compares consumption between higher- and lower-regen trip groups. |
| Trip norm badge | `(trip consumption − baseline) / baseline × 100` | Below norm at ≤−5%; above norm at ≥+5%. |

Owning sources: [`day-insights.ts`](../src/lib/bydmate/day-insights.ts) and
[`analytics-day-view.tsx`](../src/components/vehicle/analytics-day-view.tsx).

## Vehicle analytics: period view

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Total distance | `Σtrip distance` | Distance in the selected period. |
| Total regeneration | `Σtrip regen energy` | Recovered period energy. |
| Total charged energy | `Σfinished-session charged energy` | Energy received in finished sessions. |
| Total charging cost | `Σfinished-session estimated cost` | Period charging expenditure. |
| Car average consumption | `Σ(car-reported consumption × distance) / Σdistance` | Distance-weighted average of the car's reported trip field. |
| Cost per kilometre | `total charging cost / total distance` | Attributes period charging spend across driven distance. |
| Maximum speed | Maximum of trip maximum speeds | Highest recorded speed in the period. |
| SOC swing | `maximum SOC − minimum SOC` | Difference between highest and lowest observed SOC. |
| Temperature consumption bucket | `Σconsumption / trip count` in each 5°C bucket | Average consumption at similar outside temperatures. |

Owning sources: [`vehicle-analytics.ts`](../src/lib/vehicle-analytics.ts) and
[`telemetry-buckets.ts`](../src/lib/bydmate/telemetry-buckets.ts).

## Vehicle analytics: telemetry charts

| Chart value | Formula or rule | Explanation |
| --- | --- | --- |
| Average power | `(previous average × n + new value) / (n + 1)` | Incremental mean for each time bucket. |
| Average battery temperature | Same incremental mean | Mean battery temperature in the bucket. |
| Average outside temperature | Same incremental mean | Mean ambient temperature in the bucket. |
| Maximum speed | Maximum valid bucket speed | Highest speed in the bucket. |
| SOC minimum/maximum | Minimum and maximum valid SOC | Battery range observed in the bucket. |
| Regeneration/traction energy | Sum of bucket energy values | Total energy in each direction. |

Owning source: [`telemetry-buckets.ts`](../src/lib/bydmate/telemetry-buckets.ts).

## Vehicle analytics: charging charts and cell-delta trend

| Chart value | Formula or rule | Explanation |
| --- | --- | --- |
| Period charging energy | `Σsession charged_energy_kwh` grouped by the selected day/week bucket | Includes the finished and in-progress sessions returned for the selected range; the bar annotation is the number of sessions in that bucket. |
| Period charging cost | `Σsession estimated_cost` for sessions with `price_per_kwh > 0` | Shown only when the selected range contains priced sessions. |
| Period charging speed | `Σ(session charger_power_kw × session charged_energy_kwh) / Σsession charged_energy_kwh` | Energy-weighted session charger power grouped by the selected bucket; shown only when positive power and energy exist. |
| Efficiency chart | `Σ(car-reported consumption × distance) / Σdistance` per bucket | Uses the trip's stored `avg_consumption_kwh_100km` field and displays distance inside the bar; it is not the net-of-regen history summary. |
| Mileage chart | `Σtrip distance` per bucket | Sums stored trip distances. |
| Full-charge cell-delta point | Stored positive `end_max_cell_delta_v` at a session with `end_delta_soc ≥ 99%` | Partial charges are context marks between full-charge points, not comparable delta-axis observations. |
| Partial-charge context count | Number of measured partial charges since the previous full-charge point | A partial charge is one with `end_delta_soc < 99%`; sessions without both cell-delta and SOC evidence are excluded. |
| Matched SOH | Nearest valid SOH telemetry reading within 14 days of the charge endpoint | Context for a full-charge delta point; it does not alter the measured delta. |

Owning sources: [`telemetry-analytics-charts.tsx`](../src/components/vehicle/telemetry-analytics-charts.tsx),
[`vehicle-analytics-panels.tsx`](../src/components/vehicle/vehicle-analytics-panels.tsx), and
[`charge-delta-trend.ts`](../src/lib/bydmate/charge-delta-trend.ts).

## Vehicle analytics: phantom drain

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Drain per parked interval | `start SOC − end SOC` | Counts positive SOC loss while continuously parked and unplugged. |
| Idle hours | `(end time − start time) / 3,600,000` | Duration of the qualifying parked interval. |
| Daily drain | Sum of qualifying interval drains | Combines intervals from the same UTC day. |
| Daily idle time | Sum of qualifying interval hours | Combines qualifying durations. |

Only continuous parked intervals of at least four hours qualify. Owning source:
[`phantom-drain.ts`](../src/lib/bydmate/phantom-drain.ts).

## Vehicle analytics: route insights

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Typical route consumption | Median of matching-route trip consumption | Stable usual value for the route. |
| Route minimum/maximum | Minimum and maximum matching-trip consumption | Observed range for the route. |
| Temperature-bucket consumption | `Σconsumption / trip count` in a rounded 5°C bucket | Route performance at similar temperatures. |
| Forecast with a temperature match | Matching-bucket average ±5% | Narrower forecast when relevant evidence exists. |
| Forecast without a match | Route median ±8% | Wider fallback without matching-temperature evidence. |
| Average route temperatures | `Σtemperature / valid sample count` | Average outside and battery temperature for a trip. |

Owning source: [`route-insights.ts`](../src/lib/bydmate/route-insights.ts).

## Service (`/service`)

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Effective record cost | Positive `total cost`; otherwise `parts cost + labor cost` | Uses an explicit total with a component fallback. |
| Total spent | Sum of effective record costs | Lifetime expenditure for the selected car. |
| This-year spending | Sum of effective costs in the current calendar year | Current-year expenditure. |
| Average service cost | `total spent / record count` | Mean cost per service record. |
| Category spending | Sum of effective costs by category | Expenditure by maintenance type. |
| Category bar width | `category total / largest category total × 100` | Relative category comparison. |
| Category record count | Number of records in the category | Service frequency, not an estimate. |

Owning source: [`service-stats.tsx`](../src/components/service/service-stats.tsx).

## Settings: charging-efficiency suggestions

| Displayed result | Formula or rule | Explanation |
| --- | --- | --- |
| Suggested efficiency | Median of the latest 10 corrected-session measurements | Resists one unusual session or receipt. |
| Measurement spread | `maximum efficiency − minimum efficiency` | Consistency of the correction evidence. |
| Average temperatures | Arithmetic mean of observation temperatures | Context for the suggestion. |
| Display gate | At least 3 observations, spread ≤5 points, difference from configured value ≥1 point | Suppresses weak or noisy suggestions. |

Owning source: [`charging-efficiency-learning.ts`](../src/lib/charging-efficiency-learning.ts).

## Knowledge search

| Displayed result | Formula | Explanation |
| --- | --- | --- |
| Match percentage | `round(similarity × 100)` | Converts the backend 0–1 similarity score to a percentage. |

Owning sources: [`search/page.tsx`](../src/app/knowledge/search/page.tsx) and
[`SemanticSearchResults.tsx`](../src/components/telegram/SemanticSearchResults.tsx).

## Maintenance rule

When a user-visible formula changes, update this reference in the same approved change
as its owning source and canonical domain document. Preserve the distinction between:

- raw vehicle-reported values;
- exact totals derived from stored facts;
- estimates and fallbacks;
- forecasts that intentionally blend multiple signals.
