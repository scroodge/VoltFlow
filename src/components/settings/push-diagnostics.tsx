"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";

import { sendTestPush } from "@/actions/push";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/hooks/use-translation";
import {
  ensureNotificationsPermission,
  ensurePushSubscription,
  getPushClientStatus,
  showLocalTestNotification,
} from "@/lib/push/client";

type PushStatus = Awaited<ReturnType<typeof getPushClientStatus>>;

export function PushDiagnostics() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    void getPushClientStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSync = async () => {
    setBusy("sync");
    try {
      await ensureNotificationsPermission();
      await ensurePushSubscription();
      refresh();
      toast.success(t("settings.push.refreshed") as string);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : (t("settings.push.syncError") as string),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleLocalTest = async () => {
    setBusy("local");
    try {
      const result = await showLocalTestNotification();
      if (!result.ok) throw new Error(result.error);
      toast.success(t("settings.push.localRequested") as string);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : (t("settings.push.localError") as string),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleServerTest = async () => {
    setBusy("server");
    try {
      await ensurePushSubscription();
      const result = await sendTestPush();
      if (!result.ok) throw new Error(result.error);
      toast.success(
        t("settings.push.serverSent", { count: result.sent ?? 0 }) as string,
      );
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : (t("settings.push.serverError") as string),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-5" aria-hidden />
          {t("settings.push.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <PushStatusRow
            label={t("settings.push.supported") as string}
            value={
              (status?.supported
                ? t("settings.push.yes")
                : t("settings.push.no")) as string
            }
          />
          <PushStatusRow
            label={t("settings.push.permission") as string}
            value={
              status?.permission ?? (t("settings.push.checking") as string)
            }
          />
          <PushStatusRow
            label={t("settings.push.serviceWorker") as string}
            value={
              status?.serviceWorker ?? (t("settings.push.checking") as string)
            }
          />
          <PushStatusRow
            label={t("settings.push.subscription") as string}
            value={
              (status?.hasSubscription
                ? t("settings.push.savedOnDevice")
                : t("settings.push.missing")) as string
            }
          />
          <PushStatusRow
            label={t("settings.push.endpoint") as string}
            value={status?.endpointHost ?? (t("settings.push.none") as string)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 rounded-full text-sm"
            disabled={busy !== null}
            onClick={handleSync}
          >
            {busy === "sync"
              ? t("settings.push.checkingBtn")
              : t("settings.push.checkBtn")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 rounded-full text-sm"
            disabled={busy !== null}
            onClick={handleLocalTest}
          >
            {busy === "local"
              ? t("settings.push.sendingBtn")
              : t("settings.push.localBtn")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 rounded-full text-sm"
            disabled={busy !== null}
            onClick={handleServerTest}
          >
            {busy === "server"
              ? t("settings.push.sendingBtn")
              : t("settings.push.serverBtn")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PushStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
        {label}
      </p>
      <p className="mt-2 break-words font-mono text-sm">{value}</p>
    </div>
  );
}
