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

export type DashboardDevSnapshotMode =
  | "live"
  | "park"
  | "charge"
  | "stale"
  | "nodata";

/** How far back the `stale` fixture's last contact is, well past LIVE_SNAPSHOT_STALE_MS. */
const STALE_FIXTURE_AGE_MS = 47 * 60_000;

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
  if (value === "stale") return "stale";
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
      // "No data" must mean exactly that: no snapshot. It used to return the parked
      // fixture, so the mode rendered as "Parking" with a live SOC — the opposite of
      // what it claimed to test.
      if (mode === "nodata") return null;
      if (mode === "park") return buildParkedSnapshot(seed);
      if (mode === "stale") {
        // The car reported, then went quiet: a real snapshot whose last contact is old
        // enough to fall outside the freshness window. The dashboard should keep its
        // last known SOC and say how long ago that was.
        const parked = buildParkedSnapshot(seed);
        const seenAt = new Date(Date.now() - STALE_FIXTURE_AGE_MS).toISOString();
        return {
          ...parked,
          received_at: seenAt,
          updated_at: seenAt,
          device_time: seenAt,
        };
      }
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
  // `nodata` deliberately resolves to null — don't let the `?? base` fallback below
  // hand the real snapshot back and defeat the mode.
  if (ctx.mode === "nodata") return null;
  return ctx.resolveOverride(base) ?? base;
}
