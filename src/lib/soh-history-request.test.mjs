import test from "node:test";
import assert from "node:assert/strict";

import { buildSohHistoryPath, resolveSohHistoryWindow } from "./soh-history-request.ts";

test("SOH history uses the selected analytics range instead of a hardcoded year", () => {
  assert.deepEqual(resolveSohHistoryWindow("week", "2026-08-20"), {
    from: "2026-08-17T00:00:00.000Z",
    to: "2026-08-23T23:59:59.999Z",
    useHourly: true,
    rawSampleDays: 3,
  });
});

test("SOH request path includes range, anchor date, and optional vehicle", () => {
  assert.equal(
    buildSohHistoryPath({ range: "month", anchorDate: "2026-08-20", vehicleId: "car 1" }),
    "/api/vehicle/telemetry/soh?range=month&date=2026-08-20&vehicle_id=car+1",
  );
});
