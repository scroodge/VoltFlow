import test from "node:test";
import assert from "node:assert/strict";

import {
  isMateAutoSessionCharging,
  isTelemetryHistoryCharging,
  isTelemetryCharging,
  sanitizeChargerPowerKw,
} from "./telemetry-charging.ts";

test("traction power_kw alone is not auto-session charging", () => {
  assert.equal(
    isMateAutoSessionCharging(
      { is_charging: false, charge_power_kw: null, soc: 84, power_kw: 45 },
      30,
    ),
    false,
  );
});

test("parked with charge_power_kw is charging", () => {
  assert.equal(
    isMateAutoSessionCharging({ is_charging: false, charge_power_kw: 4.2, soc: 84 }, 0),
    true,
  );
});

test("100% balance tail is not charging", () => {
  assert.equal(
    isMateAutoSessionCharging({ is_charging: true, charge_power_kw: 0, soc: 100 }, 0),
    false,
  );
});

test("parked is_charging below 100% counts even at ~0 kW (regression: branch was dead code)", () => {
  // e.g. charge ramp-up or a car reporting is_charging without charge_power_kw
  assert.equal(
    isMateAutoSessionCharging({ is_charging: true, charge_power_kw: 0, soc: 84 }, 0),
    true,
  );
  assert.equal(
    isMateAutoSessionCharging({ is_charging: true, charge_power_kw: null, soc: 84 }, 0),
    true,
  );
});

test("explicit Di+ unplug overrides a stale is_charging flag for auto sessions", () => {
  assert.equal(
    isMateAutoSessionCharging(
      { is_charging: true, charge_power_kw: null, soc: 79 },
      0,
      { diplus: { charge_gun_state: 1 } },
    ),
    false,
  );
});

test("real charge_power_kw wins over gun_state = 1 (car way's gun state is unreliable)", () => {
  // Car `way`'s Di+ gun state reads 1 ("unplugged") for the majority (71%) of its
  // genuine charging samples — confirmed against real sessions on 2026-07-23 and again
  // 2026-07-27. A real, above-threshold charge_power_kw reading must not be discarded
  // just because gun_state says unplugged. (This test previously asserted the opposite,
  // on the mistaken premise that the source timestamp was ~1h10m after a real unplug —
  // it in fact fell inside a still-open, active charging session.)
  assert.equal(
    isMateAutoSessionCharging(
      { is_charging: true, charge_power_kw: 1, soc: 66 },
      0,
      { diplus: { charge_gun_state: 1 } },
    ),
    true,
  );
});

test("is_charging while driving is not charging", () => {
  assert.equal(
    isMateAutoSessionCharging({ is_charging: true, charge_power_kw: 0, soc: 84 }, 20),
    false,
  );
});

test("is_charging with gun unplugged (1) is not charging", () => {
  assert.equal(
    isTelemetryCharging(
      { is_charging: true, charge_power_kw: null },
      { diplus: { charge_gun_state: 1 } },
    ),
    false,
  );
});

test("real charge_power_kw wins over gun_state = 1 in live status", () => {
  assert.equal(
    isTelemetryCharging(
      { is_charging: true, charge_power_kw: 1 },
      { diplus: { charge_gun_state: 1 } },
    ),
    true,
  );
});

test("gun unplugged with no real power falls back to not-charging in live status", () => {
  assert.equal(
    isTelemetryCharging(
      { is_charging: true, charge_power_kw: 0 },
      { diplus: { charge_gun_state: 1 } },
    ),
    false,
  );
});

test("gun connected (AC) is charging even without power yet", () => {
  assert.equal(
    isTelemetryCharging(
      { is_charging: false, charge_power_kw: null },
      { diplus: { charge_gun_state: 2 } },
    ),
    true,
  );
});

test("charge_power_kw above threshold is charging", () => {
  assert.equal(isTelemetryCharging({ is_charging: false, charge_power_kw: 7.2 }), true);
});

test("history charging ignores traction power, real charge power wins over explicit unplug", () => {
  assert.equal(
    isTelemetryHistoryCharging({ is_charging: false, charge_power_kw: null, power_kw: 32 }),
    false,
  );
  assert.equal(
    isTelemetryHistoryCharging(
      { is_charging: true, charge_power_kw: 1 },
      { diplus_charge_gun_state: 1 },
    ),
    true,
  );
});

test("history charging: gun unplugged with no real power falls back to not-charging", () => {
  assert.equal(
    isTelemetryHistoryCharging(
      { is_charging: true, charge_power_kw: 0 },
      { diplus_charge_gun_state: 1 },
    ),
    false,
  );
});

test("sanitizeChargerPowerKw keeps a plausible AC reading", () => {
  assert.equal(sanitizeChargerPowerKw(4, "AC", 4.4), 4);
});

test("sanitizeChargerPowerKw rejects di+ AC spike, falls back to car default", () => {
  // 64 kW glitch on a 4.4 kW AC car → use the default, not the spike
  assert.equal(sanitizeChargerPowerKw(64, "AC", 4.4), 4.4);
});

test("sanitizeChargerPowerKw treats unknown gun as AC (conservative cap)", () => {
  assert.equal(sanitizeChargerPowerKw(48, null, 4.4), 4.4);
});

test("sanitizeChargerPowerKw allows real DC power", () => {
  assert.equal(sanitizeChargerPowerKw(64, "DC", 11), 64);
});

test("sanitizeChargerPowerKw falls back when reading and default are both bad", () => {
  assert.equal(sanitizeChargerPowerKw(null, "AC", 0), 7.2);
  assert.equal(sanitizeChargerPowerKw(999, "DC", 0), 50);
});
