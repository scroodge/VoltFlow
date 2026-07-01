"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Suspense, useEffect, useState } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "@/hooks/use-translation";
import { createClient } from "@/lib/supabase/client";

type Status = "verifying" | "success" | "error";

function ConfirmEmailInner() {
  const router = useRouter();
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("verifying");

  // Prefetch-proof confirmation: the email links here with a token_hash instead
  // of an auto-verifying magic link. We only exchange the token for a session in
  // this effect (client JS) — email scanners (Apple Mail Privacy, Telegram, etc.)
  // that GET the link don't run this code, so they can't burn the one-time token
  // before the user clicks. Mirrors the recovery flow in reset-password-form.tsx.
  useEffect(() => {
    let cancelled = false;

    async function confirm() {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = (params.get("type") as EmailOtpType | null) ?? "signup";

      if (!tokenHash) {
        if (!cancelled) setStatus("error");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (cancelled) return;

      if (error) {
        setStatus("error");
        return;
      }

      setStatus("success");
      // Session is now established; the onboarding gate takes over from here.
      router.replace("/onboarding");
      router.refresh();
    }

    void confirm();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <Card className="w-full border-white/[0.1] pt-10 shadow-xl shadow-teal-500/25 backdrop-blur">
      <div className="flex justify-center px-6 pb-8">
        <LocaleSwitcher />
      </div>
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-3xl font-semibold tracking-tight">
          {status === "error"
            ? t("auth.confirmErrorTitle")
            : status === "success"
              ? t("auth.confirmedTitle")
              : t("auth.confirmingTitle")}
        </CardTitle>
        <CardDescription className="text-base">
          {status === "error"
            ? t("auth.confirmErrorBody")
            : status === "success"
              ? t("auth.confirmedBody")
              : t("auth.confirmingBody")}
        </CardDescription>
      </CardHeader>
      {status === "error" ? (
        <CardContent className="pb-10">
          <Button
            asChild
            className="h-[54px] w-full rounded-full text-base font-semibold"
          >
            <Link href="/login">{t("auth.backToLogin")}</Link>
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function ConfirmEmailPage() {
  return (
    <div className="bg-background bg-[radial-gradient(circle_at_top,_rgba(15,157,169,0.22),transparent_72%)]">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-[calc(env(safe-area-inset-top)+48px)]">
        <Suspense>
          <ConfirmEmailInner />
        </Suspense>
      </div>
    </div>
  );
}
