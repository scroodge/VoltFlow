import test from "node:test";
import assert from "node:assert/strict";

import { deriveChargingSessionLiveBundle } from "./charging-session-sync.ts";

const params = {
  startPercent: 71,
  targetPercent: 100,
  batteryCapacityKwh: 45,
  chargerPowerKw: 4.4,
  efficiencyPercent: 100,
  pricePerKwh: 0.3265,
};

test("math completion when Mate live is absent", () => {
  const startedAtMs = Date.now() - 4 * 3600_000;
  const bundle = deriveChargingSessionLiveBundle({
    snapshots: [],
    params,
    startedAtMs,
    nowMs: Date.now(),
  });
  assert.equal(bundle.completionSource, "math");
  assert.equal(bundle.completionState?.isComplete, true);
  assert.equal(bundle.completionState?.currentPercent, 100);
});

test("live completion preferred when fresh SOC at target", () => {
  const nowMs = Date.now();
  const bundle = deriveChargingSessionLiveBundle({
    snapshots: [
      {
        received_at: new Date(nowMs).toISOString(),
        vehicle_id: "way",
        telemetry: { soc: 100, is_charging: true, charge_power_kw: 4 },
      },
    ],
    params,
    startedAtMs: nowMs - 3600_000,
    nowMs,
  });
  assert.equal(bundle.completionSource, "live");
  assert.equal(bundle.completionState?.isComplete, true);
});

test("no math completion while fresh live SOC below target", () => {
  const nowMs = Date.now();
  const bundle = deriveChargingSessionLiveBundle({
    snapshots: [
      {
        received_at: new Date(nowMs).toISOString(),
        vehicle_id: "way",
        telemetry: { soc: 71, is_charging: true, charge_power_kw: 4 },
      },
    ],
    params,
    startedAtMs: nowMs - 4 * 3600_000,
    nowMs,
  });
  assert.equal(bundle.completionSource, null);
  assert.equal(bundle.completionState, null);
  // Math is now clamped to the last real SOC (71%), so it can no longer claim completion
  // while a fresh reading sits below target — this is the finish-detection overshoot fix.
  assert.equal(bundle.mathState.isComplete, false);
  assert.ok(bundle.mathState.currentPercent <= 71 + 0.01);
});
