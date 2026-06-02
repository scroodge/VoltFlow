"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { sendChargeCompletedPush } from "@/actions/push";
import { notifyChargeCompleted } from "@/lib/push/charge-complete-notification";
import { fetchSessionById } from "@/hooks/use-session-query";
import { useTranslation } from "@/hooks/use-translation";
import {
  chargingParamsFromSession,
  deriveChargingSessionLiveBundle,
  filterLiveSnapshotsForVehicle,
  resolveStateToPersist,
  staticDerivedFromSession,
} from "@/lib/charging-session-sync";
import {
  findFreshSocSnapshot,
  shouldAutoStopOnDriveAway,
  shouldBlockAutoComplete,
} from "@/lib/charging-live";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { DerivedChargingState } from "@/lib/charging-math";
import type { BydmateLiveSnapshotRow, ChargingSessionRow } from "@/types/database";

type UseChargingSessionLiveSyncOptions = {
  session: ChargingSessionRow | null | undefined;
  sessionId: string | null;
  liveSnapshots: BydmateLiveSnapshotRow[];
  vehicleId?: string | null;
  enabled?: boolean;
  skipPersist?: boolean;
  resolveLiveSnapshots?: (
    snapshots: BydmateLiveSnapshotRow[],
    session: ChargingSessionRow,
    nowMs: number,
  ) => BydmateLiveSnapshotRow[];
  onDerived?: (derived: DerivedChargingState | null) => void;
};

export function useChargingSessionLiveSync({
  session,
  sessionId,
  liveSnapshots,
  vehicleId,
  enabled = true,
  skipPersist = false,
  resolveLiveSnapshots,
  onDerived,
}: UseChargingSessionLiveSyncOptions) {
  const qc = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();
  const completingRef = useRef(false);
  const completionNoticeRef = useRef(false);

  const scopedSnapshots = useMemo(
    () => filterLiveSnapshotsForVehicle(liveSnapshots, vehicleId),
    [liveSnapshots, vehicleId],
  );

  useEffect(() => {
    if (!enabled || !sessionId) {
      onDerived?.(null);
      completingRef.current = false;
      completionNoticeRef.current = false;
      return;
    }

    if (!session) {
      onDerived?.(null);
      return;
    }

    if (session.status !== "charging" || !session.started_at) {
      onDerived?.(staticDerivedFromSession(session));
      completingRef.current = false;
      completionNoticeRef.current = session.status === "completed";
      return;
    }

    let lastPush = 0;
    completingRef.current = false;

    const tick = async () => {
      const now = Date.now();
      let row = qc.getQueryData<ChargingSessionRow>(queryKeys.session(sessionId));
      if (!row?.started_at) {
        row = await fetchSessionById(sessionId);
        qc.setQueryData(queryKeys.session(sessionId), row);
      }
      if (!row || row.status !== "charging" || !row.started_at) return;

      const params = chargingParamsFromSession(row);
      const startedAtMs = Date.parse(row.started_at);
      const snapshots = resolveLiveSnapshots
        ? resolveLiveSnapshots(scopedSnapshots, row, now)
        : scopedSnapshots;
      const bundle = deriveChargingSessionLiveBundle({
        snapshots,
        params,
        startedAtMs,
        nowMs: now,
      });

      onDerived?.(bundle.display);

      if (skipPersist) return;

      const freshSocSnapshot = findFreshSocSnapshot(snapshots, now);
      const stateToPersist = resolveStateToPersist(bundle);
      const { completionState } = bundle;

      if (
        completionState?.isComplete &&
        !completingRef.current &&
        !shouldBlockAutoComplete(freshSocSnapshot, now)
      ) {
        completingRef.current = true;
        const stoppedAt = new Date().toISOString();
        const { error: upErr } = await supabase
          .from("charging_sessions")
          .update({
            current_percent: completionState.currentPercent,
            charged_energy_kwh: completionState.chargedEnergyKwh,
            estimated_cost: completionState.estimatedCost,
            status: "completed",
            stopped_at: stoppedAt,
          })
          .eq("id", sessionId);

        if (upErr) {
          completingRef.current = false;
          toast.error(upErr.message);
          return;
        }

        qc.setQueryData(queryKeys.session(sessionId), (old) =>
          old
            ? {
                ...old,
                current_percent: completionState.currentPercent,
                charged_energy_kwh: completionState.chargedEnergyKwh,
                estimated_cost: completionState.estimatedCost,
                status: "completed",
                stopped_at: stoppedAt,
              }
            : old,
        );
        qc.invalidateQueries({ queryKey: queryKeys.sessions });
        toast.success(t("charging.targetReached") as string);
        if (!completionNoticeRef.current) {
          completionNoticeRef.current = true;
          void notifyChargeCompleted(sessionId, t("charging.targetReached") as string);
          void sendChargeCompletedPush(sessionId);
        }
        return;
      }

      const interruptState = bundle.liveCompletionState ?? bundle.liveChargingState;
      if (
        shouldAutoStopOnDriveAway(freshSocSnapshot, now) &&
        interruptState &&
        !completingRef.current
      ) {
        completingRef.current = true;
        const stoppedAt = new Date().toISOString();
        const { error: upErr } = await supabase
          .from("charging_sessions")
          .update({
            current_percent: interruptState.currentPercent,
            charged_energy_kwh: interruptState.chargedEnergyKwh,
            estimated_cost: interruptState.estimatedCost,
            status: "stopped",
            stopped_at: stoppedAt,
          })
          .eq("id", sessionId);

        if (upErr) {
          completingRef.current = false;
          toast.error(upErr.message);
          return;
        }

        qc.setQueryData(queryKeys.session(sessionId), (old) =>
          old
            ? {
                ...old,
                current_percent: interruptState.currentPercent,
                charged_energy_kwh: interruptState.chargedEnergyKwh,
                estimated_cost: interruptState.estimatedCost,
                status: "stopped",
                stopped_at: stoppedAt,
              }
            : old,
        );
        qc.invalidateQueries({ queryKey: queryKeys.sessions });
        return;
      }

      if (now - lastPush >= 950) {
        lastPush = now;
        const { error: upErr } = await supabase
          .from("charging_sessions")
          .update({
            current_percent: stateToPersist.currentPercent,
            charged_energy_kwh: stateToPersist.chargedEnergyKwh,
            estimated_cost: stateToPersist.estimatedCost,
          })
          .eq("id", sessionId);

        if (upErr) {
          console.warn("charging session persist failed:", upErr.message);
        }
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 1000);
    return () => window.clearInterval(interval);
  }, [
    enabled,
    onDerived,
    qc,
    resolveLiveSnapshots,
    scopedSnapshots,
    session,
    session?.started_at,
    session?.status,
    sessionId,
    skipPersist,
    supabase,
    t,
  ]);
}
