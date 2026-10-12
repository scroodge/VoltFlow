import assert from "node:assert/strict";
import test from "node:test";

import { recoverLateCharges } from "./late-charge-recovery.ts";

const car = {
  id: "car", user_id: "user", name: "Car", vehicle_alias: "v1",
  battery_capacity_kwh: 60, default_charger_power_kw: 7,
  default_efficiency_percent: 98, fast_dc_efficiency_percent: 90,
};
const at = (minutes) => new Date(Date.UTC(2026, 8, 25, 11, minutes)).toISOString();
const charging = (minute, soc) => ({
  device_time: at(minute),
  telemetry: { soc, charge_power_kw: 3, speed_kmh: 0 },
});
const driving = (minute, soc) => ({
  device_time: at(minute),
  telemetry: { soc, charge_power_kw: 0, speed_kmh: 40 },
});
const windows = [{ vehicleId: "v1", fromIso: at(-60), toIso: at(120) }];
const closedCharge = [charging(0, 32), charging(2, 33), charging(4, 34), charging(6, 35), driving(85, 35)];

function ports(overrides = {}) {
  const inserted = [];
  return {
    inserted,
    loadCar: async () => car,
    loadSamples: async () => closedCharge,
    insert: async (_car, candidate) => {
      inserted.push(candidate);
      return { ok: true, sessionId: `s${inserted.length}` };
    },
    ...overrides,
  };
}

test("a late burst with a closed charge becomes one session", async () => {
  const p = ports();
  const result = await recoverLateCharges(windows, p);
  assert.equal(p.inserted.length, 1);
  assert.equal(p.inserted[0].startedAt, at(0));
  // The car was silent for 79 min after the last charging sample: end there, not at 11:25.
  assert.equal(p.inserted[0].stoppedAt, at(6));
  assert.deepEqual(result, { recovered: 1, sessionIds: ["s1"], errors: [] });
});

test("a charge still open at the end of the range is not imported", async () => {
  const p = ports({ loadSamples: async () => closedCharge.slice(0, 4) });
  const result = await recoverLateCharges(windows, p);
  assert.equal(p.inserted.length, 0);
  assert.equal(result.recovered, 0);
});

test("a vehicle without a linked car is skipped without reading telemetry", async () => {
  let read = false;
  const p = ports({
    loadCar: async () => null,
    loadSamples: async () => { read = true; return closedCharge; },
  });
  const result = await recoverLateCharges(windows, p);
  assert.equal(read, false);
  assert.deepEqual(result, { recovered: 0, sessionIds: [], errors: [] });
});

test("overlap and duplicate outcomes are silent, real failures are reported", async () => {
  for (const code of ["overlap", "duplicate"]) {
    const p = ports({ insert: async () => ({ ok: false, error: code, code }) });
    assert.deepEqual(await recoverLateCharges(windows, p), { recovered: 0, sessionIds: [], errors: [] });
  }
  const p = ports({ insert: async () => ({ ok: false, error: "db down" }) });
  assert.deepEqual(await recoverLateCharges(windows, p), { recovered: 0, sessionIds: [], errors: ["db down"] });
});

test("an unreadable range is reported and never scanned partially", async () => {
  const p = ports({ loadSamples: async () => null });
  const result = await recoverLateCharges(windows, p);
  assert.equal(p.inserted.length, 0);
  assert.equal(result.errors.length, 1);
});
