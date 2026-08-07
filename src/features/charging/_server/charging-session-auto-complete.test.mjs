import test from "node:test";
import assert from "node:assert/strict";

import { resolveAutoCompletionProgress } from "./charging-session-auto-complete.ts";

const session = {
  start_percent: 51,
  target_percent: 100,
};

test("fresh server SOC wins over a fractional math completion", () => {
  const result = resolveAutoCompletionProgress({
    session,
    measuredProgress: {
      currentPercent: 100,
      chargedEnergyKwh: 22.551020408163264,
      estimatedCost: 8.219999999999999,
      source: "live",
    },
    mathProgress: {
      currentPercent: 95.8979058881498,
      chargedEnergyKwh: 20.248955555555558,
      estimatedCost: 7.377301977555556,
      source: "math",
    },
  });

  assert.deepEqual(result, {
    currentPercent: 100,
    chargedEnergyKwh: 22.551020408163264,
    estimatedCost: 8.219999999999999,
    source: "live",
  });
});

test("fresh server SOC below target blocks a math completion", () => {
  const result = resolveAutoCompletionProgress({
    session,
    measuredProgress: {
      currentPercent: 99,
      chargedEnergyKwh: 22.09,
      estimatedCost: 8.05,
      source: "live",
    },
    mathProgress: {
      currentPercent: 100,
      chargedEnergyKwh: 22.55,
      estimatedCost: 8.22,
      source: "math",
    },
  });

  assert.equal(result, null);
});

test("math completion remains available only when server progress is unavailable", () => {
  const result = resolveAutoCompletionProgress({
    session,
    measuredProgress: null,
    mathProgress: {
      currentPercent: 100,
      chargedEnergyKwh: 22.55,
      estimatedCost: 8.22,
      source: "math",
    },
  });

  assert.equal(result?.source, "math");
});
