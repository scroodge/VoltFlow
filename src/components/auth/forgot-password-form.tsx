"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/hooks/use-translation";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { t } = useTranslation();

  const handleResetRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();

    if (!email) return;

    let supabase;
    try {
      supabase = createClient();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to initialize");
      return;
    }

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback/recovery?next=${encodeURIComponent("/reset-password")}`
        : undefined;

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return;
    } finally {
      setLoading(false);
    }

    setSent(true);
    toast.success(t("auth.resetEmailSent") as string);
  };

  return (
    <Card className="w-full border-white/[0.1] pt-10 shadow-xl shadow-teal-500/25 backdrop-blur">
      <div className="flex justify-center px-6 pb-8">
        <LocaleSwitcher />
      </div>
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-3xl font-semibold tracking-tight">
          {t("auth.forgotTitle")}
        </CardTitle>
        <CardDescription className="text-base">
          {t("auth.forgotDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="text-muted-foreground text-center text-base">
            {t("auth.resetEmailHelp")}
          </p>
        ) : (
          <form onSubmit={handleResetRequest} className="space-y-6">
            <div className="space-y-2 text-left">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                name="email"
                autoComplete="email"
                placeholder="driver@electric.drive"
                type="email"
                required
                className="h-[54px] rounded-2xl text-lg"
              />
            </div>
            <Button
              className="h-[54px] w-full rounded-full text-base font-semibold"
              disabled={loading}
              type="submit"
            >
              {t("auth.sendResetLink")}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-6 pt-2 pb-10 text-base">
        <Link
          href="/login"
          className="text-muted-foreground text-center underline underline-offset-4 hover:text-primary"
        >
          {t("auth.backToLogin")}
        </Link>
      </CardFooter>
    </Card>
  );
}
