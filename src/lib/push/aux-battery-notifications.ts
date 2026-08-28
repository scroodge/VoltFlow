import type { SupabaseClient } from "@supabase/supabase-js";
import { translate, type Locale, type TranslationKey } from "@/lib/i18n";
import { DEFAULT_SITE_URL } from "@/lib/site-url";
import { sendPushToUser } from "@/lib/push/web-push";
import { sendTelegramMessage } from "@/lib/telegram/bot-send";

type Channel = "web_push" | "telegram" | "both";

export type AuxBatteryNotification = {
  kind: "acute" | "digest";
  vehicleId: string;
  voltage: number;
  baseline: number | null;
};

function copy(locale: Locale, notification: AuxBatteryNotification) {
  const key = `auxBatteryAlerts.${notification.kind}` as TranslationKey;
  const values = { vehicle: notification.vehicleId, voltage: notification.voltage.toFixed(2), baseline: notification.baseline?.toFixed(2) ?? "—" };
  return {
    title: translate(locale, `${key}.title` as TranslationKey, values) as string,
    body: translate(locale, `${key}.body` as TranslationKey, values) as string,
  };
}

export async function sendAuxBatteryNotification({ supabase, userId, channel, telegramId, locale, notification }: {
  supabase: SupabaseClient;
  userId: string;
  channel: Channel;
  telegramId: number | string | null;
  locale: Locale;
  notification: AuxBatteryNotification;
}) {
  const message = copy(locale, notification);
  const payload = { ...message, url: "/vehicle", tag: `bydmate-aux-battery:${notification.vehicleId}:${notification.kind}`, silent: notification.kind === "digest", renotify: notification.kind === "acute" };
  const telegramWanted = (channel === "telegram" || channel === "both") && telegramId != null;
  const webPushWanted = channel === "web_push" || channel === "both" || !telegramWanted;
  let sent = 0;
  if (webPushWanted) sent += (await sendPushToUser(supabase, userId, payload)).sent;
  if (telegramWanted) {
    const result = await sendTelegramMessage(telegramId!, `${message.title}\n${message.body}`, {
      disableNotification: notification.kind === "digest",
      replyMarkup: { inline_keyboard: [[{ text: translate(locale, "auxBatteryAlerts.open") as string, web_app: { url: `${(process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL).replace(/\/$/, "")}/vehicle` } }]] },
    });
    if (result.ok) sent += 1;
  }
  return { sent };
 }
