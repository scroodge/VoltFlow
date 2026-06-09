import assert from "node:assert/strict";
import test from "node:test";

import { buildDiplusPhrase, validateVehicleCommand } from "./command-allowlist.ts";

test("lock builds safe phrase", () => {
  const result = buildDiplusPhrase("lock", {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.phrase, "车门上锁");
});

test("set_soc_limit validates range", () => {
  assert.equal(validateVehicleCommand("set_soc_limit", { value: 49 }).ok, false);
  assert.equal(validateVehicleCommand("set_soc_limit", { value: 80 }).ok, true);
});

test("window maps driver target", () => {
  const result = buildDiplusPhrase("window", { which: "driver", pct: 10 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.phrase, "主驾车窗打开百分之10");
});

test("rejects unknown type", () => {
  assert.equal(buildDiplusPhrase("发送CAN", {}).ok, false);
  assert.equal(buildDiplusPhrase("shell", {}).ok, false);
});

test("schedule_charge pads minutes", () => {
  const result = buildDiplusPhrase("schedule_charge", { hh: 22, mm: 5, end: 6 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.phrase, "预约充电22:05-6");
});

test("windows_preset maps vent close open", () => {
  assert.equal(buildDiplusPhrase("windows_preset", { preset: "vent" }).phrase, "车窗通风");
  assert.equal(buildDiplusPhrase("windows_preset", { preset: "close" }).phrase, "车窗关闭");
  assert.equal(buildDiplusPhrase("windows_preset", { preset: "open" }).phrase, "车窗全开");
});

test("ac and ac_vent map climate phrases", () => {
  assert.equal(buildDiplusPhrase("ac", { on: true }).phrase, "自动空调");
  assert.equal(buildDiplusPhrase("ac", { on: false }).phrase, "关闭空调");
  assert.equal(buildDiplusPhrase("ac_vent", { on: true }).phrase, "打开空调通风");
  assert.equal(buildDiplusPhrase("ac_vent", { on: false }).phrase, "关闭空调");
});
