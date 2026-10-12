import test from "node:test";
import assert from "node:assert/strict";

import { resolveEndAnchorSoc } from "./range-prediction-capture.ts";

test("anchors on the SOC the car reported its range at", () => {
  assert.equal(
    resolveEndAnchorSoc({ end_range_soc: 97.5, end_delta_soc: 100, current_percent: 96 }),
    97.5,
  );
});

test("falls back to delta SOC, then the (possibly stale) session row", () => {
  assert.equal(
    resolveEndAnchorSoc({ end_range_soc: null, end_delta_soc: 88, current_percent: 85 }),
    88,
  );
  assert.equal(
    resolveEndAnchorSoc({ end_range_soc: null, end_delta_soc: null, current_percent: 85 }),
    85,
  );
});

test("returns null when no finite anchor exists", () => {
  assert.equal(
    resolveEndAnchorSoc({ end_range_soc: undefined, end_delta_soc: NaN, current_percent: null }),
    null,
  );
});
