import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuxBatteryAlerts } from "./aux-battery-alerts.ts";

const point = (date, voltage) => ({ date, vMin: voltage, vMax: 14, vResting: voltage, restingSampleCount: 4 });
const state = { acuteEpisodeActive: false, lastDigestAt: null };

test("acute alert needs consecutive low calendar days and fires once per episode", () => {
  const first = evaluateAuxBatteryAlerts({ points: [point("2026-08-24", 12.2), point("2026-08-25", 12.2)], chemistry: "flooded", state, now: "2026-08-26T03:00:00Z" });
  assert.equal(first.sendAcute, true);
  const repeat = evaluateAuxBatteryAlerts({ points: [point("2026-08-25", 12.2), point("2026-08-26", 12.1)], chemistry: "flooded", state: first.nextState, now: "2026-08-27T03:00:00Z" });
  assert.equal(repeat.sendAcute, false);
  assert.equal(repeat.nextState.acuteEpisodeActive, true);
});

test("acute episode rearms only after two recovered days with 0.2 V hysteresis", () => {
  const active = { acuteEpisodeActive: true, lastDigestAt: null };
  const notRecovered = evaluateAuxBatteryAlerts({ points: [point("2026-08-24", 12.49), point("2026-08-25", 12.5)], chemistry: "flooded", state: active, now: "2026-08-26T03:00:00Z" });
  assert.equal(notRecovered.nextState.acuteEpisodeActive, true);
  const recovered = evaluateAuxBatteryAlerts({ points: [point("2026-08-24", 12.5), point("2026-08-25", 12.51)], chemistry: "flooded", state: active, now: "2026-08-26T03:00:00Z" });
  assert.equal(recovered.nextState.acuteEpisodeActive, false);
});

test("unknown chemistry never gets acute alert", () => {
  const result = evaluateAuxBatteryAlerts({ points: [point("2026-08-24", 10), point("2026-08-25", 10)], chemistry: "other", state, now: "2026-08-26T03:00:00Z" });
  assert.equal(result.sendAcute, false);
});

test("missing previous-day rollup fails closed without changing alert state", () => {
  const active = { acuteEpisodeActive: true, lastDigestAt: "2026-08-20T03:00:00Z" };
  const result = evaluateAuxBatteryAlerts({
    points: [point("2026-08-23", 12.2), point("2026-08-24", 12.1)],
    chemistry: "flooded",
    state: active,
    now: "2026-08-26T04:17:00Z",
  });
  assert.equal(result.sendAcute, false);
  assert.equal(result.sendDigest, false);
  assert.deepEqual(result.nextState, active);
});

test("digest stays silent with fewer than 14 resting days", () => {
  const points = Array.from({ length: 12 }, (_, index) => point(`2026-08-${String(index + 1).padStart(2, "0")}`, 12.8));
  points.push(point("2026-08-13", 12.55));
  const result = evaluateAuxBatteryAlerts({ points, chemistry: "flooded", state, now: "2026-08-14T04:17:00Z" });
  assert.equal(result.sendDigest, false);
  assert.equal(result.baseline, null);
});

test("digest requires a validated baseline, decline, and only fires once per UTC week", () => {
  const points = Array.from({ length: 14 }, (_, index) => point(`2026-08-${String(index + 1).padStart(2, "0")}`, 12.8));
  points.push(point("2026-08-15", 12.65), point("2026-08-16", 12.55));
  const first = evaluateAuxBatteryAlerts({ points, chemistry: "flooded", state, now: "2026-08-17T03:00:00Z" });
  assert.equal(first.sendDigest, true);
  const repeat = evaluateAuxBatteryAlerts({ points, chemistry: "flooded", state: first.nextState, now: "2026-08-20T03:00:00Z" });
  assert.equal(repeat.sendDigest, false);
});
