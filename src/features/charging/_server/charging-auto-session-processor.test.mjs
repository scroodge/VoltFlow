import test from "node:test";
import assert from "node:assert/strict";
import { planChargingBatch, drainChargingQueue } from "./charging-auto-session-processor.ts";

const NOW = Date.parse("2026-09-11T12:00:00Z");
const at = (seconds) => new Date(NOW + seconds * 1000).toISOString();
const car = { id: "car", user_id: "owner", vehicle_alias: "vehicle", battery_capacity_kwh: 60, default_charger_power_kw: 7 };
const sample = (seconds, telemetry = {}) => ({
  schema_version: 1, source: "BYDMate", vehicle_id: "vehicle", device_time: at(seconds),
  telemetry: { soc: 50, charge_power_kw: 7, speed_kmh: 0, ...telemetry }, location: {},
});
let nextId = 0;
const prepareStart = async (_car, _sample, action) => ({
  id: "session-" + ++nextId, user_id: "owner", car_id: "car", status: "charging",
  start_percent: action.startPercent, current_percent: action.startPercent, target_percent: 100,
  started_at: action.startedAt, battery_capacity_kwh: 60, charger_power_kw: 7,
  efficiency_percent: 98, price_per_kwh: 1, charged_energy_kwh: 0, estimated_cost: 0,
});
const snapshot = (samples, state = null, sessions = []) => ({ car, samples, state, sessions });
const plan = (s) => planChargingBatch(s, NOW, prepareStart);
const active = () => ({ id: "existing", user_id: "owner", car_id: "car", status: "charging",
  started_at: at(-600), start_percent: 40, current_percent: 50, target_percent: 100,
  battery_capacity_kwh: 60, charger_power_kw: 7, efficiency_percent: 98, price_per_kwh: 1 });

test("one measurement repeated four times cannot start a charge", async () => {
  const result = await plan(snapshot(Array.from({ length: 4 }, () => sample(-30))));
  assert.equal(result.started, 0);
  assert.equal(result.state.consecutive_charging_samples, 1);
});

test("unordered bulk samples start once and backdate to the first distinct measurement", async () => {
  const result = await plan(snapshot([sample(-10), sample(-40), sample(-20), sample(-30)]));
  assert.equal(result.started, 1);
  assert.equal(result.operations[0].row.started_at, at(-40));
});

test("duplicate and older deliveries do not advance or rewind committed state", async () => {
  const first = await plan(snapshot([sample(-20)]));
  const next = await plan(snapshot([sample(-30), sample(-20)], first.state));
  assert.deepEqual(next.state, first.state);
  assert.equal(next.operations.length, 0);
});

test("an entirely old batch cannot start a live session", async () => {
  const result = await plan(snapshot([-3600, -3590, -3580, -3570].map((s) => sample(s))));
  assert.equal(result.started, 0);
  assert.equal(result.state.consecutive_charging_samples, 0);
});

test("a stale three-sample streak expires before the next sample", async () => {
  const first = await planChargingBatch(snapshot([-400, -390, -380].map((s) => sample(s))), NOW - 380_000, prepareStart);
  const result = await plan(snapshot([sample(-10)], first.state));
  assert.equal(result.started, 0);
  assert.equal(result.state.consecutive_charging_samples, 1);
  assert.equal(result.state.streak_start_device_time, at(-10));
});

test("future clock jumps never poison the watermark or block valid measurements", async () => {
  const future = await plan(snapshot([sample(3600)]));
  assert.equal(future.state.last_device_time, null);
  const valid = await plan(snapshot([-30, -20, -10, 0].map((s) => sample(s)), future.state));
  assert.equal(valid.started, 1);
  assert.equal(valid.state.last_device_time, at(0));
});

test("one retried unplug counts once; the second distinct unplug stops", async () => {
  const unplug = (s) => sample(s, { charge_power_kw: 0, is_charging: false });
  const first = await plan(snapshot([unplug(-20), unplug(-20)], null, [active()]));
  assert.equal(first.stopped, 0);
  const second = await plan(snapshot([unplug(-20), unplug(-10)], first.state, [active()]));
  assert.equal(second.stopped, 1);
});

test("a delayed drive-away after session start can finish the existing session", async () => {
  const result = await plan(snapshot([sample(-300, { speed_kmh: 40, charge_power_kw: 0, soc: 55 })], null, [active()]));
  assert.equal(result.stopped, 1);
  assert.equal(result.operations[0].patch.stopped_at, at(-300));
});

test("snapshot-only pushes and pre-session measurements do not stop a manual session", async () => {
  const result = await plan(snapshot([
    { ...sample(-20, { speed_kmh: 40 }), live_only: true },
    sample(-700, { speed_kmh: 40, charge_power_kw: 0 }),
  ], null, [active()]));
  assert.equal(result.operations.length, 0);
});

// Models the store contract only. Actual Postgres transaction tests are separate.
function memoryStore(samples) {
  let current = snapshot(samples);
  let version = 0;
  let failNext = false;
  return {
    read: async () => structuredClone(current),
    failNextCommit() { failNext = true; },
    inspect: () => structuredClone(current),
    async commit(expected, batch) {
      if ((expected.state?.state_version ?? 0) !== version) return false;
      if (failNext) { failNext = false; throw new Error("injected commit failure"); }
      const sessions = [...current.sessions];
      for (const op of batch.operations) {
        if (op.kind === "start") sessions.push(op.row);
        else sessions.splice(sessions.findIndex((s) => s.id === op.id), 1);
      }
      version += 1;
      current = { ...current, sessions, state: { ...batch.state, state_version: version },
        samples: current.samples.filter((s) => !batch.consumedTimes.includes(s.device_time)) };
      return true;
    },
  };
}

test("overlapping workers retry their stale plans and commit one session", async () => {
  const store = memoryStore([-30, -20, -10, 0].map((s) => sample(s)));
  const results = await Promise.all([
    drainChargingQueue(store, prepareStart, () => NOW),
    drainChargingQueue(store, prepareStart, () => NOW),
  ]);
  assert.equal(results.reduce((n, r) => n + r.started, 0), 1);
  assert.equal(store.inspect().sessions.length, 1);
  assert.equal(store.inspect().state.state_version, 1);
  assert.equal(store.inspect().samples.length, 0);
});

test("failed commit retains inputs and state; retry completes exactly once", async () => {
  const store = memoryStore([-30, -20, -10, 0].map((s) => sample(s)));
  const before = store.inspect();
  store.failNextCommit();
  await assert.rejects(drainChargingQueue(store, prepareStart, () => NOW), /injected/);
  assert.deepEqual(store.inspect(), before);
  assert.equal((await drainChargingQueue(store, prepareStart, () => NOW)).started, 1);
  assert.equal((await drainChargingQueue(store, prepareStart, () => NOW)).started, 0);
});

test("contention retries are bounded and leave work pending", async () => {
  let attempts = 0;
  const s = snapshot([sample(0)]);
  await assert.rejects(drainChargingQueue({
    read: async () => s,
    commit: async () => { attempts += 1; return false; },
  }, prepareStart, () => NOW), /contention/);
  assert.equal(attempts, 4);
  assert.equal(s.samples.length, 1);
});
