import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

let adminClient: ReturnType<typeof createServiceClient> | undefined;

export function getSupabaseAdmin() {
  adminClient ??= createServiceClient();
  return adminClient;
}
