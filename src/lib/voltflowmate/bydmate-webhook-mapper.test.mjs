import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bydMateWebhookSchema,
  mapBydMateWebhookPayload,
} from "./bydmate-webhook-mapper.ts";

function parse(raw) {
  return bydMateWebhookSchema.parse(raw);
}

test("drops a sample with no soc, matching the sender's own send gate", () => {
  const raw = parse({ utc: 1790680056, power: -4.6 });
  assert.equal(mapBydMateWebhookPayload(raw), null);
});

test("drops a sample with no utc", () => {
  const raw = parse({ soc: 76 });
  assert.equal(mapBydMateWebhookPayload(raw), null);
});

test("computes charge_power_kw from voltage*current, not the signed power field", () => {
  const raw = parse({
    utc: 1790680056,
    soc: 76,
    is_charging: 1,
    voltage: 318,
    current: -14.79998779296875,
    power: -4.7,
  });
  const mapped = mapBydMateWebhookPayload(raw);
  assert.ok(mapped);
  assert.equal(mapped.telemetry.is_charging, true);
  // 318 * 14.79998779296875 / 1000 ≈ 4.7064 kW
  assert.equal(mapped.telemetry.charge_power_kw, 4.706);
});

test("charge_power_kw is 0 while not charging even if voltage/current are present", () => {
  const raw = parse({
    utc: 1790680056,
    soc: 76,
    is_charging: 0,
    voltage: 318,
    current: -14.8,
  });
  const mapped = mapBydMateWebhookPayload(raw);
  assert.ok(mapped);
  assert.equal(mapped.telemetry.charge_power_kw, 0);
});

test("maps is_dcfc to charge_type, and AC charging when is_dcfc is absent", () => {
  const dc = mapBydMateWebhookPayload(
    parse({ utc: 1790680056, soc: 50, is_charging: 1, is_dcfc: 1 }),
  );
  assert.equal(dc.telemetry.charge_type, "dc");

  const ac = mapBydMateWebhookPayload(
    parse({ utc: 1790680056, soc: 50, is_charging: 1 }),
  );
  assert.equal(ac.telemetry.charge_type, "ac");

  const parked = mapBydMateWebhookPayload(
    parse({ utc: 1790680056, soc: 50, is_charging: 0 }),
  );
  assert.equal(parked.telemetry.charge_type, null);
});

test("location is empty unless both lat and lon are present and plausible", () => {
  const noCoords = mapBydMateWebhookPayload(parse({ utc: 1790680056, soc: 50 }));
  assert.deepEqual(noCoords.location, {});

  const withCoords = mapBydMateWebhookPayload(
    parse({ utc: 1790680056, soc: 50, lat: 53.9452735, lon: 27.35316684, heading: 12 }),
  );
  assert.deepEqual(withCoords.location, {
    lat: 53.9452735,
    lon: 27.35316684,
    bearing_deg: 12,
  });

  const zeroZero = mapBydMateWebhookPayload(
    parse({ utc: 1790680056, soc: 50, lat: 0, lon: 0 }),
  );
  assert.deepEqual(zeroZero.location, {});
});

test("device_time converts the sender's epoch-seconds utc to ISO-8601", () => {
  const mapped = mapBydMateWebhookPayload(parse({ utc: 1790680056, soc: 50 }));
  assert.equal(mapped.deviceTime, new Date(1790680056 * 1000).toISOString());
});

test("out-of-range soc drops the whole sample", () => {
  assert.equal(
    mapBydMateWebhookPayload(parse({ utc: 1790680056, soc: 150 })),
    null,
  );
  assert.equal(
    mapBydMateWebhookPayload(parse({ utc: 1790680056, soc: -1 })),
    null,
  );
});

test("numeric fields accept numeric strings, matching the wire format seen in practice", () => {
  const mapped = mapBydMateWebhookPayload(
    parse({ utc: "1790680056", soc: "76", speed: "0" }),
  );
  assert.ok(mapped);
  assert.equal(mapped.telemetry.soc, 76);
  assert.equal(mapped.telemetry.speed_kmh, 0);
});
