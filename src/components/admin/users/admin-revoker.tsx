"use client";

import { useState } from "react";
import { toast } from "sonner";

import { postAdminAction } from "./post-admin-action";
import type { AdminUser } from "./types";

export function AdminRevoker({
  user,
  onUpdated,
}: {
  user: AdminUser;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    setBusy(true);
    try {
      await postAdminAction(
        `/api/admin/users/${user.id}/admin`,
        { method: "DELETE" },
        "Could not revoke admin",
      );
      toast.success("Admin role revoked");
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not revoke admin",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-red-500/20 bg-red-500/[0.03] p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        This will remove{" "}
        <span className="font-medium text-foreground">
          {user.email ?? "this user"}
        </span>{" "}
        from the admin list. Their premium entitlement will switch to their
        current premium term/flag.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void revoke()}
          disabled={busy}
          className="inline-flex min-h-8 items-center rounded-lg border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
        >
          {busy ? "Revoking..." : "Confirm revoke"}
        </button>
      </div>
    </div>
  );
}
