import { useEffect, useRef, useState } from "react";
import { deriveChargePowerFromEnergyDeltaKw, snapshotKwhCharged } from "@/lib/charging-live";
import type { BydmateLiveSnapshotRow } from "@/types/database";

/**
 * Derives float charge power (kW) from consecutive BMS energy samples via
 * Δkwh_charged / Δt. Returns null until two valid samples ≥20 s apart arrive.
 * Resets when the snapshot goes away so stale power isn't carried into the next session.
 */
export function useFloatChargePowerKw(
  snapshot: BydmateLiveSnapshotRow | null | undefined,
): number | null {
  const prevRef = useRef<{ kwh: number; ms: number } | null>(null);
  const [floatPower, setFloatPower] = useState<number | null>(null);

  useEffect(() => {
    const kwh = snapshotKwhCharged(snapshot);
    const ms = snapshot ? Date.parse(snapshot.received_at) : null;
    if (kwh == null || ms == null || !Number.isFinite(ms)) {
      if (!snapshot) {
        prevRef.current = null;
        setFloatPower(null);
      }
      return;
    }
    const prev = prevRef.current;
    if (prev != null) {
      const power = deriveChargePowerFromEnergyDeltaKw(prev.kwh, prev.ms, kwh, ms);
      if (power != null) setFloatPower(power);
    }
    prevRef.current = { kwh, ms };
  }, [snapshot]);

  return floatPower;
}
