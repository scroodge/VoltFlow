/** Consecutive parked charging samples before auto-start (≈4s at 1 Hz ingest). */
export const AUTO_CHARGING_MIN_CONSECUTIVE_START_SAMPLES = 4;
/** Consecutive unplug samples before auto-stop while parked. */
export const AUTO_CHARGING_MIN_CONSECUTIVE_UNPLUG_SAMPLES = 2;
/** @deprecated Use START/UNPLUG-specific constants. */
export const AUTO_CHARGING_MIN_CONSECUTIVE_SAMPLES = AUTO_CHARGING_MIN_CONSECUTIVE_START_SAMPLES;
export const AUTO_CHARGING_DRIVE_STOP_SPEED_KMH = 5;
export const AUTO_CHARGING_DEFAULT_TARGET_PERCENT = 100;
/**
 * Parked+charging telemetry arrives at ~1 sample/min, not the ~1 Hz of driving, so the
 * confirmation streak above spans minutes of real charging. The session is therefore
 * backdated to the streak's first charging sample, and further to the last pre-charge
 * (idle) SOC when that reading is no older than this — it covers the telemetry gap while
 * parking and plugging in. Beyond this window the idle reading is ignored: the car may
 * have driven since, and a stale high SOC would under-count the session's energy.
 */
export const AUTO_CHARGING_BACKDATE_MAX_IDLE_GAP_MS = 30 * 60_000;

export type AutoChargingSessionState = {
  consecutiveChargingSamples: number;
  consecutiveUnplugSamples: number;
  lastIsCharging: boolean;
  /** SOC and time of the first charging sample of the current streak. */
  streakStartPercent: number | null;
  streakStartDeviceTime: string | null;
  /** SOC and time of the most recent non-charging sample — the pre-plug-in reading. */
  lastIdlePercent: number | null;
  lastIdleDeviceTime: string | null;
};

export type AutoChargingSessionAction =
  | { type: "none" }
  | { type: "start"; startPercent: number; startedAt: string; chargerPowerKw: number }
  | { type: "stop"; currentPercent: number };

function clampStartPercent(soc: number) {
  return Math.min(99, Math.max(0, Math.round(soc)));
}

/**
 * The SOC and time charging actually began, as opposed to the sample that confirmed it.
 * Prefers the last idle reading (the true pre-charge SOC), falling back to the streak's
 * first charging sample, and finally to the confirming sample itself.
 */
function resolveBackdatedStart({
  state,
  soc,
  deviceTime,
}: {
  state: AutoChargingSessionState;
  soc: number;
  deviceTime: string;
}): { startPercent: number; startedAt: string } {
  const basePercent = state.streakStartPercent ?? soc;
  const startedAt = state.streakStartDeviceTime ?? deviceTime;

  const { lastIdlePercent, lastIdleDeviceTime } = state;
  if (lastIdlePercent == null || lastIdleDeviceTime == null) {
    return { startPercent: clampStartPercent(basePercent), startedAt };
  }

  // An idle SOC above the first charging sample means the car discharged in between;
  // trusting it would inflate the session. Only ever back off to a lower SOC.
  if (lastIdlePercent > basePercent) {
    return { startPercent: clampStartPercent(basePercent), startedAt };
  }

  const gapMs = Date.parse(startedAt) - Date.parse(lastIdleDeviceTime);
  if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs > AUTO_CHARGING_BACKDATE_MAX_IDLE_GAP_MS) {
    return { startPercent: clampStartPercent(basePercent), startedAt };
  }

  return { startPercent: clampStartPercent(lastIdlePercent), startedAt };
}

export function nextAutoChargingSessionStep({
  state,
  isCharging,
  soc,
  speedKmh,
  hasActiveSession,
  chargerPowerKw,
  deviceTime,
}: {
  state: AutoChargingSessionState | null;
  isCharging: boolean;
  soc: number | null;
  speedKmh: number | null;
  hasActiveSession: boolean;
  chargerPowerKw: number | null;
  deviceTime: string;
}): { state: AutoChargingSessionState; action: AutoChargingSessionAction } {
  const prev: AutoChargingSessionState = state ?? {
    consecutiveChargingSamples: 0,
    consecutiveUnplugSamples: 0,
    lastIsCharging: false,
    streakStartPercent: null,
    streakStartDeviceTime: null,
    lastIdlePercent: null,
    lastIdleDeviceTime: null,
  };

  const idle =
    soc != null
      ? { lastIdlePercent: soc, lastIdleDeviceTime: deviceTime }
      : { lastIdlePercent: prev.lastIdlePercent, lastIdleDeviceTime: prev.lastIdleDeviceTime };
  // Charging samples carry the idle reading unchanged: the pre-charge SOC must never be
  // overwritten with one taken while the battery is already filling.
  const carriedIdle = {
    lastIdlePercent: prev.lastIdlePercent,
    lastIdleDeviceTime: prev.lastIdleDeviceTime,
  };
  const noStreak = { streakStartPercent: null, streakStartDeviceTime: null };

  if (hasActiveSession) {
    const drivingAway = speedKmh != null && speedKmh > AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
    if (!isCharging) {
      const consecutiveUnplugSamples = prev.consecutiveUnplugSamples + 1;
      const shouldStop =
        drivingAway ||
        consecutiveUnplugSamples >= AUTO_CHARGING_MIN_CONSECUTIVE_UNPLUG_SAMPLES;
      if (shouldStop && soc != null) {
        return {
          state: {
            consecutiveChargingSamples: 0,
            consecutiveUnplugSamples: 0,
            lastIsCharging: false,
            ...noStreak,
            ...idle,
          },
          action: { type: "stop", currentPercent: soc },
        };
      }
      return {
        state: {
          consecutiveChargingSamples: 0,
          consecutiveUnplugSamples: consecutiveUnplugSamples,
          lastIsCharging: false,
          ...noStreak,
          ...idle,
        },
        action: { type: "none" },
      };
    }

    return {
      state: {
        consecutiveChargingSamples: 0,
        consecutiveUnplugSamples: 0,
        lastIsCharging: true,
        ...noStreak,
        ...carriedIdle,
      },
      action: { type: "none" },
    };
  }

  const drivingAway = speedKmh != null && speedKmh > AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
  if (!isCharging || drivingAway) {
    return {
      state: {
        consecutiveChargingSamples: 0,
        consecutiveUnplugSamples: 0,
        lastIsCharging: false,
        ...noStreak,
        ...idle,
      },
      action: { type: "none" },
    };
  }

  const consecutiveChargingSamples = prev.consecutiveChargingSamples + 1;
  const streakStart =
    prev.consecutiveChargingSamples === 0
      ? { streakStartPercent: soc, streakStartDeviceTime: deviceTime }
      : {
          streakStartPercent: prev.streakStartPercent,
          streakStartDeviceTime: prev.streakStartDeviceTime,
        };

  if (
    consecutiveChargingSamples >= AUTO_CHARGING_MIN_CONSECUTIVE_START_SAMPLES &&
    soc != null &&
    soc < AUTO_CHARGING_DEFAULT_TARGET_PERCENT
  ) {
    const { startPercent, startedAt } = resolveBackdatedStart({
      state: { ...prev, ...streakStart },
      soc,
      deviceTime,
    });
    return {
      state: {
        consecutiveChargingSamples,
        consecutiveUnplugSamples: 0,
        lastIsCharging: true,
        ...noStreak,
        lastIdlePercent: null,
        lastIdleDeviceTime: null,
      },
      action: {
        type: "start",
        startPercent,
        startedAt,
        chargerPowerKw: chargerPowerKw ?? 7.2,
      },
    };
  }

  return {
    state: {
      consecutiveChargingSamples,
      consecutiveUnplugSamples: 0,
      lastIsCharging: true,
      ...streakStart,
      ...carriedIdle,
    },
    action: { type: "none" },
  };
}
