import test from "node:test";
import assert from "node:assert/strict";

import { readDiPlusCabinTemperature } from "./vehicle-cabin-temperature.ts";

test("shows the Di+ cabin temperature for a parked 2025+ car", () => {
  assert.equal(
    readDiPlusCabinTemperature({
      modelGeneration: "gen2_2025",
      isParkedOrCharging: true,
      diplusInsideTempC: 21.4,
    }),
    21.4,
  );
});

test("shows the Di+ cabin temperature while charging", () => {
  assert.equal(
    readDiPlusCabinTemperature({
      modelGeneration: "gen2_2025",
      isParkedOrCharging: true,
      diplusInsideTempC: 18,
    }),
    18,
  );
});

test("hides cabin temperature for unsupported states, generations, and values", () => {
  const cases = [
    { modelGeneration: "gen1_2024", isParkedOrCharging: true, diplusInsideTempC: 21 },
    { modelGeneration: "gen2_2025", isParkedOrCharging: false, diplusInsideTempC: 21 },
    { modelGeneration: "gen2_2025", isParkedOrCharging: true, diplusInsideTempC: null },
    { modelGeneration: "gen2_2025", isParkedOrCharging: true, diplusInsideTempC: 91 },
    { modelGeneration: "gen2_2025", isParkedOrCharging: true, diplusInsideTempC: "21" },
  ];

  for (const input of cases) assert.equal(readDiPlusCabinTemperature(input), null);
});
