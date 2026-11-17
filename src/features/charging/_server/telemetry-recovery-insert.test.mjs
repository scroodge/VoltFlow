import assert from "node:assert/strict";
import test from "node:test";

import { insertRecoveredSession } from "./telemetry-recovery-insert.ts";

const car = {
  id: "car",
  battery_capacity_kwh: 60,
  default_efficiency_percent: 98,
  fast_dc_efficiency_percent: 90,
};
const candidate = {
  key: "2026-11-15T11:29:40.780Z:2026-11-15T16:27:57.320Z",
  startedAt: "2026-11-15T11:29:40.780Z",
  stoppedAt: "2026-11-15T16:27:25.366Z",
  startPercent: 50.4,
  endPercent: 69.3,
  chargerPowerKw: 1.77,
  tariffType: "home",
  efficiencyPercent: 98,
  chargedEnergyKwh: 11.57,
};
const tail = {
  id: "tail",
  status: "stopped",
  started_at: "2026-11-15T16:23:52.132Z",
  stopped_at: "2026-11-15T16:27:57.320Z",
  manual_entry: false,
  energy_overridden: false,
  tariff_manual: false,
  session_origin: "legacy",
};

function query(result) {
  const chain = {
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    is: () => chain,
    limit: () => chain,
    select: () => chain,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function recoveryInsertClient({ closed = [tail] } = {}) {
  const updates = [];
  let chargingReads = 0;
  return {
    updates,
    from(table) {
      if (table === "profiles") {
        return query({ data: { default_price_per_kwh: 0.5 }, error: null });
      }
      if (table !== "charging_sessions") throw new Error(`unexpected table ${table}`);
      chargingReads += 1;
      if (chargingReads === 1) return query({ data: null, error: null });
      if (chargingReads === 2) return query({ data: closed, error: null });
      if (chargingReads === 3) return query({ data: [], error: null });

      const update = {
        eq: () => update,
        select: () => update,
        maybeSingle: async () => ({ data: { id: "tail" }, error: null }),
      };
      return {
        update(fields) {
          updates.push(fields);
          return update;
        },
      };
    },
  };
}

test("late recovery replaces the auto-created tail with the complete candidate", async () => {
  const client = recoveryInsertClient();
  const result = await insertRecoveredSession(client, { userId: "user", car, candidate });

  assert.deepEqual(result, { ok: true, sessionId: "tail" });
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].started_at, candidate.startedAt);
  assert.equal(client.updates[0].stopped_at, candidate.stoppedAt);
  assert.equal(client.updates[0].start_percent, candidate.startPercent);
  assert.equal(client.updates[0].current_percent, candidate.endPercent);
  assert.equal(client.updates[0].session_origin, "telemetry_recovered");
});

test("recovery still refuses to change a corrected overlap", async () => {
  const client = recoveryInsertClient({ closed: [{ ...tail, energy_overridden: true }] });
  const result = await insertRecoveredSession(client, { userId: "user", car, candidate });

  assert.deepEqual(result, {
    ok: false,
    code: "overlap",
    error: "A charging session already covers this time range",
  });
  assert.equal(client.updates.length, 0);
});
