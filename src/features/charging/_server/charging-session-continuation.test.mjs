import test from "node:test";
import assert from "node:assert/strict";
import { planChargingContinuation } from "./charging-session-continuation.ts";

const at = (seconds) => new Date(Date.UTC(2026, 10, 1) + seconds * 1000).toISOString();
const sample = (time, soc, kw, gun = 2, speed = 0) => ({
  device_time: at(time),
  telemetry: { soc, charge_power_kw: kw, speed_kmh: speed },
  diplus_charge_gun_state: gun,
});
const first = {
  user_id: "u1", car_id: "c1", start_percent: 60, current_percent: 72,
  target_percent: 100, battery_capacity_kwh: 50, charger_power_kw: 6,
  efficiency_percent: 100, price_per_kwh: 0.5, tariff_type: "commercial_ac",
  provider_type: "custom", user_provider_id: null, manual_entry: false,
  energy_overridden: false, tariff_manual: false, status: "stopped",
  started_at: at(0), stopped_at: at(1440),
  session_origin: "telemetry_recovered", recovery_key: `${at(0)}:${at(1200)}`,
};
const next = {
  ...first, start_percent: 70, current_percent: 90, started_at: at(1320),
  stopped_at: at(3100), session_origin: "legacy", recovery_key: null,
};
const bridge = [sample(1190, 70, 6), sample(1200, 70, 0), sample(1260, 70, 0), sample(1320, 70, 6)];
const end = [sample(2970, 89.9, 6), sample(3000, 90, 6), sample(3010, 90, 0), sample(3090, 90, 0, 1, 20)];

test("rebuilds a buffered start and live continuation, counting the measured gain once", () => {
  const patch = planChargingContinuation(first, next, bridge.toReversed(), end.toReversed());
  assert.deepEqual(patch, {
    current_percent: 90, charged_energy_kwh: 15, estimated_cost: 7.5,
    stopped_at: at(3000), status: "stopped", recovery_key: `${at(0)}:${at(3000)}`,
  });
  assert.equal(planChargingContinuation({ ...first, ...patch }, next, bridge, end), null);
});

test("keeps distinct visits separate after movement, unplugging or missing evidence", () => {
  for (const gap of [
    [bridge[0], bridge[1], sample(1260, 70, 0, 2, 12), bridge[3]],
    [bridge[0], bridge[1], sample(1260, 70, 0, 1), bridge[3]],
    [bridge[0], bridge[1], bridge[3]],
    [bridge[0], bridge[1], bridge[2], sample(1320, 69, 6)],
  ]) {
    assert.equal(planChargingContinuation(first, next, gap, end), null);
  }
});

test("counts a short powered run between multiple evidenced pauses", () => {
  const afterSecondPause = { ...next, started_at: at(1390), start_percent: 71 };
  const betweenPauses = [
    ...bridge,
    sample(1340, 71, 6),
    sample(1350, 71, 0),
    sample(1390, 71, 6),
  ];
  const patch = planChargingContinuation(first, afterSecondPause, betweenPauses, end);
  assert.equal(patch?.charged_energy_kwh, 15);
});

test("keeps open sessions, manual entries, tariff edits and provider amounts separate", () => {
  for (const change of [
    { status: "charging" }, { manual_entry: true }, { tariff_manual: true },
    { energy_overridden: true }, { price_per_kwh: 0.7 },
  ]) {
    assert.equal(planChargingContinuation(first, { ...next, ...change }, bridge, end), null);
  }
});
