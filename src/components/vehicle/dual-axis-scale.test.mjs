import assert from "node:assert/strict";
import test from "node:test";

import { buildZeroAlignedAxisScales } from "./dual-axis-scale.ts";

test("dual axes put speed and traction-power zero on one horizontal gridline", () => {
  const [speed, power] = buildZeroAlignedAxisScales([
    [0, 42, 86],
    [-18, 0, 32],
  ]);

  assert.equal(speed.y(0), power.y(0));
  assert.ok(speed.y(42) < speed.y(0));
  assert.ok(power.y(32) < power.y(0));
  assert.ok(power.y(-18) > power.y(0));
  assert.ok(speed.yTickValues.includes(0));
  assert.ok(power.yTickValues.includes(0));
});
