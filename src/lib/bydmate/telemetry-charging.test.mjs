import test from "node:test";
import assert from "node:assert/strict";

import { isMateAutoSessionCharging, isTelemetryCharging } from "./telemetry-charging.ts";

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
