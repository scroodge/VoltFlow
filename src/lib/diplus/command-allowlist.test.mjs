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
