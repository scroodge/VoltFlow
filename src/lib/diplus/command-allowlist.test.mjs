import assert from "node:assert/strict";
import test from "node:test";

import { buildDiplusPhrase, validateVehicleCommand } from "./command-allowlist.ts";

test("keeps confirmed window commands", () => {
  assert.deepEqual(buildDiplusPhrase("window", { which: "driver", pct: 10 }), {
    ok: true,
    phrase: "主驾车窗打开百分之10",
  });
  assert.deepEqual(buildDiplusPhrase("windows_preset", { preset: "vent" }), {
    ok: true,
    phrase: "车窗通风",
  });
  assert.equal(validateVehicleCommand("window", { which: "driver", pct: 101 }).ok, false);
});

test("maps the live-verified climate commands", () => {
  assert.deepEqual(buildDiplusPhrase("ac", { on: true }), { ok: true, phrase: "自动空调" });
  assert.deepEqual(buildDiplusPhrase("ac", { on: false }), { ok: true, phrase: "关空调" });
  assert.deepEqual(buildDiplusPhrase("ac_temp_step", { direction: "up" }), { ok: true, phrase: "空调升温" });
  assert.deepEqual(buildDiplusPhrase("ac_temp_step", { direction: "down" }), { ok: true, phrase: "空调降温" });
  assert.deepEqual(buildDiplusPhrase("ac_recirculation", { mode: "internal" }), { ok: true, phrase: "内循环" });
  assert.deepEqual(buildDiplusPhrase("ac_recirculation", { mode: "external" }), { ok: true, phrase: "外循环" });
});

test("maps driver-seat heating only to the verified levels", () => {
  assert.deepEqual(buildDiplusPhrase("seat_heat_driver", { level: 2 }), {
    ok: true,
    phrase: "主驾座椅加热2档",
  });
  assert.deepEqual(buildDiplusPhrase("seat_heat_driver", { level: 0 }), {
    ok: true,
    phrase: "关闭主驾座椅加热",
  });
  assert.equal(validateVehicleCommand("seat_heat_driver", { level: 1 }).ok, false);
});

test("rejects historical unverified command types", () => {
  for (const type of ["lock", "ac_vent", "ac_temp", "fan_level", "flash_lights", "tts"]) {
    assert.equal(validateVehicleCommand(type, {}).ok, false, type);
  }
  assert.equal(buildDiplusPhrase("发送CAN", {}).ok, false);
});
