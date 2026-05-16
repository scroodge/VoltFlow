import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/knowledge/AdminNav";

export function AdminShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
              VoltFlow CMS
            </p>
            <h1 className="mt-2 font-heading text-3xl font-bold">{title}</h1>
            {description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <AdminNav />
        </header>
        {children}
      </div>
    </main>
  );
}
