"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import {
  buildChargingSnapshot,
  type ChargingSampleRef,
} from "@/app/dev/vehicle-telemetry-fixtures/build-charging-snapshot";
import { BottomNavigation } from "@/components/layout/BottomNavigation";
import { VehicleLiveFixtureView } from "@/components/vehicle/vehicle-live-view";
import type { BydmateLiveSnapshotRow, BydmateTelemetryPointRow } from "@/types/database";

const STALE_OFFSET_MS = 4 * 60 * 60 * 1000;
const MODES = ["online", "charging", "stale"] as const;
type FixtureMode = (typeof MODES)[number];

export function VehicleFixtureModeSwitch({
  snapshot,
  points,
  vehicleId,
  chargingSample = null,
}: {
  snapshot: BydmateLiveSnapshotRow;
  points: BydmateTelemetryPointRow[];
  vehicleId: string;
  chargingSample?: ChargingSampleRef | null;
}) {
  const [mode, setMode] = useState<FixtureMode>("online");
  const displayedSnapshot = useMemo(() => {
    if (mode === "online") return snapshot;
    if (mode === "charging") return buildChargingSnapshot(snapshot, chargingSample);

    const staleTimestamp = new Date(Date.parse(snapshot.received_at) - STALE_OFFSET_MS).toISOString();
    return {
      ...snapshot,
      received_at: staleTimestamp,
      updated_at: staleTimestamp,
    };
  }, [chargingSample, mode, snapshot]);

  return (
    <div className="mobile-page">
      <div className="flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background shadow-[0_0_80px_rgba(0,0,0,0.45)]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-background/95 px-3 py-2 backdrop-blur">
          <div className="inline-flex rounded-full border border-border bg-white/[0.03] p-0.5">
            {MODES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={
                  "rounded-full px-2.5 py-1.5 font-heading text-[10px] font-semibold uppercase tracking-[0.14em] transition " +
                  (mode === item
                    ? item === "charging"
                      ? "bg-cyan-300/15 text-cyan-100"
                      : "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground")
                }
                aria-pressed={mode === item}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            <Link href={`/dev/history?vehicle_id=${vehicleId}`} className="transition hover:text-foreground">
              History
            </Link>
            <Link href={`/dev/bydmate-diplus?vehicle_id=${vehicleId}`} className="transition hover:text-foreground">
              Di+
            </Link>
            <Link href="/dev" className="transition hover:text-foreground">
              Dev
            </Link>
          </div>
        </div>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)]">
          <VehicleLiveFixtureView snapshot={displayedSnapshot} points={points} />
        </main>
        <BottomNavigation />
      </div>
    </div>
  );
}
