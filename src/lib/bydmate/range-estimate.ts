import type { BydmateLiveSnapshotRow, BydmateTripRow } from "@/types/database";

const DEFAULT_USABLE_BATTERY_KWH = 45.1;
const DEFAULT_CONSUMPTION_KWH_100KM = 18.5;
const MIN_FORECAST_CONSUMPTION_KWH_100KM = 8;
const MAX_FORECAST_CONSUMPTION_KWH_100KM = 42;

type WeightedConsumption = {
  value: number;
  weight: number;
};

export type RangeEstimate = {
  estimatedRangeKm: number | null;
  consumptionKwh100Km: number | null;
};

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validTempNumber(value: number | null | undefined) {
  const n = validNumber(value);
  return n != null && n >= -50 && n <= 90 ? n : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveUsableBatteryKwh(
  batteryCapacityKwh: number | null | undefined,
  sohPercent: number | null | undefined,
): number | null {
  const capacity = validNumber(batteryCapacityKwh) ?? DEFAULT_USABLE_BATTERY_KWH;
  const soh = validNumber(sohPercent);
  return capacity * (soh != null ? clamp(soh, 70, 105) / 100 : 1);
}

function userMedianConsumption(trips: BydmateTripRow[]): number {
  const consumptions = trips
    .filter((trip) => {
      const c = trip.avg_consumption_kwh_100km;
      const d = trip.distance_km;
      return (
        c != null &&
        c >= MIN_FORECAST_CONSUMPTION_KWH_100KM &&
        c <= MAX_FORECAST_CONSUMPTION_KWH_100KM &&
        d != null &&
        d >= 1 &&
        trip.sample_count >= 3
      );
    })
    .map((trip) => trip.avg_consumption_kwh_100km!);

  if (consumptions.length === 0) return DEFAULT_CONSUMPTION_KWH_100KM;

  const sorted = [...consumptions].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export type VehicleRangeEstimateOptions = {
  batteryCapacityKwh?: number | null;
};

export function estimateVehicleRangeKm(
  snapshot: BydmateLiveSnapshotRow,
  recentTrips: BydmateTripRow[],
  options: VehicleRangeEstimateOptions = {},
): RangeEstimate {
  const telemetry = snapshot.telemetry;
  const soc = validNumber(telemetry.soc);
  if (soc == null) return { estimatedRangeKm: null, consumptionKwh100Km: null };

  const usableBatteryKwh = resolveUsableBatteryKwh(
    options.batteryCapacityKwh,
    telemetry.soh_percent,
  );
  if (usableBatteryKwh == null || usableBatteryKwh <= 0) {
    return { estimatedRangeKm: null, consumptionKwh100Km: null };
  }
  const usableEnergyKwh = usableBatteryKwh * (clamp(soc, 0, 100) / 100);
  const consumptionKwh100Km = estimateConsumptionKwh100Km(snapshot, recentTrips, {
    batteryCapacityKwh: options.batteryCapacityKwh,
  });

  if (consumptionKwh100Km == null || consumptionKwh100Km <= 0) {
    return { estimatedRangeKm: null, consumptionKwh100Km: null };
  }

  return {
    estimatedRangeKm: (usableEnergyKwh / consumptionKwh100Km) * 100,
    consumptionKwh100Km,
  };
}

export function estimateRangeFromSoc({
  soc,
  batteryCapacityKwh = DEFAULT_USABLE_BATTERY_KWH,
  recentTrips,
}: {
  soc: number | null | undefined;
  batteryCapacityKwh?: number | null;
  recentTrips: BydmateTripRow[];
}): RangeEstimate {
  const validSoc = validNumber(soc);
  if (validSoc == null) return { estimatedRangeKm: null, consumptionKwh100Km: null };

  const tripAverage = averageTripConsumption(
    recentTrips.filter((trip) => {
      const consumption = validNumber(trip.avg_consumption_kwh_100km);
      const distance = validNumber(trip.distance_km);
      return (
        consumption != null &&
        consumption >= MIN_FORECAST_CONSUMPTION_KWH_100KM &&
        consumption <= MAX_FORECAST_CONSUMPTION_KWH_100KM &&
        distance != null &&
        distance >= 1 &&
        trip.sample_count >= 3
      );
    }),
  );
  const consumptionKwh100Km = tripAverage ?? userMedianConsumption(recentTrips);
  const usableBatteryKwh = validNumber(batteryCapacityKwh) ?? DEFAULT_USABLE_BATTERY_KWH;
  const usableEnergyKwh = usableBatteryKwh * (clamp(validSoc, 0, 100) / 100);

  return {
    estimatedRangeKm: (usableEnergyKwh / consumptionKwh100Km) * 100,
    consumptionKwh100Km,
  };
}

function estimateConsumptionKwh100Km(
  snapshot: BydmateLiveSnapshotRow,
  recentTrips: BydmateTripRow[],
  options: VehicleRangeEstimateOptions = {},
) {
  const usableBatteryKwh = validNumber(options.batteryCapacityKwh) ?? DEFAULT_USABLE_BATTERY_KWH;
  const telemetry = snapshot.telemetry;
  const estimates: WeightedConsumption[] = [];
  let reliableCount = 0;

  const currentTripConsumption = validNumber(telemetry.current_trip_consumption_kwh_100km);
  const currentTripDistance = validNumber(telemetry.current_trip_distance_km);
  if (
    currentTripConsumption != null &&
    currentTripConsumption >= MIN_FORECAST_CONSUMPTION_KWH_100KM &&
    currentTripConsumption <= MAX_FORECAST_CONSUMPTION_KWH_100KM
  ) {
    estimates.push({
      value: currentTripConsumption,
      weight: currentTripDistance != null ? clamp(currentTripDistance / 12, 0.25, 1.8) : 0.7,
    });
    reliableCount += 1;
  }

  const tripAverage = averageTripConsumption(
    recentTrips.filter((trip) => {
      const consumption = validNumber(trip.avg_consumption_kwh_100km);
      const distance = validNumber(trip.distance_km);
      return (
        consumption != null &&
        consumption >= MIN_FORECAST_CONSUMPTION_KWH_100KM &&
        consumption <= MAX_FORECAST_CONSUMPTION_KWH_100KM &&
        distance != null &&
        distance >= 1 &&
        trip.sample_count >= 3
      );
    }),
  );
  if (tripAverage != null) {
    estimates.push({ value: tripAverage, weight: 1.2 });
    reliableCount += 1;
  }

  const energyAverage = averageEnergyConsumption(
    recentTrips.filter((trip) => {
      const distance = validNumber(trip.distance_km);
      return distance != null && distance >= 1;
    }),
  );
  if (energyAverage != null) {
    estimates.push({
      value: energyAverage.value,
      weight: clamp(energyAverage.totalDistanceKm / 20, 0.3, 2.0),
    });
    reliableCount += 1;
  }

  const speedKmh = validNumber(telemetry.speed_kmh);
  const powerKw = validNumber(telemetry.power_kw);
  if (speedKmh != null && speedKmh >= 12 && powerKw != null && powerKw > 0) {
    estimates.push({
      value: clamp((powerKw / speedKmh) * 100, MIN_FORECAST_CONSUMPTION_KWH_100KM, MAX_FORECAST_CONSUMPTION_KWH_100KM),
      weight: speedKmh >= 35 ? 0.9 : 0.45,
    });
  }

  const reportedRangeKm = validNumber(telemetry.range_est_km);
  const soc = validNumber(telemetry.soc);
  if (reportedRangeKm != null && reportedRangeKm > 10 && soc != null && soc > 2) {
    const reportedConsumption = ((usableBatteryKwh * (soc / 100)) / reportedRangeKm) * 100;
    if (
      reportedConsumption >= MIN_FORECAST_CONSUMPTION_KWH_100KM &&
      reportedConsumption <= MAX_FORECAST_CONSUMPTION_KWH_100KM
    ) {
      estimates.push({ value: reportedConsumption, weight: 0.35 });
    }
  }

  const userDefault = userMedianConsumption(recentTrips);
  const fallbackWeight = reliableCount >= 2 ? 0.15 : reliableCount >= 1 ? 0.35 : 0.8;
  estimates.push({ value: userDefault, weight: fallbackWeight });

  const weightedConsumption =
    estimates.reduce((sum, estimate) => sum + estimate.value * estimate.weight, 0) /
    estimates.reduce((sum, estimate) => sum + estimate.weight, 0);

  return clamp(
    weightedConsumption * environmentConsumptionFactor(snapshot),
    MIN_FORECAST_CONSUMPTION_KWH_100KM,
    MAX_FORECAST_CONSUMPTION_KWH_100KM,
  );
}

function environmentConsumptionFactor(snapshot: BydmateLiveSnapshotRow) {
  const telemetry = snapshot.telemetry;
  let factor = 1;

  const outsideTemp = validTempNumber(telemetry.outside_temp_c);
  const batteryTemp =
    validTempNumber(telemetry.battery_temp_c) ?? validTempNumber(snapshot.diplus?.avg_battery_temp_c);
  const speedKmh = validNumber(telemetry.speed_kmh);

  if (outsideTemp != null) {
    if (outsideTemp < -10) factor += 0.28;
    else if (outsideTemp < 0) factor += 0.18;
    else if (outsideTemp < 8) factor += 0.08;
    else if (outsideTemp > 30) factor += 0.05;
  }

  if (batteryTemp != null) {
    if (batteryTemp < 5) factor += 0.12;
    else if (batteryTemp < 12) factor += 0.05;
    else if (batteryTemp > 42) factor += 0.04;
  }

  if (speedKmh != null) {
    if (speedKmh > 115) factor += 0.16;
    else if (speedKmh > 95) factor += 0.08;
    else if (speedKmh > 75) factor += 0.03;
  }

  if (snapshot.diplus?.ac_status === 1 || snapshot.diplus?.ac_status === true) {
    factor += outsideTemp != null && (outsideTemp < 8 || outsideTemp > 27) ? 0.08 : 0.03;
  }

  const tirePressures = [
    snapshot.diplus?.tire_press_fl_kpa,
    snapshot.diplus?.tire_press_fr_kpa,
    snapshot.diplus?.tire_press_rl_kpa,
    snapshot.diplus?.tire_press_rr_kpa,
  ]
    .map(validNumber)
    .filter((value): value is number => value != null && value > 100);
  if (tirePressures.length > 0) {
    const avgPressure = tirePressures.reduce((sum, value) => sum + value, 0) / tirePressures.length;
    if (avgPressure < 220) factor += 0.05;
  }

  return clamp(factor, 0.9, 1.45);
}

export function averageTripConsumption(trips: BydmateTripRow[]) {
  let weightedConsumption = 0;
  let weightedDistance = 0;
  let sampleConsumption = 0;
  let sampleCount = 0;

  for (const trip of trips) {
    const consumption = trip.avg_consumption_kwh_100km;
    if (consumption == null) continue;

    sampleConsumption += consumption;
    sampleCount += 1;

    const distance = trip.distance_km;
    if (distance != null && distance > 0) {
      weightedConsumption += consumption * distance;
      weightedDistance += distance;
    }
  }

  if (weightedDistance > 0) return weightedConsumption / weightedDistance;
  return sampleCount > 0 ? sampleConsumption / sampleCount : null;
}

function averageEnergyConsumption(
  trips: BydmateTripRow[],
): { value: number; totalDistanceKm: number } | null {
  let weightedConsumption = 0;
  let totalDistance = 0;

  for (const trip of trips) {
    const regen = validNumber(trip.regen_energy_kwh);
    const traction = validNumber(trip.traction_energy_kwh);
    const distance = validNumber(trip.distance_km);
    if (regen == null || traction == null || distance == null || distance < 1) continue;

    const netEnergy = traction - regen;
    if (netEnergy <= 0) continue;

    const consumption = (netEnergy / distance) * 100;
    if (
      consumption < MIN_FORECAST_CONSUMPTION_KWH_100KM ||
      consumption > MAX_FORECAST_CONSUMPTION_KWH_100KM
    ) continue;

    weightedConsumption += consumption * distance;
    totalDistance += distance;
  }

  if (totalDistance <= 0) return null;
  return { value: weightedConsumption / totalDistance, totalDistanceKm: totalDistance };
}
