import test from "node:test";
import assert from "node:assert/strict";

import {
  isMateAutoSessionCharging,
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

test("explicit Di+ unplug overrides a stale nonzero charge_power_kw (car way, 2026-07-22 15:18:58 UTC)", () => {
  // Real production glitch: car was parked and unplugged (gun_state 1), but
  // is_charging and charge_power_kw kept reporting stale leftover values from the
  // charge that had already ended ~1h10m earlier, falsely reopening a session.
  assert.equal(
    isMateAutoSessionCharging(
      { is_charging: true, charge_power_kw: 1, soc: 66 },
      0,
      { diplus: { charge_gun_state: 1 } },
    ),
    false,
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
