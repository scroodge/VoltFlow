"use client";

import { useQuery } from "@tanstack/react-query";
import { BatteryCharging } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChargingSessionScreen } from "@/components/charging/charging-session-screen";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { useTranslation } from "@/hooks/use-translation";
import { usePageVisible } from "@/hooks/use-page-visible";
import { chargingSessionsRefetchInterval, fetchSessions } from "@/hooks/use-sessions-query";
import {
  deriveDashboardVehicleMode,
  resolveLiveSnapshotForVehicle,
} from "@/lib/vehicle-live-mode";
import { useAppPreferences } from "@/stores/use-app-preferences";
import { DEV_MOCK_CHARGING_SESSION_ID } from "@/lib/dev/build-mock-charging-session";
import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { useAppPath } from "@/lib/dev/dev-path";
import { formatDuration } from "@/lib/charging-math";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { ChargingSessionRow } from "@/types/database";

function sessionDuration(session: ChargingSessionRow): string {
  const startedMs = session.started_at ? Date.parse(session.started_at) : null;
  const stoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : null;
  if (startedMs == null || stoppedMs == null) return "—";
  return formatDuration(Math.max(0, Math.round((stoppedMs - startedMs) / 1000)));
}

function sessionDate(session: ChargingSessionRow, locale: string): string {
  const iso = session.started_at ?? session.created_at;
  if (!iso) return "—";
  const code = locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
  return new Date(iso).toLocaleDateString(code, { day: "numeric", month: "short", year: "numeric" });
}

export function ChargingHubView() {
  const router = useRouter();
  const appPath = useAppPath();
  const { locale, t } = useTranslation();
  const pageVisible = usePageVisible();
  const { data: sessions, isLoading } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessions,
    // Shared cadence — see chargingSessionsRefetchInterval. Was a flat 5s; now
    // tiered + visibility-gated so all queryKeys.sessions observers agree.
    refetchInterval: (query) =>
      chargingSessionsRefetchInterval(
        query.state.data as ChargingSessionRow[] | undefined,
        pageVisible,
      ),
  });
  const { data: liveRows = [] } = useBydmateLiveQuery();
  const { data: carsResult } = useCarsQuery();
  const selectedCarId = useAppPreferences((s) => s.selectedCarId);
  const nowMs = useSyncExternalStore(
    () => () => {},
    () => Date.now(),
    () => 0,
  );
  const scopedVehicleId = useMemo(() => {
    const cars = carsResult?.cars;
    const car =
      cars?.find((c) => c.id === selectedCarId) ??
      cars?.find((c) => c.id === carsResult?.preferredCarId) ??
      cars?.[0] ??
      null;
    return car?.vehicle_alias ?? null;
  }, [carsResult, selectedCarId]);
  const mateVehicleMode = useMemo(() => {
    const snapshot = resolveLiveSnapshotForVehicle(liveRows, scopedVehicleId);
    return deriveDashboardVehicleMode({
      snapshot,
      nowMs,
      hasActiveSession: false,
    });
  }, [liveRows, scopedVehicleId, nowMs]);

  const active = useMemo(
    () => sessions?.find((s) => s.status === "charging"),
    [sessions],
  );

  // Redirect straight to the live session detail when charging is in progress
  useEffect(() => {
    if (active?.id) {
      router.replace(appPath(`/charging/${active.id}`));
    }
  }, [active, appPath, router]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6">
        <Skeleton className="h-10 w-3/5 self-center rounded-xl" />
        <Skeleton className="h-[120px] w-full rounded-[2rem]" />
        <Skeleton className="h-14 rounded-full" />
      </div>
    );
  }

  // Transitional state — redirect in flight
  if (active) {
    return (
      <div className="flex flex-1 flex-col items-center gap-12 px-6 py-36 text-lg text-muted-foreground">
        <p>{t("charging.syncing")}</p>
        <Button asChild variant="outline" size="lg" className="h-[52px] rounded-full px-12">
          <Link href={appPath(`/charging/${active.id}`)}>{t("charging.redirectStalls")}</Link>
        </Button>
      </div>
    );
  }

  if (isDevAppRoute()) {
    return <ChargingSessionScreen sessionId={DEV_MOCK_CHARGING_SESSION_ID} />;
  }

  // Idle state — no active session
  const latestSession = sessions?.[0] ?? null;
  const hasHistory = (sessions?.length ?? 0) > 0;

  return (
    <div className="flex flex-1 flex-col gap-5 p-4">
      {/* Header */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("charging.hubEyebrow")}
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-normal">
          {t("nav.charge")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("charging.idle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {mateVehicleMode === "stale"
            ? (t("charging.hubNoMate") as string)
            : (t("charging.hubMateLive") as string)}
        </p>
      </div>

      {/* Latest session card or empty-state hint */}
      {latestSession ? (
        <Link
          href={appPath(`/history/${latestSession.id}`)}
          className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-border bg-white/[0.03] p-4 transition hover:border-primary/50 hover:bg-white/[0.05]"
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("dashboard.latestCharge")}
            </span>
            <span className="block font-heading text-lg font-bold tracking-normal text-foreground">
              {`${latestSession.start_percent.toFixed(0)}% → ${latestSession.current_percent.toFixed(0)}%`}
            </span>
            <span className="mt-1 block text-sm leading-5 text-muted-foreground">
              {sessionDate(latestSession, locale)}
              {" · "}
              {sessionDuration(latestSession)}
            </span>
            {latestSession.charged_energy_kwh != null ? (
              <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">
                {`${latestSession.charged_energy_kwh.toFixed(2)} kWh`}
              </span>
            ) : null}
          </span>
          <BatteryCharging className="size-5 shrink-0 text-[var(--voltflow-cyan)]" aria-hidden />
        </Link>
      ) : (
        <div className={cn(
          "rounded-2xl border border-dashed border-border p-6 text-center",
        )}>
          <p className="text-sm text-muted-foreground">{t("charging.idleBody")}</p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto space-y-3">
        <Button
          asChild
          size="lg"
          className="h-[52px] w-full rounded-full bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] font-heading text-base font-bold text-[#06110B]"
        >
          <Link href={appPath("/dashboard")}>{t("charging.backCockpit")}</Link>
        </Button>
        {hasHistory && (
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-11 w-full rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
          >
            <Link href={appPath("/history")}>{t("history.title")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
