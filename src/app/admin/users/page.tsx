import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminUsersPanel } from "@/components/admin/users/admin-users-panel";
import { requireAdmin } from "@/lib/supabase/knowledge";

export const metadata: Metadata = {
  title: "Users & Activity",
};

export default async function AdminUsersPage() {
  const guard = await requireAdmin();

  if (!guard.ok && guard.reason === "unauthenticated") {
    redirect("/login?next=/admin/users");
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
            This account is not in the admin list.
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

  return (
    <div className="mobile-page">
      <div className="flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background shadow-[0_0_80px_rgba(0,0,0,0.45)]">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
            <header className="rounded-2xl border border-white/10 bg-card px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Admin</p>
              <h1 className="text-xl font-semibold">Users &amp; Activity</h1>
              <p className="text-sm text-muted-foreground">
                Monitor activity, premium status, and Mate versions across all users.
              </p>
            </header>
            <AdminUsersPanel />
          </div>
        </main>
      </div>
    </div>
  );
}
