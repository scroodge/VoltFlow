import assert from "node:assert/strict";
import test from "node:test";

import { recoveryTailSessionToRepair } from "./recovery-session-repair.ts";

const candidate = {
  startedAt: "2026-11-15T11:29:40.780Z",
  // Recovery closes on the first non-charging sample; the auto reducer closes the tail
  // at the second confirmation, 32 seconds later.
  stoppedAt: "2026-11-15T16:27:25.366Z",
};

function tail(overrides = {}) {
  return {
    id: "tail",
    status: "stopped",
    started_at: "2026-11-15T16:23:52.132Z",
    stopped_at: "2026-11-15T16:27:57.320Z",
    manual_entry: false,
    energy_overridden: false,
    tariff_manual: false,
    session_origin: "legacy",
    ...overrides,
  };
}

test("a full late charge repairs its one auto-derived tail", () => {
  assert.equal(recoveryTailSessionToRepair([tail()], candidate)?.id, "tail");
});

test("recovery never rewrites receipt, correction, selected tariff, open, or recovered rows", () => {
  for (const overrides of [
    { manual_entry: true },
    { energy_overridden: true },
    { tariff_manual: true },
    { status: "charging", stopped_at: null },
    { session_origin: "telemetry_recovered" },
  ]) {
    assert.equal(recoveryTailSessionToRepair([tail(overrides)], candidate), null);
  }
});

test("a partial, exact, or ambiguous overlap stays protected", () => {
  assert.equal(
    recoveryTailSessionToRepair([tail({ started_at: "2026-11-15T11:00:00.000Z" })], candidate),
    null,
  );
  assert.equal(
    recoveryTailSessionToRepair([tail({ started_at: candidate.startedAt, stopped_at: candidate.stoppedAt })], candidate),
    null,
  );
  assert.equal(recoveryTailSessionToRepair([tail(), tail({ id: "other" })], candidate), null);
  assert.equal(
    recoveryTailSessionToRepair(
      [tail({ stopped_at: "2026-11-15T16:30:25.367Z" })],
      candidate,
    ),
    null,
  );
});
