import test from "node:test";
import assert from "node:assert/strict";

import { normalizePayloads } from "./ingest-payload.ts";

const basePayload = {
  schema_version: 1,
  vehicle_id: "way",
  device_time: "2026-05-21T08:15:00.000Z",
  source: "BYDMate",
  telemetry: {
    soc: 72,
    speed_kmh: 0,
    power_kw: 0,
  },
  location: {
    lat: 53.9,
    lon: 27.56,
  },
};

test("accepts legacy BYDMate payload without diplus", () => {
  const result = normalizePayloads(basePayload);

  assert.equal(result.success, true);
  assert.equal(result.payloads.length, 1);
  assert.equal(result.payloads[0].vehicle_id, "way");
  assert.equal(result.payloads[0].diplus, undefined);
  assert.equal(result.payloads[0].telemetry.soc, 72);
});

test("strips undeclared payload fields before persistence", () => {
  const result = normalizePayloads({
    ...basePayload,
    unexpected_top_level: "do-not-store",
    telemetry: { ...basePayload.telemetry, unexpected_telemetry: "do-not-store" },
    location: { ...basePayload.location, street_address: "do-not-store" },
  });

  assert.equal(result.success, true);
  assert.equal("unexpected_top_level" in result.payloads[0], false);
  assert.equal("unexpected_telemetry" in result.payloads[0].telemetry, false);
  assert.equal("street_address" in result.payloads[0].location, false);
});

test("accepts BYDMate batch sample with null diplus", () => {
  const result = normalizePayloads({
    samples: [
      {
        ...basePayload,
        vehicle_id: "test-car",
        device_time: "2026-05-25T18:00:00Z",
        telemetry: { soc: 50 },
        diplus: null,
        location: {},
      },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.payloads.length, 1);
  assert.equal(result.payloads[0].vehicle_id, "test-car");
  assert.equal(result.payloads[0].diplus, undefined);
  assert.equal(result.payloads[0].telemetry.soc, 50);
});

test("accepts single BYDMate sample with null diplus", () => {
  const result = normalizePayloads({
    ...basePayload,
    diplus: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.payloads[0].diplus, undefined);
});

test("accepts extended BYDMate payload with diplus", () => {
  const result = normalizePayloads({
    ...basePayload,
    diplus: {
      soc: 72,
      speed_kmh: 0,
      mileage_km: 14_250.5,
      power_kw: -1.2,
      charge_gun_state: "disconnected",
      charging_status: "idle",
      battery_capacity_kwh: 45.12,
      total_elec_consumption_kwh: 2_345.6,
      voltage_12v: 12.7,
      min_cell_voltage_v: 3.318,
      max_cell_voltage_v: 3.342,
      cell_delta_v: 0.024,
      avg_battery_temp_c: 24.5,
      exterior_temp_c: 19.2,
      gear: "P",
      power_state: "ready",
      inside_temp_c: 22.1,
      ac_status: true,
      ac_temp_c: 21,
      fan_level: 2,
      door_fl: false,
      door_fr: false,
      door_rl: false,
      door_rr: false,
      window_fl_percent: 0,
      window_fr_percent: 0,
      window_rl_percent: 0,
      window_rr_percent: 0,
      sunroof_percent: 0,
      trunk: false,
      hood: false,
      tire_press_fl_kpa: 250,
      tire_press_fr_kpa: 249,
      tire_press_rl_kpa: 251,
      tire_press_rr_kpa: 250,
      drive_mode: "eco",
      work_mode: "normal",
      auto_park: false,
      rain: false,
      light_low: true,
      drl: true,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.payloads.length, 1);
  assert.equal(result.payloads[0].telemetry.soc, 72);
  assert.equal(result.payloads[0].diplus?.cell_delta_v, 0.024);
  assert.equal(result.payloads[0].diplus?.charge_gun_state, "disconnected");
});

test("accepts numeric BYDMate Di+ states and telemetry cell voltage fields", () => {
  const result = normalizePayloads({
    ...basePayload,
    telemetry: {
      ...basePayload.telemetry,
      cell_voltage_min_v: 3.3,
      cell_voltage_max_v: 3.31,
      diplus_min_cell_voltage_v: 3.301,
      diplus_max_cell_voltage_v: 3.312,
      diplus_cell_delta_v: 0.011,
    },
    diplus: {
      charge_gun_state: 1,
      charging_status: 0,
      min_cell_voltage_v: 3.29,
      max_cell_voltage_v: 3.32,
      cell_delta_v: 0.03,
      gear: 1,
      power_state: 1,
      ac_status: 0,
      door_fl: 0,
      auto_park: 0,
      rain: 0,
      light_low: 0,
      drl: 1,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.payloads[0].telemetry.diplus_min_cell_voltage_v, 3.301);
  assert.equal(result.payloads[0].diplus?.charge_gun_state, 1);
  assert.equal(result.payloads[0].diplus?.drl, 1);
});

test("coerces numeric BYDMate values sent as strings", () => {
  const result = normalizePayloads({
    ...basePayload,
    telemetry: {
      soc: "72",
      speed_kmh: "0",
      power_kw: "-4.5",
      is_charging: "true",
      cell_voltage_min_v: "3.301",
      cell_voltage_max_v: "3.312",
      diplus_cell_delta_v: "0.011",
    },
    diplus: {
      soc: "72",
      speed_kmh: "0",
      mileage_km: "14250.5",
      power_kw: "-4.5",
      voltage_12v: "13.7",
      min_cell_voltage_v: "3.301",
      max_cell_voltage_v: "3.312",
      cell_delta_v: "0.011",
      tire_press_fl_kpa: "230",
      drl: "1",
    },
    location: {
      lat: "53.9",
      lon: "27.56",
      accuracy_m: "8",
      bearing_deg: "180",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.payloads[0].telemetry.soc, 72);
  assert.equal(result.payloads[0].telemetry.power_kw, -4.5);
  assert.equal(result.payloads[0].telemetry.is_charging, true);
  assert.equal(result.payloads[0].diplus?.mileage_km, 14_250.5);
  assert.equal(result.payloads[0].diplus?.drl, "1");
  assert.equal(result.payloads[0].location.lat, 53.9);
});

test("accepts slim idle payload without diplus or power fields", () => {
  const result = normalizePayloads({
    schema_version: 1,
    vehicle_id: "way",
    device_time: "2026-05-30T08:00:00.000Z",
    source: "BYDMate",
    telemetry: {
      soc: 68,
      is_charging: false,
    },
    location: {},
  });

  assert.equal(result.success, true);
  assert.equal(result.payloads.length, 1);
  assert.equal(result.payloads[0].telemetry.soc, 68);
  assert.equal(result.payloads[0].telemetry.power_kw, undefined);
  assert.equal(result.payloads[0].diplus, undefined);
});

test("accepts legacy 60-sample batch from old APK", () => {
  const samples = Array.from({ length: 60 }, (_, index) => ({
    schema_version: 1,
    vehicle_id: "way",
    device_time: new Date(Date.UTC(2026, 4, 30, 8, 0, index)).toISOString(),
    source: "BYDMate",
    telemetry: {
      soc: 50 + index * 0.1,
      power_kw: -7,
      is_charging: true,
    },
    diplus: null,
    location: {},
  }));

  const result = normalizePayloads({ samples });
  assert.equal(result.success, true);
  assert.equal(result.payloads.length, 60);
  assert.equal(result.payloads[0].schema_version, 1);
  assert.equal(result.payloads.at(-1)?.telemetry.soc, 55.9);
});
