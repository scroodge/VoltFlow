export const AUTO_CHARGING_MIN_CONSECUTIVE_SAMPLES = 2;
export const AUTO_CHARGING_DRIVE_STOP_SPEED_KMH = 5;
export const AUTO_CHARGING_DEFAULT_TARGET_PERCENT = 100;

export type AutoChargingSessionState = {
  consecutiveChargingSamples: number;
  consecutiveUnplugSamples: number;
  lastIsCharging: boolean;
};

export type AutoChargingSessionAction =
  | { type: "none" }
  | { type: "start"; startPercent: number; chargerPowerKw: number }
  | { type: "stop"; currentPercent: number };

function clampStartPercent(soc: number) {
  return Math.min(99, Math.max(0, Math.round(soc)));
}

export function nextAutoChargingSessionStep({
  state,
  isCharging,
  soc,
  speedKmh,
  hasActiveSession,
  chargerPowerKw,
}: {
  state: AutoChargingSessionState | null;
  isCharging: boolean;
  soc: number | null;
  speedKmh: number | null;
  hasActiveSession: boolean;
  chargerPowerKw: number | null;
}): { state: AutoChargingSessionState; action: AutoChargingSessionAction } {
  const prev = state ?? {
    consecutiveChargingSamples: 0,
    consecutiveUnplugSamples: 0,
    lastIsCharging: false,
  };

  if (hasActiveSession) {
    const drivingAway = speedKmh != null && speedKmh > AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
    if (!isCharging) {
      const consecutiveUnplugSamples = prev.consecutiveUnplugSamples + 1;
      const shouldStop =
        drivingAway ||
        consecutiveUnplugSamples >= AUTO_CHARGING_MIN_CONSECUTIVE_SAMPLES;
      if (shouldStop && soc != null) {
        return {
          state: {
            consecutiveChargingSamples: 0,
            consecutiveUnplugSamples: 0,
            lastIsCharging: false,
          },
          action: { type: "stop", currentPercent: soc },
        };
      }
      return {
        state: {
          consecutiveChargingSamples: 0,
          consecutiveUnplugSamples: consecutiveUnplugSamples,
          lastIsCharging: false,
        },
        action: { type: "none" },
      };
    }

    return {
      state: {
        consecutiveChargingSamples: 0,
        consecutiveUnplugSamples: 0,
        lastIsCharging: true,
      },
      action: { type: "none" },
    };
  }

  if (!isCharging) {
    return {
      state: {
        consecutiveChargingSamples: 0,
        consecutiveUnplugSamples: 0,
        lastIsCharging: false,
      },
      action: { type: "none" },
    };
  }

  const consecutiveChargingSamples = prev.consecutiveChargingSamples + 1;
  if (
    consecutiveChargingSamples >= AUTO_CHARGING_MIN_CONSECUTIVE_SAMPLES &&
    soc != null &&
    soc < AUTO_CHARGING_DEFAULT_TARGET_PERCENT
  ) {
    return {
      state: {
        consecutiveChargingSamples,
        consecutiveUnplugSamples: 0,
        lastIsCharging: true,
      },
      action: {
        type: "start",
        startPercent: clampStartPercent(soc),
        chargerPowerKw: chargerPowerKw ?? 7.2,
      },
    };
  }

  return {
    state: {
      consecutiveChargingSamples,
      consecutiveUnplugSamples: 0,
      lastIsCharging: true,
    },
    action: { type: "none" },
  };
}
