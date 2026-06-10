import type { SupabaseClient } from "@supabase/supabase-js";

import type { AcceptedTelemetry } from "@/lib/bydmate/telemetry-sanitizer";
import type { TelemetryPayload } from "@/lib/bydmate/ingest-payload";
import {
  finiteTelemetryNumber,
  isTelemetryCharging,
} from "@/lib/bydmate/telemetry-charging";
import {
  nextChargeNotificationState,
  type ChargeNotificationState,
} from "@/lib/push/charge-thresholds";
import { sendPushToUser } from "@/lib/push/web-push";

type ChargeNotificationStateRow = {
  user_id: string;
  vehicle_id: string;
  charge_started_at: string | null;
  last_device_time: string | null;
  last_soc: number | string | null;
  last_is_charging: boolean | null;
  notified_thresholds: number[] | null;
};

function stateFromRow(row: ChargeNotificationStateRow): ChargeNotificationState {
  return {
    chargeStartedAt: row.charge_started_at,
    lastSoc: finiteTelemetryNumber(row.last_soc),
    lastIsCharging: row.last_is_charging === true,
    notifiedThresholds: Array.isArray(row.notified_thresholds) ? row.notified_thresholds : [],
  };
}

function stateToRow(
  userId: string,
  vehicleId: string,
  deviceTime: string,
  state: ChargeNotificationState,
) {
  return {
    user_id: userId,
    vehicle_id: vehicleId,
    charge_started_at: state.chargeStartedAt,
    last_device_time: deviceTime,
    last_soc: state.lastSoc,
    last_is_charging: state.lastIsCharging,
    notified_thresholds: state.notifiedThresholds,
  };
}

function notificationPayload(vehicleId: string, threshold: number, chargeStartedAt: string | null) {
  return {
    title: `Charging: ${threshold}%`,
    body:
      threshold === 100
        ? "Battery reached 100% while charging."
        : threshold === 95
        ? "Battery reached 95% while charging."
        : `Battery reached ${threshold}% while charging.`,
    url: "/vehicle",
    tag: `bydmate-charge:${vehicleId}:${threshold}:${chargeStartedAt ?? "active"}`,
  };
}

export async function processBydmateChargeNotifications({
  supabase,
  userId,
  samples,
  previousTelemetry,
}: {
  supabase: SupabaseClient;
  userId: string;
  samples: TelemetryPayload[];
  previousTelemetry: Map<string, AcceptedTelemetry>;
}) {
  const vehicleIds = Array.from(new Set(samples.map((sample) => sample.vehicle_id)));
  if (!vehicleIds.length) return { sent: 0, thresholds: [] as number[] };

  const { data: rows, error } = await supabase
    .from("bydmate_charge_notification_state")
    .select(
      "user_id,vehicle_id,charge_started_at,last_device_time,last_soc,last_is_charging,notified_thresholds",
    )
    .eq("user_id", userId)
    .in("vehicle_id", vehicleIds);

  if (error) throw new Error(error.message);

  const states = new Map<string, ChargeNotificationState>();
  for (const row of (rows ?? []) as ChargeNotificationStateRow[]) {
    states.set(row.vehicle_id, stateFromRow(row));
  }

  let sent = 0;
  const thresholds: number[] = [];
  const orderedSamples = [...samples].sort(
    (a, b) => Date.parse(a.device_time) - Date.parse(b.device_time),
  );

  for (const sample of orderedSamples) {
    const previousState = states.get(sample.vehicle_id) ?? null;
    const result = nextChargeNotificationState({
      previousState,
      currentSoc: finiteTelemetryNumber(sample.telemetry.soc),
      isCharging: isTelemetryCharging(sample.telemetry, sample),
      deviceTime: sample.device_time,
      previousSoc: previousTelemetry.get(sample.vehicle_id)?.telemetry.soc,
    });

    states.set(sample.vehicle_id, result.nextState);

    for (const threshold of result.thresholdsToNotify) {
      thresholds.push(threshold);
      const pushResult = await sendPushToUser(
        supabase,
        userId,
        notificationPayload(sample.vehicle_id, threshold, result.nextState.chargeStartedAt),
      );
      sent += pushResult.sent;
    }
  }

  for (const vehicleId of vehicleIds) {
    const state = states.get(vehicleId);
    if (!state) continue;

    const lastSample = [...orderedSamples].reverse().find((sample) => sample.vehicle_id === vehicleId);
    const deviceTime = lastSample?.device_time ?? new Date().toISOString();

    const { error: upsertError } = await supabase
      .from("bydmate_charge_notification_state")
      .upsert(stateToRow(userId, vehicleId, deviceTime, state), {
        onConflict: "user_id,vehicle_id",
      });

    if (upsertError) throw new Error(upsertError.message);
  }

  return { sent, thresholds };
}
