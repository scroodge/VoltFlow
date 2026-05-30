"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  useVehicleDevSnapshot,
  type VehicleDevSnapshotMode,
} from "@/components/dev/vehicle-dev-snapshot-context";
import { getDevPathPrefix } from "@/lib/dev/dev-path";

const MODES: { id: VehicleDevSnapshotMode; label: string }[] = [
  { id: "online", label: "Online" },
  { id: "charging", label: "Charging" },
  { id: "stale", label: "Stale" },
];

export function VehicleDevToolbar() {
  const pathname = usePathname();
  const ctx = useVehicleDevSnapshot();
  if (getDevPathPrefix(pathname) === "" || !ctx) return null;

  const { mode, setMode } = ctx;

  return (
    <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-background/95 px-3 py-2 backdrop-blur">
      <div className="inline-flex rounded-full border border-border bg-white/[0.03] p-0.5">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMode(item.id)}
            className={
              "rounded-full px-2.5 py-1.5 font-heading text-[10px] font-semibold uppercase tracking-[0.14em] transition " +
              (mode === item.id
                ? item.id === "charging"
                  ? "bg-cyan-300/15 text-cyan-100"
                  : item.id === "stale"
                    ? "bg-yellow-300/15 text-yellow-200"
                    : "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground")
            }
            aria-pressed={mode === item.id}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-200">
          Dev only
        </span>
        <Link href="/dev/vehicle-telemetry-fixtures" className="transition hover:text-foreground">
          Fixtures
        </Link>
        <Link href="/dev" className="transition hover:text-foreground">
          Index
        </Link>
      </div>
    </div>
  );
}
