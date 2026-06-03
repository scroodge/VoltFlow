import test from "node:test";
import assert from "node:assert/strict";

import { isMateAutoSessionCharging } from "./telemetry-charging.ts";

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
