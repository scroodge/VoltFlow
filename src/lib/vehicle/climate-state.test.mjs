import assert from "node:assert/strict";
import test from "node:test";

import {
  climateCommandsInFlight,
  readClimateState,
  unconfirmedClimateCommand,
} from "./climate-state.ts";

const T0 = Date.parse("2026-11-04T08:00:00Z");
const iso = (offsetMs) => new Date(T0 + offsetMs).toISOString();

const snapshot = {
  vehicle_id: "way",
  received_at: iso(0),
  diplus: { ac_status: 1, ac_temp_c: 24, fan_level: 3, ac_circ: "1" },
};

function cmd(id, type, status, createdMs, extra = {}) {
  return {
    id,
    user_id: "u",
    vehicle_id: "way",
    type,
    params: {},
    status,
    result: null,
    created_at: iso(createdMs),
    executed_at: status === "done" ? iso(createdMs + 600) : null,
    ...extra,
  };
}

test("snapshot values are the baseline", () => {
  assert.deepEqual(readClimateState(snapshot, []), {
    ac_status: 1,
    ac_temp_c: 24,
    fan_level: 3,
    ac_circ: 1,
  });
  assert.deepEqual(readClimateState(undefined, undefined), {
    ac_status: null,
    ac_temp_c: null,
    fan_level: null,
    ac_circ: null,
  });
});

test("a newer ack overrides the snapshot, an older one does not", () => {
  const newer = cmd("a", "ac_temp_step", "done", 1000, {
    result: {
      verified: true,
      state: { field: "ac_temp_c", before: 24, after: 23 },
    },
  });
  assert.equal(readClimateState(snapshot, [newer]).ac_temp_c, 23);

  const older = cmd("b", "fan_speed_step", "done", -5000, {
    result: {
      verified: true,
      state: { field: "fan_level", before: 2, after: 4 },
    },
  });
  assert.equal(readClimateState(snapshot, [older]).fan_level, 3);
});

test("an ack outranks a snapshot received just after it", () => {
  const ack = cmd("a", "fan_speed_step", "done", -1500, {
    result: {
      verified: true,
      state: { field: "fan_level", before: 3, after: 2 },
    },
  });
  // executed at -900 ms; the snapshot (received at 0) still read the old 3.
  assert.equal(readClimateState(snapshot, [ack]).fan_level, 2);
});

test("only the newest ack per field counts", () => {
  const first = cmd("a", "ac_temp_step", "done", 1000, {
    result: { state: { field: "ac_temp_c", after: 23 } },
  });
  const second = cmd("b", "ac_temp_step", "done", 2000, {
    result: { state: { field: "ac_temp_c", after: 22 } },
  });
  assert.equal(readClimateState(snapshot, [first, second]).ac_temp_c, 22);
});

test("in-flight and unconfirmed climate commands", () => {
  const commands = [
    cmd("p", "fan_speed_step", "sent", 3000),
    cmd("w", "windows_preset", "pending", 3000),
  ];
  assert.deepEqual(
    climateCommandsInFlight(commands).map((c) => c.id),
    ["p"],
  );

  const stuck = cmd("s", "fan_speed_step", "done", 1000, {
    result: {
      verified: false,
      state: { field: "fan_level", before: 7, after: 7 },
    },
  });
  assert.equal(unconfirmedClimateCommand([stuck], T0 + 5000)?.id, "s");
  assert.equal(unconfirmedClimateCommand([stuck], T0 + 10 * 60 * 1000), null);

  // Pre-0.6.5 acks have verified:false but no state — not a warning.
  const legacy = cmd("l", "fan_speed_step", "done", 1000, {
    result: { verified: false },
  });
  assert.equal(unconfirmedClimateCommand([legacy], T0 + 5000), null);
});
