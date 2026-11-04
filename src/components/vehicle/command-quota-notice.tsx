"use client";

import { Heart } from "lucide-react";
import { useState } from "react";

import { SupportContent } from "@/app/support/support-page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VehicleCommandError } from "@/hooks/use-vehicle-commands-query";
import { QUOTA_RULES, QUOTA_SUPPORT_PITCH } from "@/lib/vehicle/command-quota";

/**
 * Error line under the remote controls. A free-plan quota hit gets the rules and an invitation
 * to support the project instead of a bare error. The support options open in a dialog, so the
 * user stays on the vehicle page.
 */
export function CommandErrorNotice({ error }: { error: unknown }) {
  const [supportOpen, setSupportOpen] = useState(false);
  if (!error) return null;
  if (error instanceof VehicleCommandError && error.code === "plan_quota") {
    return (
      <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium">{error.message}</p>
        <p className="text-xs text-muted-foreground">{QUOTA_RULES}</p>
        <p className="text-xs text-muted-foreground">{QUOTA_SUPPORT_PITCH}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1.5"
          onClick={() => setSupportOpen(true)}
        >
          <Heart className="size-4" />
          Поддержать проект
        </Button>
        <Dialog open={supportOpen} onOpenChange={setSupportOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader className="pr-8">
              <DialogTitle>Поддержать VoltFlow</DialogTitle>
              <DialogDescription>{QUOTA_SUPPORT_PITCH}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-5">
              <SupportContent />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
  return (
    <p className="text-sm text-destructive">
      {error instanceof Error ? error.message : "Ошибка команды"}
    </p>
  );
}
