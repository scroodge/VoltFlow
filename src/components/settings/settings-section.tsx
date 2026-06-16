import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsPageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-2 px-1">
      <p className="text-muted-foreground text-[11px] uppercase tracking-[0.26em]">
        {eyebrow}
      </p>
      <h1 className="text-balance text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">{subtitle}</p>
    </div>
  );
}

export function SettingsGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.01]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsGroupDivider() {
  return <div className="h-px bg-white/[0.07]" />;
}
