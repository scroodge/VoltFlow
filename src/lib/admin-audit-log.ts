import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Records a privileged admin action (premium/role changes, payment registration).
 * Best-effort: a logging failure must never block or roll back the action itself, so
 * this only logs to the server console on error rather than throwing.
 */
export async function writeAdminAuditLog(entry: {
  actorAdminId: string;
  targetUserId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}) {
  const { error } = await getSupabaseAdmin().from("admin_audit_log").insert({
    actor_admin_id: entry.actorAdminId,
    target_user_id: entry.targetUserId ?? null,
    action: entry.action,
    details: entry.details ?? null,
  });
  if (error) {
    console.error("Admin audit log write failed:", error.message);
  }
}
