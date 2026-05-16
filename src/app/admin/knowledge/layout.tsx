import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/supabase/knowledge";

export default async function KnowledgeAdminLayout({ children }: { children: ReactNode }) {
  const guard = await requireAdmin();

  if (!guard.ok && guard.reason === "unauthenticated") {
    redirect("/login?next=/admin/knowledge");
  }

  if (!guard.ok) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
        <section className="max-w-md rounded-lg border border-border bg-card p-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
            Access denied
          </p>
          <h1 className="mt-2 font-heading text-2xl font-bold">Admin access required</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Your account is authenticated, but it is not listed in knowledge admin users.
          </p>
          <Link
            href="/dashboard"
            className="mt-5 inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold"
          >
            Back to dashboard
          </Link>
        </section>
      </main>
    );
  }

  return children;
}
