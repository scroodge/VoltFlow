import assert from "node:assert/strict";
import test from "node:test";

import { mapSohDailyRows, normalizeSohPercent } from "./soh-history-mapping.ts";

test("normalizes numeric and string SoH values", () => {
  assert.equal(normalizeSohPercent(99), 99);
  assert.equal(normalizeSohPercent("98.5"), 98.5);
  assert.equal(normalizeSohPercent(null), null);
  assert.equal(normalizeSohPercent(101), null);
});

test("maps only valid compact daily SoH RPC rows", () => {
  assert.deepEqual(
    mapSohDailyRows([
      { device_time: "2026-07-08T23:59:00.000Z", soh_percent: "98.5" },
      { device_time: "2026-07-09T23:59:00.000Z", soh_percent: null },
      { device_time: "2026-07-10T23:59:00.000Z", soh_percent: 101 },
    ]),
    [{ device_time: "2026-07-08T23:59:00.000Z", telemetry: { soh_percent: 98.5 } }],
  );
});
