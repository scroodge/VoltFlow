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
import {
  buildDevDashboardSeedSnapshot,
  buildDrivingSnapshot,
  buildParkedSnapshot,
} from "@/lib/dev/build-driving-snapshot";
import { getDevPathPrefix } from "@/lib/dev/dev-path";
import type { BydmateLiveSnapshotRow } from "@/types/database";

export type DashboardDevSnapshotMode = "live" | "park" | "charge" | "nodata";

type DashboardDevSnapshotContextValue = {
  mode: DashboardDevSnapshotMode;
  setMode: (mode: DashboardDevSnapshotMode) => void;
  resolveOverride: (base: BydmateLiveSnapshotRow | null) => BydmateLiveSnapshotRow | null;
};

const DashboardDevSnapshotContext = createContext<DashboardDevSnapshotContextValue | null>(
  null,
);

function parseDevMode(value: string | null): DashboardDevSnapshotMode {
  if (value === "park") return "park";
  if (value === "charge") return "charge";
  if (value === "nodata") return "nodata";
  return "live";
}

function useDevAppRouteFromPath() {
  const pathname = usePathname();
  return getDevPathPrefix(pathname) !== "";
}

export function DashboardDevSnapshotProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DashboardDevSnapshotMode>(() => {
    if (typeof window === "undefined") return "live";
    return parseDevMode(new URLSearchParams(window.location.search).get("devSnapshot"));
  });
  const devRoute = useDevAppRouteFromPath();

  const setMode = useCallback((next: DashboardDevSnapshotMode) => {
    setModeState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("devSnapshot", next);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const resolveOverride = useCallback(
    (base: BydmateLiveSnapshotRow | null): BydmateLiveSnapshotRow | null => {
      if (!devRoute) return null;
      const seed = base ?? buildDevDashboardSeedSnapshot();
      if (mode === "charge") {
        const charging = buildChargingSnapshot(seed, null);
        return {
          ...charging,
          telemetry: {
            ...charging.telemetry,
            speed_kmh: 0,
          },
        };
      }
      if (mode === "park" || mode === "nodata") return buildParkedSnapshot(seed);
      return buildDrivingSnapshot(seed);
    },
    [devRoute, mode],
  );

  const value = useMemo(
    () => ({ mode, setMode, resolveOverride }),
    [mode, setMode, resolveOverride],
  );

  if (!devRoute) {
    return <>{children}</>;
  }

  return (
    <DashboardDevSnapshotContext.Provider value={value}>
      {children}
    </DashboardDevSnapshotContext.Provider>
  );
}

export function useDashboardDevSnapshot() {
  return useContext(DashboardDevSnapshotContext);
}

export function useDashboardDevSnapshotOverride(
  base: BydmateLiveSnapshotRow | null,
): BydmateLiveSnapshotRow | null {
  const ctx = useDashboardDevSnapshot();
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!ctx || !hasMounted) return base;
  return ctx.resolveOverride(base) ?? base;
}
