import { cn } from "@/lib/utils";

import { LogoMark } from "./LogoMark";

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)} aria-label="VoltFlow">
      <LogoMark className="size-11 shrink-0 voltflow-glow rounded-[18px]" />
      <div className="leading-none">
        <p className="font-heading text-2xl font-bold tracking-[0.01em] text-foreground">
          VoltFlow
        </p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Energy in motion
        </p>
      </div>
    </div>
  );
}
