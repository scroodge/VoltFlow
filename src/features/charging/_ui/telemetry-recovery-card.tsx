"use client";

import { useEffect, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  importTelemetryRecoveryCandidate,
  listTelemetryRecoveryCandidates,
} from "../recovery-actions";
import type { TelemetryRecoveryCandidate } from "../_domain/telemetry-recovery";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";
import { useTranslation } from "@/hooks/use-translation";
import { useQueryClient } from "@tanstack/react-query";
import type { Car } from "@/types/database";

function candidateTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function TelemetryRecoveryCard({ car }: { car: Car }) {
  const qc = useQueryClient();
  const { locale, t } = useTranslation();
  const [pending, startTransition] = useTransition();
  const [candidates, setCandidates] = useState<TelemetryRecoveryCandidate[]>([]);
  const [selected, setSelected] = useState<TelemetryRecoveryCandidate | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setCandidates([]);
    const load = async () => {
      const result = await listTelemetryRecoveryCandidates({ carId: car.id });
      startTransition(() => {
        if (cancelled) return;
        setLoaded(true);
        if (result.ok) setCandidates(result.candidates);
      });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [car.id, startTransition]);

  const importCandidate = () => {
    if (!selected) return;
    const recoveryKey = selected.key;
    startTransition(async () => {
      const result = await importTelemetryRecoveryCandidate({ carId: car.id, recoveryKey });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCandidates((current) => current.filter((candidate) => candidate.key !== recoveryKey));
      setSelected(null);
      await qc.invalidateQueries({ queryKey: queryKeys.sessions });
      toast.success(t("charging.recovery.imported") as string);
    });
  };

  if (!loaded || candidates.length === 0) return null;

  return (
    <>
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
        <div className="flex gap-2.5">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="font-heading text-sm font-semibold">{t("charging.recovery.title") as string}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("charging.recovery.hint") as string}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {candidates.map((candidate) => (
            <button
              key={candidate.key}
              type="button"
              onClick={() => setSelected(candidate)}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-2 text-left transition hover:border-primary/60"
            >
              <span className="min-w-0 text-xs text-muted-foreground">
                {candidateTime(candidate.startedAt, locale)} · {candidate.startPercent.toFixed(0)}% → {candidate.endPercent.toFixed(0)}%
              </span>
              <span className="shrink-0 font-heading text-sm font-semibold tabular-nums">
                {candidate.chargedEnergyKwh.toFixed(2)} kWh
              </span>
            </button>
          ))}
        </div>
      </section>

      <Dialog open={selected != null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="font-heading text-xl font-bold">{t("charging.recovery.confirmTitle") as string}</DialogTitle>
            <DialogDescription className="text-xs">{t("charging.recovery.confirmHint") as string}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-1 px-6 py-3 text-sm text-muted-foreground tabular-nums">
              <p>{candidateTime(selected.startedAt, locale)} – {candidateTime(selected.stoppedAt, locale)}</p>
              <p>{selected.startPercent.toFixed(1)}% → {selected.endPercent.toFixed(1)}% · {selected.chargedEnergyKwh.toFixed(2)} kWh</p>
            </div>
          ) : null}
          <DialogFooter className="gap-2 px-6 pb-6">
            <Button type="button" variant="ghost" onClick={() => setSelected(null)}>{t("charging.recovery.cancel") as string}</Button>
            <Button type="button" disabled={pending} onClick={importCandidate}>{t("charging.recovery.import") as string}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
