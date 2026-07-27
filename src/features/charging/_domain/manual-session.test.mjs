import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveManualSessionFields,
  manualSessionOverlaps,
} from "./manual-session.ts";

/** Atto 3-ish pack with the repo's measured AC/DC efficiencies. */
const CAR = {
  battery_capacity_kwh: 60,
  default_efficiency_percent: 98,
  fast_dc_efficiency_percent: 90,
};

const START = Date.parse("2026-07-26T21:00:00.000Z");
const hoursAfterStart = (h) => START + h * 3_600_000;

function derive(overrides = {}) {
  return deriveManualSessionFields({
    billedKwh: 20,
    totalCost: 7.2,
    startedAtMs: START,
    stoppedAtMs: hoursAfterStart(4),
    car: CAR,
    ...overrides,
  });
}

test("derives charger power from billed energy over the entered duration", () => {
  const res = derive({ billedKwh: 20, stoppedAtMs: hoursAfterStart(4) });
  assert.equal(res.ok, true);
  assert.equal(res.derived.chargerPowerKw, 5);
});

test("power band picks the tariff type and its efficiency", () => {
  // 20 kWh over 4 h = 5 kW → commercial AC (>= 4 kW, < 10 kW) → default efficiency.
  const ac = derive({ billedKwh: 20, stoppedAtMs: hoursAfterStart(4) });
  assert.equal(ac.derived.tariffType, "commercial_ac");
  assert.equal(ac.derived.efficiencyPercent, 98);

  // 40 kWh over 1 h = 40 kW → fast DC → the per-car DC efficiency, not the AC one.
  const dc = derive({ billedKwh: 40, stoppedAtMs: hoursAfterStart(1) });
  assert.equal(dc.derived.tariffType, "fast_dc");
  assert.equal(dc.derived.efficiencyPercent, 90);
});

test("SOC delta runs grid-side energy back through efficiency to battery-side", () => {
  // 20 kWh billed x 98% = 19.6 kWh into a 60 kWh pack = 32.67%.
  const res = derive({ billedKwh: 20, stoppedAtMs: hoursAfterStart(4) });
  const delta = res.derived.targetPercent - res.derived.startPercent;
  assert.ok(Math.abs(delta - 32.666) < 0.01, `delta was ${delta}`);
});

test("a telemetry anchor places the range on the battery and marks it anchored", () => {
  const res = derive({ anchorSoc: 40, billedKwh: 20, stoppedAtMs: hoursAfterStart(4) });
  assert.equal(res.derived.socAnchored, true);
  assert.equal(res.derived.startPercent, 40);
  assert.ok(Math.abs(res.derived.targetPercent - 72.666) < 0.01);
  // current == target: a manual row is always already finished.
  assert.equal(res.derived.currentPercent, res.derived.targetPercent);
});

test("without an anchor the range starts at zero and is flagged unanchored", () => {
  const res = derive({ anchorSoc: null });
  assert.equal(res.derived.socAnchored, false);
  assert.equal(res.derived.startPercent, 0);
});

test("out-of-range anchors are treated as no anchor at all", () => {
  for (const anchorSoc of [-5, 120, Number.NaN]) {
    const res = derive({ anchorSoc });
    assert.equal(res.derived.socAnchored, false, `anchor ${anchorSoc}`);
    assert.equal(res.derived.startPercent, 0);
  }
});

test("an anchor that would push the gain past 100% slides the window down", () => {
  // 50 kWh over 5 h = 10 kW, which is exactly FAST_DC_MIN_KW → fast DC → 90% efficiency.
  // 50 x 90% = 45 kWh into 60 kWh = 75% gain; anchored at 40 that would end at 115.
  const res = derive({ anchorSoc: 40, billedKwh: 50, stoppedAtMs: hoursAfterStart(5) });
  assert.equal(res.derived.tariffType, "fast_dc");
  assert.equal(res.derived.targetPercent, 100);
  // The delta is preserved rather than silently truncated — the window slides to 25 → 100.
  const delta = res.derived.targetPercent - res.derived.startPercent;
  assert.ok(Math.abs(delta - 75) < 0.01, `delta was ${delta}`);
  assert.equal(res.derived.startPercent, 25);
});

test("percent order constraint always holds", () => {
  const cases = [
    { billedKwh: 0.05, stoppedAtMs: hoursAfterStart(0.5), anchorSoc: 99.9 },
    { billedKwh: 100, stoppedAtMs: hoursAfterStart(1), anchorSoc: 0 },
    { billedKwh: 0.2, stoppedAtMs: hoursAfterStart(1), anchorSoc: 100 },
  ];
  for (const c of cases) {
    const res = derive(c);
    assert.equal(res.ok, true, JSON.stringify(c));
    const { startPercent, targetPercent } = res.derived;
    assert.ok(startPercent < targetPercent, `${startPercent} !< ${targetPercent}`);
    assert.ok(startPercent >= 0 && targetPercent <= 100);
  }
});

test("price per kWh comes from the receipt, not the tariff table", () => {
  const res = derive({ billedKwh: 20, totalCost: 7.2 });
  assert.equal(res.derived.pricePerKwh, 0.36);
  assert.equal(res.derived.chargedEnergyKwh, 20);
  assert.equal(res.derived.estimatedCost, 7.2);
  // Receipt-priced, so no provider is implied.
  assert.equal(res.derived.providerType, "custom");
});

test("a free charge is valid: zero cost, zero price", () => {
  const res = derive({ totalCost: 0 });
  assert.equal(res.ok, true);
  assert.equal(res.derived.pricePerKwh, 0);
  assert.equal(res.derived.estimatedCost, 0);
});

test("rejects a stop time at or before the start", () => {
  assert.equal(derive({ stoppedAtMs: START }).reason, "invalid_times");
  assert.equal(derive({ stoppedAtMs: START - 1000 }).reason, "invalid_times");
  assert.equal(derive({ stoppedAtMs: Number.NaN }).reason, "invalid_times");
});

test("rejects a duration longer than a day", () => {
  assert.equal(derive({ stoppedAtMs: hoursAfterStart(25) }).reason, "duration_too_long");
  assert.equal(derive({ stoppedAtMs: hoursAfterStart(24) }).ok, true);
});

test("rejects non-positive energy and negative cost", () => {
  assert.equal(derive({ billedKwh: 0 }).reason, "invalid_energy");
  assert.equal(derive({ billedKwh: -1 }).reason, "invalid_energy");
  assert.equal(derive({ totalCost: -0.01 }).reason, "invalid_cost");
});

test("rejects a car with no usable capacity", () => {
  assert.equal(
    derive({ car: { ...CAR, battery_capacity_kwh: 0 } }).reason,
    "invalid_car",
  );
});

test("rejects an entry whose implied power rounds to nothing", () => {
  // 0.001 kWh spread over 24 h is not a charge anyone had.
  const res = derive({ billedKwh: 0.001, stoppedAtMs: hoursAfterStart(24) });
  assert.equal(res.reason, "implausible_power");
});

test("caps derived power at the schema's ceiling instead of failing", () => {
  const res = derive({ billedKwh: 400, stoppedAtMs: hoursAfterStart(0.5) });
  assert.equal(res.ok, true);
  assert.equal(res.derived.chargerPowerKw, 350);
});

// ─── Overlap guard ────────────────────────────────────────────────────────────

const candidate = { startedAtMs: START, stoppedAtMs: hoursAfterStart(2) };

test("detects a session overlapping the candidate window", () => {
  assert.equal(
    manualSessionOverlaps(
      { started_at: "2026-07-26T21:30:00.000Z", stopped_at: "2026-07-26T23:30:00.000Z" },
      candidate,
    ),
    true,
  );
  // Fully contained.
  assert.equal(
    manualSessionOverlaps(
      { started_at: "2026-07-26T21:15:00.000Z", stopped_at: "2026-07-26T21:45:00.000Z" },
      candidate,
    ),
    true,
  );
  // Fully containing.
  assert.equal(
    manualSessionOverlaps(
      { started_at: "2026-07-26T20:00:00.000Z", stopped_at: "2026-07-27T00:00:00.000Z" },
      candidate,
    ),
    true,
  );
});

test("touching endpoints are not an overlap", () => {
  assert.equal(
    manualSessionOverlaps(
      { started_at: "2026-07-26T23:00:00.000Z", stopped_at: "2026-07-27T00:00:00.000Z" },
      candidate,
    ),
    false,
  );
  assert.equal(
    manualSessionOverlaps(
      { started_at: "2026-07-26T20:00:00.000Z", stopped_at: "2026-07-26T21:00:00.000Z" },
      candidate,
    ),
    false,
  );
});

test("an open session blocks anything after its start", () => {
  assert.equal(
    manualSessionOverlaps({ started_at: "2026-07-26T21:30:00.000Z", stopped_at: null }, candidate),
    true,
  );
  assert.equal(
    manualSessionOverlaps({ started_at: "2026-07-27T05:00:00.000Z", stopped_at: null }, candidate),
    false,
  );
});

test("rows with unusable timestamps never block an entry", () => {
  assert.equal(manualSessionOverlaps({ started_at: null, stopped_at: null }, candidate), false);
  assert.equal(
    manualSessionOverlaps({ started_at: "not-a-date", stopped_at: null }, candidate),
    false,
  );
});
