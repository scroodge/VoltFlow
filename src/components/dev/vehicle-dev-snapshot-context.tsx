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
import { getDevPathPrefix } from "@/lib/dev/dev-path";
import type { BydmateLiveSnapshotRow } from "@/types/database";

export type VehicleDevSnapshotMode = "online" | "charging" | "stale";

const STALE_OFFSET_MS = 4 * 60 * 60 * 1000;

type VehicleDevSnapshotContextValue = {
  mode: VehicleDevSnapshotMode;
  setMode: (mode: VehicleDevSnapshotMode) => void;
  resolveOverride: (base: BydmateLiveSnapshotRow | null) => BydmateLiveSnapshotRow | null;
};

const VehicleDevSnapshotContext = createContext<VehicleDevSnapshotContextValue | null>(null);

function parseDevMode(value: string | null): VehicleDevSnapshotMode {
  if (value === "charging" || value === "stale") return value;
  return "online";
}

function useDevAppRouteFromPath() {
  const pathname = usePathname();
  return getDevPathPrefix(pathname) !== "";
}

export function VehicleDevSnapshotProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<VehicleDevSnapshotMode>(() => {
    if (typeof window === "undefined") return "online";
    return parseDevMode(new URLSearchParams(window.location.search).get("devVehicle"));
  });
  const devRoute = useDevAppRouteFromPath();

  const setMode = useCallback((next: VehicleDevSnapshotMode) => {
    setModeState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("devVehicle", next);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const resolveOverride = useCallback(
    (base: BydmateLiveSnapshotRow | null): BydmateLiveSnapshotRow | null => {
      if (!devRoute || !base) return null;

      if (mode === "charging") {
        return buildChargingSnapshot(base);
      }

      if (mode === "stale") {
        const staleTimestamp = new Date(Date.parse(base.received_at) - STALE_OFFSET_MS).toISOString();
        return {
          ...base,
          received_at: staleTimestamp,
          updated_at: staleTimestamp,
        };
      }

      const freshTimestamp = new Date().toISOString();
      return {
        ...base,
        received_at: freshTimestamp,
        updated_at: freshTimestamp,
      };
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
    <VehicleDevSnapshotContext.Provider value={value}>
      {children}
    </VehicleDevSnapshotContext.Provider>
  );
}

export function useVehicleDevSnapshot() {
  return useContext(VehicleDevSnapshotContext);
}

export function useVehicleDevSnapshotOverride(
  base: BydmateLiveSnapshotRow | null,
): BydmateLiveSnapshotRow | null {
  const ctx = useVehicleDevSnapshot();
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!ctx || !base || !hasMounted) return base;
  return ctx.resolveOverride(base) ?? base;
}
