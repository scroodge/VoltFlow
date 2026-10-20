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
const parked = (minute, soc) => ({
  device_time: at(minute),
  telemetry: { soc, charge_power_kw: 0, speed_kmh: 0 },
});
const windows = [{ vehicleId: "v1", fromIso: at(-60), toIso: at(120) }];
const closedCharge = [parked(-1, 32), charging(0, 32), charging(2, 33), charging(4, 34), charging(6, 35), driving(85, 35)];

// Honours the requested range like the real adapter, so backward extension is exercised.
const inRange = (samples) => async (_vehicleId, fromIso, toIso) =>
  samples.filter((s) => s.device_time >= fromIso && s.device_time <= toIso);

function ports(overrides = {}) {
  const inserted = [];
  return {
    inserted,
    loadCar: async () => car,
    loadSamples: inRange(closedCharge),
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
  const p = ports({ loadSamples: inRange(closedCharge.slice(0, 5)) });
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

test("a long offline charge is recovered from its real plug-in, not the lookback edge", async () => {
  // 19 h at 2 min cadence; the closing batch's window starts 12 h before its end.
  const samples = [parked(-1, 26)];
  for (let minute = 0, soc = 26; minute <= 19 * 60; minute += 2, soc = Math.min(100, soc + 0.13)) {
    samples.push(charging(minute, Math.round(soc * 10) / 10));
  }
  samples.push(parked(19 * 60 + 1, 100));
  const p = ports({ loadSamples: inRange(samples) });
  const closingWindow = [{ vehicleId: "v1", fromIso: at(19 * 60 - 12 * 60), toIso: at(19 * 60 + 1) }];
  const result = await recoverLateCharges(closingWindow, p);
  assert.equal(result.recovered, 1);
  assert.equal(p.inserted[0].startedAt, at(0));
  assert.equal(p.inserted[0].startPercent, 26);
});

test("a charge whose start lies beyond the extension cap is not imported truncated", async () => {
  const samples = [];
  for (let minute = -40 * 60; minute <= 0; minute += 2) samples.push(charging(minute, 50));
  samples.push(charging(2, 60), parked(4, 60));
  const p = ports({ loadSamples: inRange(samples) });
  const result = await recoverLateCharges([{ vehicleId: "v1", fromIso: at(-60), toIso: at(4) }], p);
  assert.equal(p.inserted.length, 0);
  assert.deepEqual(result.errors, []);
});

test("an unreadable range is reported and never scanned partially", async () => {
  const p = ports({ loadSamples: async () => null });
  const result = await recoverLateCharges(windows, p);
  assert.equal(p.inserted.length, 0);
  assert.equal(result.errors.length, 1);
});
