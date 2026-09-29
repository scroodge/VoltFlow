"use server";

import { createClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/web-push";

type PushSubscriptionPayload = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export async function savePushSubscription(input: PushSubscriptionPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  if (
    !input?.endpoint ||
    !input?.keys?.p256dh ||
    !input?.keys?.auth
  ) {
    return { ok: false as const, error: "Invalid push registration" };
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      expiration_time: input.expirationTime,
    },
    { onConflict: "endpoint" },
  );

  if (error) return { ok: false as const, error: error.message };

  return { ok: true as const };
}

export async function sendChargeCompletedPush(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  return sendPushToUser(supabase, user.id, {
    title: "Charge complete",
    body: "Battery reached target level.",
    url: `/history/${sessionId}`,
    tag: `charge-complete:${sessionId}`,
  });
}

export async function sendTestPush() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: "Unauthorized" };

  return sendPushToUser(supabase, user.id, {
    title: "VoltFlow test",
    body: "Server push test for this account.",
    url: "/settings",
    tag: `push-test:${Date.now()}`,
  });
}
