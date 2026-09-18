import { useTranslation } from "@/hooks/use-translation";
import { PremiumBadge } from "../premium/premium-badge";
import { Card, CardContent, CardTitle, CardHeader } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, Trash2, KeyRound, MessageCircle } from "lucide-react";
import { useAppPath } from "@/lib/dev/dev-path";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type TranslationKey } from "@/lib/i18n";

export function UserSettings({
  email,
  handleSignOut,
  deleteAccountOpen,
  deleteAccountText,
  setDeleteAccountText,
  setDeletingAccount,
  clearPrivateBrowserData,
  deleteAccount,
  deletingAccount,
  setDeleteAccountOpen,
  handleAddPassword,
  securityBusy,
  notifyChannel,
  handleNotifyChannelChange,
  telegramId,
  telegramUsername,
  handleConnectTelegram,
  telegramBusy,
  telegramInstructionsOpen,
  liveStatusMode,
  handleLiveStatusModeChange,
  liveStatusModes,
  notifyChannels,
  auxBatteryAlertsEnabled,
  handleAuxBatteryAlertsChange,
}: {
  email: string | null;
  handleSignOut: any;
  deleteAccountOpen: any;
  deleteAccountText: any;
  deleteAccount: any;
  setDeleteAccountText: any;
  setDeletingAccount: any;
  clearPrivateBrowserData: any;
  deletingAccount: any;
  setDeleteAccountOpen: any;
  handleAddPassword: any;
  securityBusy: any;
  notifyChannel: any;
  handleNotifyChannelChange: any;
  telegramId: any;
  telegramUsername: any;
  handleConnectTelegram: any;
  telegramBusy: any;
  telegramInstructionsOpen: any;
  liveStatusMode: any;
  handleLiveStatusModeChange: any;
  liveStatusModes: any;
  notifyChannels: any;
  auxBatteryAlertsEnabled: any;
  handleAuxBatteryAlertsChange: any;
}) {
  const { t } = useTranslation();
  const appPath = useAppPath();
  const router = useRouter();

  return (
    <>
      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("settings.account")}
            <PremiumBadge />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
              {t("settings.email")}
            </p>
            {email === null ? (
              <Skeleton className="mt-2 h-5 w-2/5 rounded-xl" />
            ) : (
              <p className="mt-2 text-sm">{email ?? t("common.unavailable")}</p>
            )}
          </div>

          <Button
            className="h-11 w-full rounded-full text-sm font-semibold"
            variant="outline"
            type="button"
            onClick={() => void handleSignOut()}
          >
            {t("settings.signOut")}
          </Button>

          <div className="border-t border-white/[0.08] pt-3">
            <p className="text-muted-foreground mb-2 text-sm">
              {t("settings.exportRecentBody")}
            </p>
            <Button
              asChild
              variant="secondary"
              className="h-10 w-full rounded-full text-sm"
            >
              <a href={appPath("/api/vehicle/export?format=json")}>
                <ExternalLink className="mr-2 size-4" aria-hidden />
                {t("settings.exportRecent")}
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="size-5 text-destructive" aria-hidden />
            {t("settings.deleteAccount")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            {t("settings.deleteAccountBody")}
          </p>
          {deleteAccountOpen ? (
            <div className="space-y-3">
              <Input
                placeholder={t("settings.deleteAccountConfirm") as string}
                value={deleteAccountText}
                onChange={(e) => setDeleteAccountText(e.target.value)}
                className="h-11 rounded-2xl text-sm"
              />
              <Button
                className="h-11 w-full rounded-full text-sm font-semibold"
                variant="destructive"
                disabled={deleteAccountText !== "DELETE" || deletingAccount}
                onClick={async () => {
                  setDeletingAccount(true);
                  const result = await deleteAccount();
                  setDeletingAccount(false);
                  if (result.ok) {
                    await clearPrivateBrowserData();
                    toast.success(t("settings.deleteAccountDone") as string);
                    router.replace("/login");
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                }}
              >
                {deletingAccount
                  ? t("settings.deleteAccountConfirming")
                  : t("settings.deleteAccount")}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setDeleteAccountOpen(false);
                  setDeleteAccountText("");
                }}
                className="w-full py-1 text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {t("common.cancel") as string}
              </button>
            </div>
          ) : (
            <Button
              className="h-11 w-full rounded-full text-sm font-semibold"
              variant="outline"
              type="button"
              onClick={() => setDeleteAccountOpen(true)}
            >
              {t("settings.deleteAccount")}
            </Button>
          )}
        </CardContent>
      </Card>
      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" aria-hidden />
            {t("settings.security.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("settings.security.body")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 w-full rounded-full text-sm font-semibold"
            disabled={securityBusy || !email}
            onClick={() => void handleAddPassword()}
          >
            {securityBusy
              ? t("settings.security.sending")
              : t("settings.security.addPassword")}
          </Button>
        </CardContent>
      </Card>
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
                  t(
                    "settings.telegramConnect.instructions",
                  ) as readonly string[]
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
              onValueChange={handleNotifyChannelChange}
              items={notifyChannels.map((channel: any) => ({
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
                {notifyChannels.map((channel: any) => (
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
              onValueChange={handleLiveStatusModeChange}
              items={liveStatusModes.map((mode: any) => ({
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
                {liveStatusModes.map((mode: any) => (
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
              onValueChange={handleAuxBatteryAlertsChange}
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
    </>
  );
}
