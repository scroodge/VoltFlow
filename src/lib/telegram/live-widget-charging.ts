import {
  energyFromGridKwh,
  energyNeededKwh,
  resolveChargingEtaPowerKw,
} from "../../features/charging/_domain/charging-math.ts";

export type TelegramActiveChargingSession = {
  car_id: string;
  start_percent: number;
  target_percent: number;
  battery_capacity_kwh: number;
  efficiency_percent: number;
  tariff_type: string;
  started_at: string | null;
  created_at: string;
};

function positiveFinite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function sessionSortMs(session: TelegramActiveChargingSession): number {
  const startedMs = session.started_at ? Date.parse(session.started_at) : Number.NaN;
  if (Number.isFinite(startedMs)) return startedMs;
  const createdMs = Date.parse(session.created_at);
  return Number.isFinite(createdMs) ? createdMs : 0;
}

export function newestActiveSessionByCar(
  sessions: TelegramActiveChargingSession[],
): Map<string, TelegramActiveChargingSession> {
  const map = new Map<string, TelegramActiveChargingSession>();
  for (const session of sessions) {
    const current = map.get(session.car_id);
    if (!current || sessionSortMs(session) > sessionSortMs(current)) {
      map.set(session.car_id, session);
    }
  }
  return map;
}

export function resolveTelegramChargingMetrics({
  soc,
  rawChargePowerKw,
  defaultChargePowerKw,
  batteryCapacityKwh,
  chargeType,
  session,
  nowMs,
}: {
  soc: number | null;
  rawChargePowerKw: number | null;
  defaultChargePowerKw: number | null;
  batteryCapacityKwh: number | null;
  chargeType: string | null | undefined;
  session: TelegramActiveChargingSession | null;
  nowMs: number;
}): { chargePowerKw: number | null; timeToFullHours: number | null } {
  const fallbackPowerKw =
    positiveFinite(rawChargePowerKw) ?? positiveFinite(defaultChargePowerKw);

  if (soc == null || soc >= 100) {
    return { chargePowerKw: fallbackPowerKw, timeToFullHours: null };
  }

  if (!session) {
    const capacity = positiveFinite(batteryCapacityKwh);
    return {
      chargePowerKw: fallbackPowerKw,
      timeToFullHours:
        capacity != null && fallbackPowerKw != null
          ? energyNeededKwh(capacity, soc, 100) / fallbackPowerKw
          : null,
    };
  }

  const capacity = positiveFinite(session.battery_capacity_kwh);
  const efficiency = positiveFinite(session.efficiency_percent);
  if (capacity == null || efficiency == null) {
    return { chargePowerKw: fallbackPowerKw, timeToFullHours: null };
  }

  const currentSoc = Math.min(100, Math.max(session.start_percent, soc));
  const chargedGridEnergyKwh = energyFromGridKwh(
    energyNeededKwh(capacity, session.start_percent, currentSoc),
    efficiency,
  );
  const startedMs = session.started_at ? Date.parse(session.started_at) : Number.NaN;
  const elapsedSeconds = Number.isFinite(startedMs) ? Math.max(0, (nowMs - startedMs) / 1000) : 0;
  const chargePowerKw = resolveChargingEtaPowerKw({
    freshLivePowerKw: rawChargePowerKw,
    chargedGridEnergyKwh,
    elapsedSeconds,
    socGainPercent: currentSoc - session.start_percent,
    fallbackPowerKw,
    isDc: session.tariff_type === "fast_dc" || chargeType?.toUpperCase() === "DC",
  });
  const remainingGridEnergyKwh = energyFromGridKwh(
    energyNeededKwh(capacity, currentSoc, 100),
    efficiency,
  );

  return {
    chargePowerKw,
    timeToFullHours:
      chargePowerKw != null && chargePowerKw > 0
        ? remainingGridEnergyKwh / chargePowerKw
        : null,
  };
}
