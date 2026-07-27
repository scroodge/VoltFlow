"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { buildChargingSnapshot } from "@/app/dev/vehicle-telemetry-fixtures/build-charging-snapshot";
import { percentPerSecond, type ChargingParams } from "@/features/charging/domain";
import { getDevPathPrefix } from "@/lib/dev/dev-path";
import type { BydmateLiveSnapshotRow, ChargingSessionRow } from "@/types/database";

export type ChargingDevSourceMode = "math" | "live";

type ChargingDevSourceContextValue = {
  mode: ChargingDevSourceMode;
  setMode: (mode: ChargingDevSourceMode) => void;
  isOverrideActive: boolean;
  resolveLiveSnapshots: (
    base: BydmateLiveSnapshotRow[],
    session: ChargingSessionRow | null | undefined,
    nowMs: number,
  ) => BydmateLiveSnapshotRow[];
};

const ChargingDevSourceContext = createContext<ChargingDevSourceContextValue | null>(
  null,
);

function parseChargeSourceMode(value: string | null): ChargingDevSourceMode {
  return value === "live" ? "live" : "math";
}

function useDevAppRouteFromPath() {
  const pathname = usePathname();
  return getDevPathPrefix(pathname) !== "";
}

function sessionToParams(session: ChargingSessionRow): ChargingParams {
  return {
    startPercent: session.start_percent,
    targetPercent: session.target_percent,
    batteryCapacityKwh: session.battery_capacity_kwh,
    chargerPowerKw: session.charger_power_kw,
    efficiencyPercent: session.efficiency_percent,
    pricePerKwh: session.price_per_kwh,
  };
}

function injectedSocFromSession(
  session: ChargingSessionRow,
  nowMs: number,
): number {
  if (!session.started_at) return session.start_percent;
  const params = sessionToParams(session);
  const startedAtMs = Date.parse(session.started_at);
  const elapsedSeconds = Math.max(0, (nowMs - startedAtMs) / 1000);
  const progress = params.startPercent + percentPerSecond(params) * elapsedSeconds;
  return Math.min(params.targetPercent - 0.5, Math.max(params.startPercent, progress));
}

export function ChargingDevSourceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ChargingDevSourceMode>(() => {
    if (typeof window === "undefined") return "math";
    return parseChargeSourceMode(
      new URLSearchParams(window.location.search).get("devChargeSource"),
    );
  });
  const devRoute = useDevAppRouteFromPath();

  const setMode = useCallback((next: ChargingDevSourceMode) => {
    setModeState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("devChargeSource", next);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const resolveLiveSnapshots = useCallback(
    (
      base: BydmateLiveSnapshotRow[],
      session: ChargingSessionRow | null | undefined,
      nowMs: number,
    ): BydmateLiveSnapshotRow[] => {
      if (!devRoute) return base;
      if (mode === "math") return [];
      const snapshot = base[0];
      if (!snapshot || !session) return base;
      const soc = injectedSocFromSession(session, nowMs);
      const charging = buildChargingSnapshot(snapshot, null);
      return [
        {
          ...charging,
          telemetry: {
            ...charging.telemetry,
            soc,
            speed_kmh: 0,
          },
        },
      ];
    },
    [devRoute, mode],
  );

  const value = useMemo(
    () => ({
      mode,
      setMode,
      isOverrideActive: devRoute,
      resolveLiveSnapshots,
    }),
    [mode, setMode, devRoute, resolveLiveSnapshots],
  );

  if (!devRoute) {
    return <>{children}</>;
  }

  return (
    <ChargingDevSourceContext.Provider value={value}>
      {children}
    </ChargingDevSourceContext.Provider>
  );
}

export function useChargingDevSource() {
  return useContext(ChargingDevSourceContext);
}

export function useChargingDevLiveOverride(
  base: BydmateLiveSnapshotRow[],
  session: ChargingSessionRow | null | undefined,
  nowMs: number,
): BydmateLiveSnapshotRow[] {
  const ctx = useChargingDevSource();
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!ctx || !hasMounted) return base;
  return ctx.resolveLiveSnapshots(base, session, nowMs);
}
