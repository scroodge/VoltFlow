import test from "node:test";
import assert from "node:assert/strict";

import { isJunkTrip, isStationaryChargingLikeTrip } from "./trip-filter.ts";

const baseTrip = {
  id: "trip-1",
  user_id: "user-1",
  vehicle_id: "way",
  started_at: "2026-05-26T10:00:00.000Z",
  ended_at: "2026-05-26T10:10:00.000Z",
  last_device_time: "2026-05-26T10:10:00.000Z",
  sample_count: 3,
  track_point_count: 0,
  distance_km: 0,
  soc_start: 60,
  soc_end: 62,
  max_speed_kmh: 0,
  avg_speed_kmh: 0,
  avg_consumption_kwh_100km: null,
};

test("hides stationary trips with negative power as likely charging", () => {
  assert.equal(
    isStationaryChargingLikeTrip(baseTrip, [
      { power_kw: -6, speed_kmh: 0, current_trip_distance_km: 0 },
      { power_kw: -7, speed_kmh: 0, current_trip_distance_km: 0 },
    ]),
    true,
  );
});

test("keeps moving trips even when regenerative power is negative", () => {
  assert.equal(
    isStationaryChargingLikeTrip(
      {
        ...baseTrip,
        distance_km: 4.2,
        max_speed_kmh: 45,
        avg_speed_kmh: 22,
      },
      [
        { power_kw: 18, speed_kmh: 44, current_trip_distance_km: 4 },
        { power_kw: -12, speed_kmh: 28, current_trip_distance_km: 4.2 },
      ],
    ),
    false,
  );
});

test("keeps stationary-looking trips when power never goes negative", () => {
  assert.equal(
    isStationaryChargingLikeTrip(baseTrip, [
      { power_kw: 0, speed_kmh: 0, current_trip_distance_km: 0 },
      { power_kw: 0.2, speed_kmh: 0, current_trip_distance_km: 0 },
    ]),
    false,
  );
});

test("keeps trips without stationary evidence", () => {
  assert.equal(
    isStationaryChargingLikeTrip(
      {
        ...baseTrip,
        distance_km: null,
        max_speed_kmh: null,
        avg_speed_kmh: null,
      },
      [{ power_kw: -4 }],
    ),
    false,
  );
});

test("isJunkTrip drops two-sample stationary parking trips", () => {
  assert.equal(
    isJunkTrip(
      {
        ...baseTrip,
        sample_count: 2,
        distance_km: 0,
        max_speed_kmh: 0,
        avg_speed_kmh: 0,
      },
      [
        { power_kw: 0, speed_kmh: 0, current_trip_distance_km: 0 },
        { power_kw: 0.1, speed_kmh: 0, current_trip_distance_km: 0 },
      ],
    ),
    true,
  );
});

test("isJunkTrip keeps two-sample trips with movement", () => {
  assert.equal(
    isJunkTrip(
      {
        ...baseTrip,
        sample_count: 2,
        distance_km: 2.4,
        max_speed_kmh: 38,
        avg_speed_kmh: 24,
      },
      [
        { power_kw: 12, speed_kmh: 30, current_trip_distance_km: 1 },
        { power_kw: 8, speed_kmh: 38, current_trip_distance_km: 2.4 },
      ],
    ),
    false,
  );
});
