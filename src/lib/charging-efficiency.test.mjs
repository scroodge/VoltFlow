import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FAST_DC_EFFICIENCY_PERCENT,
  efficiencyPercentForTariff,
} from "./charging-efficiency.ts";

const car = { default_efficiency_percent: 98, fast_dc_efficiency_percent: 90 };

test("fast DC uses the DC efficiency", () => {
  assert.equal(efficiencyPercentForTariff(car, "fast_dc"), 90);
});

test("AC tariffs use the car's AC efficiency", () => {
  assert.equal(efficiencyPercentForTariff(car, "home"), 98);
  assert.equal(efficiencyPercentForTariff(car, "commercial_ac"), 98);
});

test("an unknown or missing tariff falls back to AC, not DC", () => {
  assert.equal(efficiencyPercentForTariff(car, null), 98);
  assert.equal(efficiencyPercentForTariff(car, undefined), 98);
});

test("a car row without a usable DC efficiency falls back to the default", () => {
  const legacy = { default_efficiency_percent: 98 };
  assert.equal(
    efficiencyPercentForTariff(legacy, "fast_dc"),
    DEFAULT_FAST_DC_EFFICIENCY_PERCENT,
  );
  assert.equal(
    efficiencyPercentForTariff({ ...legacy, fast_dc_efficiency_percent: null }, "fast_dc"),
    90,
  );
  assert.equal(
    efficiencyPercentForTariff({ ...legacy, fast_dc_efficiency_percent: 0 }, "fast_dc"),
    90,
  );
});

test("today's DC session (46% -> 83% on 45.1 kWh) bills like the provider's meter", () => {
  const batteryKwh = ((83 - 46) / 100) * 45.1;
  const gridKwh = batteryKwh / (efficiencyPercentForTariff(car, "fast_dc") / 100);
  // The provider metered 18.40 kWh; battery-side alone would have read 16.69.
  assert.ok(batteryKwh < 17, `battery-side should be ~16.7, got ${batteryKwh}`);
  assert.ok(Math.abs(gridKwh - 18.4) < 0.2, `expected ~18.4 kWh grid-side, got ${gridKwh}`);
});
