"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

function RecoveryCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = searchParams.get("next") || "/reset-password";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      router.replace("/login?error=configuration_error");
      return;
    }

    const supabase = createBrowserClient(url, key, { isSingleton: false });

    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (cancelled) return;
      if (session) {
        router.replace(next);
        return;
      }

      // No session from auto-initialization — try manual PKCE exchange
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        supabase.auth.exchangeCodeForSession(code).then(({ error: exErr }) => {
          if (cancelled) return;
          if (exErr) {
            router.replace(`/login?error=${encodeURIComponent(exErr.message)}`);
          } else {
            router.replace(next);
          }
        });
        return;
      }

      router.replace("/login?error=recovery_failed");
    });

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Processing password reset…</p>
    </div>
  );
}

export default function AuthCallbackRecoveryPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Processing password reset…</p>
      </div>
    }>
      <RecoveryCallbackInner />
    </Suspense>
  );
}
