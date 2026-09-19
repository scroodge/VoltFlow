"use client";

import { ExternalLink, MessageCircle } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProfileQuery } from "@/hooks/use-profile-query";
import { useTranslation } from "@/hooks/use-translation";
import { useUpdateProfile } from "@/hooks/use-update-profile";
import type { TranslationKey } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";
import { telegramApiUrl } from "@/lib/telegram/api-url";
import type { Profile } from "@/types/database";

const notifyChannels = ["web_push", "telegram", "both"] as const;
type NotifyChannel = (typeof notifyChannels)[number];

const liveStatusModes = ["off", "charging", "charging_parked"] as const;
type LiveStatusMode = (typeof liveStatusModes)[number];

function isNotifyChannel(value: unknown): value is NotifyChannel {
  return (
    typeof value === "string" && notifyChannels.includes(value as NotifyChannel)
  );
}

function isLiveStatusMode(value: unknown): value is LiveStatusMode {
  return (
    typeof value === "string" &&
    liveStatusModes.includes(value as LiveStatusMode)
  );
}

export function NotificationSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: profile } = useProfileQuery();
  const updateProfile = useUpdateProfile();
  const [telegramInstructionsOpen, setTelegramInstructionsOpen] =
    useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);

  const telegramId = profile?.telegram_id ?? null;
  const telegramUsername = profile?.telegram_username ?? null;
  const notifyChannel = profile?.notify_channel ?? "web_push";
  const liveStatusMode = profile?.live_status_mode ?? "charging";
  const auxBatteryAlertsEnabled = profile?.aux_battery_alerts_enabled !== false;

  const handleConnectTelegram = async () => {
    const webApp =
      typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    const initData = webApp?.initData ?? "";
    if (!initData) {
      setTelegramInstructionsOpen(true);
      toast.message(t("settings.telegramConnect.openInTelegram") as string);
      return;
    }

    setTelegramBusy(true);
    try {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      const response = await fetch(telegramApiUrl("/api/telegram/link"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(session?.access_token
            ? { authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ initData }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        telegram_id?: number;
        error?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "link_failed");
      }
      const linkedId =
        payload.telegram_id ?? webApp?.initDataUnsafe?.user?.id ?? null;
      const linkedUsername = webApp?.initDataUnsafe?.user?.username ?? null;
      qc.setQueryData<Profile | null>(queryKeys.profile, (current) =>
        current
          ? {
              ...current,
              telegram_id: linkedId,
              telegram_username: linkedUsername,
            }
          : current,
      );
      setTelegramInstructionsOpen(false);
      toast.success(t("settings.telegramConnect.linked") as string);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : String(t("settings.telegramConnect.linkFailed")),
      );
    } finally {
      setTelegramBusy(false);
    }
  };

  const handleNotifyChannelChange = async (value: string | null) => {
    if (!isNotifyChannel(value)) return;
    if ((value === "telegram" || value === "both") && !telegramId) {
      setTelegramInstructionsOpen(true);
      toast.error(t("settings.telegramConnect.connectFirst") as string);
      return;
    }

    const result = await updateProfile({ notify_channel: value });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("settings.telegramConnect.channelSaved") as string);
  };

  const handleLiveStatusModeChange = async (value: string | null) => {
    if (!isLiveStatusMode(value)) return;

    const result = await updateProfile({ live_status_mode: value });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("settings.liveStatus.saved") as string);
  };

  const handleAuxBatteryAlertsChange = async (value: string | null) => {
    if (value !== "enabled" && value !== "disabled") return;

    const result = await updateProfile({
      aux_battery_alerts_enabled: value === "enabled",
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.persisted) {
      toast.success(
        t("settings.telegramConnect.auxBatteryAlertsSaved") as string,
      );
    }
  };

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-5" aria-hidden />
          {t("settings.telegramConnect.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
            {t("settings.telegramConnect.status")}
          </p>
          <p className="mt-2 text-sm font-medium">
            {telegramId
              ? t("settings.telegramConnect.connected", {
                  username: telegramUsername
                    ? `@${telegramUsername}`
                    : String(telegramId),
                })
              : t("settings.telegramConnect.notConnected")}
          </p>
        </div>

        <Button
          type="button"
          variant={telegramId ? "outline" : "secondary"}
          size="lg"
          className="h-11 w-full rounded-full text-sm font-semibold"
          disabled={telegramBusy}
          onClick={() => void handleConnectTelegram()}
        >
          {telegramBusy
            ? t("settings.telegramConnect.connecting")
            : telegramId
              ? t("settings.telegramConnect.reconnect")
              : t("settings.telegramConnect.connect")}
        </Button>

        {telegramInstructionsOpen ? (
          <div className="space-y-3 rounded-2xl border border-[var(--voltflow-cyan)]/25 bg-[var(--voltflow-cyan)]/10 p-4">
            <p className="text-sm font-semibold">
              {t("settings.telegramConnect.instructionsTitle")}
            </p>
            <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {(
                t("settings.telegramConnect.instructions") as readonly string[]
              ).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-11 w-full justify-between rounded-full px-4 text-sm font-semibold"
            >
              <a
                href="https://t.me/Voltflowscr_bot"
                target="_blank"
                rel="noreferrer"
              >
                <span>{t("settings.telegramConnect.openBot")}</span>
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="notify-channel">
            {t("settings.telegramConnect.channelLabel")}
          </Label>
          <Select
            value={notifyChannel}
            onValueChange={(value) => void handleNotifyChannelChange(value)}
            items={notifyChannels.map((channel) => ({
              value: channel,
              label: t(
                `settings.telegramConnect.channels.${channel}` as TranslationKey,
              ) as string,
            }))}
          >
            <SelectTrigger
              id="notify-channel"
              className="h-11 w-full rounded-2xl text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {notifyChannels.map((channel) => (
                <SelectItem key={channel} value={channel}>
                  {t(
                    `settings.telegramConnect.channels.${channel}` as TranslationKey,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            {t("settings.telegramConnect.channelHelp")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="live-status-mode">
            {t("settings.liveStatus.label")}
          </Label>
          <Select
            value={liveStatusMode}
            onValueChange={(value) => void handleLiveStatusModeChange(value)}
            items={liveStatusModes.map((mode) => ({
              value: mode,
              label: t(
                `settings.liveStatus.modes.${mode}` as TranslationKey,
              ) as string,
            }))}
          >
            <SelectTrigger
              id="live-status-mode"
              className="h-11 w-full rounded-2xl text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {liveStatusModes.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`settings.liveStatus.modes.${mode}` as TranslationKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            {t("settings.liveStatus.help")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="aux-battery-alerts">
            {t("settings.telegramConnect.auxBatteryAlertsLabel")}
          </Label>
          <Select
            value={auxBatteryAlertsEnabled ? "enabled" : "disabled"}
            onValueChange={(value) => void handleAuxBatteryAlertsChange(value)}
            items={["enabled", "disabled"].map((value) => ({
              value,
              label: t(
                `settings.telegramConnect.${value}` as TranslationKey,
              ) as string,
            }))}
          >
            <SelectTrigger
              id="aux-battery-alerts"
              className="h-11 w-full rounded-2xl text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="enabled">
                {t("settings.telegramConnect.enabled")}
              </SelectItem>
              <SelectItem value="disabled">
                {t("settings.telegramConnect.disabled")}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            {t("settings.telegramConnect.auxBatteryAlertsHelp")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
