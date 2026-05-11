import { cn } from "@/lib/utils";

import { ChargingBolt } from "./ChargingBolt";

export function BrandBadge({
  children = "Smart charging. Full control.",
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      <ChargingBolt className="size-4" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
