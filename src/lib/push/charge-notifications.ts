import type { SupabaseClient } from "@supabase/supabase-js";

import type { AcceptedTelemetry } from "@/lib/bydmate/telemetry-sanitizer";
import type { TelemetryPayload } from "@/lib/bydmate/ingest-payload";
import { latestDeviceTimeByVehicle } from "@/lib/bydmate/latest-sample";
import { DEFAULT_SITE_URL } from "@/lib/site-url";
import {
  finiteTelemetryNumber,
  isTelemetryCharging,
} from "@/lib/bydmate/telemetry-charging";
import {
  nextChargeNotificationState,
  type ChargeNotificationState,
} from "@/lib/push/charge-thresholds";
import { sendPushToUser } from "@/lib/push/web-push";
import { sendTelegramMessage } from "@/lib/telegram/bot-send";

type NotifyChannel = "web_push" | "telegram" | "both";

type ChargeNotificationStateRow = {
  user_id: string;
  vehicle_id: string;
  charge_started_at: string | null;
  last_device_time: string | null;
  last_soc: number | string | null;
  last_is_charging: boolean | null;
  notified_thresholds: number[] | null;
};

type NotificationProfile = {
  telegram_id: number | string | null;
  notify_channel: string | null;
};

type ChargeNotificationPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

function stateFromRow(row: ChargeNotificationStateRow): ChargeNotificationState {
  return {
    chargeStartedAt: row.charge_started_at,
    lastSoc: finiteTelemetryNumber(row.last_soc),
    lastIsCharging: row.last_is_charging === true,
    notifiedThresholds: Array.isArray(row.notified_thresholds) ? row.notified_thresholds : [],
  };
}

function normalizeNotifyChannel(value: string | null | undefined): NotifyChannel {
  return value === "telegram" || value === "both" ? value : "web_push";
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

function notificationPayload(
  vehicleId: string,
  threshold: number,
  chargeStartedAt: string | null,
): ChargeNotificationPayload {
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

function telegramNotificationText(payload: ChargeNotificationPayload) {
  return `${payload.title}\n${payload.body}`;
}

async function loadNotificationProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("telegram_id,notify_channel")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const profile = data as NotificationProfile | null;
  const channel = normalizeNotifyChannel(profile?.notify_channel);
  const telegramId = profile?.telegram_id ?? null;

  return {
    channel,
    telegramId,
  };
}

async function sendChargeNotificationToUser({
  supabase,
  userId,
  payload,
  channel,
  telegramId,
}: {
  supabase: SupabaseClient;
  userId: string;
  payload: ChargeNotificationPayload;
  channel: NotifyChannel;
  telegramId: number | string | null;
}) {
  const shouldSendTelegram = (channel === "telegram" || channel === "both") && telegramId != null;
  const shouldSendWebPush = channel === "web_push" || channel === "both" || !shouldSendTelegram;

  let sent = 0;

  if (shouldSendWebPush) {
    const pushResult = await sendPushToUser(supabase, userId, payload);
    sent += pushResult.sent;
  }

  if (shouldSendTelegram) {
    const telegramResult = await sendTelegramMessage(
      telegramId,
      telegramNotificationText(payload),
      {
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: "Открыть VoltFlow",
                web_app: {
                  url: withPath(process.env.NEXT_PUBLIC_SITE_URL, payload.url),
                },
              },
            ],
          ],
        },
      },
    );
    if (telegramResult.ok) sent += 1;
  }

  return { sent };
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

  const notificationProfile = await loadNotificationProfile(supabase, userId);

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
  const latestDeviceTimes = latestDeviceTimeByVehicle(orderedSamples);

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
      const deliveryResult = await sendChargeNotificationToUser({
        supabase,
        userId,
        payload: notificationPayload(sample.vehicle_id, threshold, result.nextState.chargeStartedAt),
        channel: notificationProfile.channel,
        telegramId: notificationProfile.telegramId,
      });
      sent += deliveryResult.sent;
    }
  }

  for (const vehicleId of vehicleIds) {
    const state = states.get(vehicleId);
    if (!state) continue;
    const deviceTime = latestDeviceTimes.get(vehicleId) ?? new Date().toISOString();
    const { error: upsertError } = await supabase
      .from("bydmate_charge_notification_state")
      .upsert(stateToRow(userId, vehicleId, deviceTime, state), {
        onConflict: "user_id,vehicle_id",
      });

    if (upsertError) throw new Error(upsertError.message);
  }

  return { sent, thresholds };
}

function withPath(base: string | undefined, path: string) {
  return `${(base ?? DEFAULT_SITE_URL).replace(/\/$/, "")}${path}`;
}
