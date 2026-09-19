"use client";

import { usePairedDevicesQuery } from "@/hooks/use-paired-devices-query";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Which VoltFlow Dashboard build is linked to this account.
 *
 * Deliberately not modelled on Mate's version panel: Mate's version rides its
 * telemetry stream, while the Dashboard sends no telemetry and reports its build on the
 * credential row instead. There is also no "latest available" half here — the Dashboard
 * has no published release catalog, so this states what is installed and nothing more.
 */
export function DashboardVersionPanel() {
  const { t, locale } = useTranslation();
  const { data: devices = [] } = usePairedDevicesQuery();

  const dashboard =
    devices.find((device) => device.kind === "dashboard") ?? null;
  const linkedOn = dashboard
    ? new Date(dashboard.created_at).toLocaleDateString(locale)
    : null;

  return (
    <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
      <p className="text-sm font-semibold tracking-tight">
        {t("settings.cloud.dashboardTitle")}
      </p>
      {dashboard ? (
        <>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
              {t("settings.cloud.dashboardVersionLabel")}
            </p>
            <p className="mt-2 font-mono text-sm">
              {dashboard.app_version ??
                t("settings.cloud.dashboardVersionUnknown")}
              {dashboard.app_version && dashboard.version_code != null
                ? ` (${dashboard.version_code})`
                : ""}
            </p>
          </div>
          {linkedOn ? (
            <p className="text-muted-foreground text-sm">
              {t("settings.cloud.dashboardLinkedOn", { date: linkedOn })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("settings.cloud.dashboardNotLinked")}
        </p>
      )}
    </div>
  );
}
