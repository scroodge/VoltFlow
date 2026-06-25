"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmailOtpType } from "@supabase/supabase-js";
import { useTranslation } from "@/hooks/use-translation";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handlePasswordUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password.length < 8) {
      toast.error(t("auth.weakPassword") as string);
      return;
    }

    if (password !== confirmPassword) {
      toast.error(t("auth.passwordMismatch") as string);
      return;
    }

    const supabase = createClient();
    setLoading(true);

    // Prefetch-proof recovery: the email links to this page with a token_hash
    // instead of an auto-verifying magic link. We only exchange the token for a
    // session here, on the user's submit — so email scanners (Apple Mail
    // Privacy, Telegram, etc.) that GET the link can't consume the one-time
    // token before the user does.
    //
    // The token_hash is single-use: the first verifyOtp consumes it and creates
    // the session. If updateUser then fails (e.g. the user typed their old
    // password), we must NOT re-verify on retry — the token is already spent.
    // So only verify when there's no session yet; subsequent submits reuse it.
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      if (tokenHash) {
        const type = (params.get("type") as EmailOtpType | null) ?? "recovery";
        const { error: verifyError } = await supabase.auth.verifyOtp({
          type,
          token_hash: tokenHash,
        });
        if (verifyError) {
          setLoading(false);
          toast.error(verifyError.message);
          return;
        }
      }
    }

    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(t("auth.passwordUpdated") as string);
    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <Card className="w-full border-white/[0.1] pt-10 shadow-xl shadow-teal-500/25 backdrop-blur">
      <div className="flex justify-center px-6 pb-8">
        <LocaleSwitcher />
      </div>
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-3xl font-semibold tracking-tight">
          {t("auth.resetTitle")}
        </CardTitle>
        <CardDescription className="text-base">
          {t("auth.resetDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-10">
        <form onSubmit={handlePasswordUpdate} className="space-y-6">
          <div className="space-y-2 text-left">
            <Label htmlFor="password">{t("auth.newPassword")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="············"
              required
              className="h-[54px] rounded-2xl text-lg tracking-[0.2em]"
            />
          </div>
          <div className="space-y-2 text-left">
            <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="············"
              required
              className="h-[54px] rounded-2xl text-lg tracking-[0.2em]"
            />
          </div>
          <Button
            className="h-[54px] w-full rounded-full text-base font-semibold"
            disabled={loading}
            type="submit"
          >
            {t("auth.updatePassword")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
