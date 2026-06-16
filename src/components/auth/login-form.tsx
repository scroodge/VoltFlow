"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { LegalFooterLinks } from "@/components/legal/legal-document-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/hooks/use-translation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleGoogle = async () => {
    const supabase = createClient();
    setLoading(true);
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
        : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          // Refresh token for long‑lived sessions where allowed.
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.message(t("auth.redirecting") as string);
  };

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!email || password.length < 8) {
      toast.error(t("auth.weakPassword") as string);
      return;
    }
    const supabase = createClient();
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("auth.confirmEmail") as string);
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!email || !password) return;

    const supabase = createClient();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(t("auth.welcome") as string);
    router.replace(next);
    router.refresh();
  };

  return (
    <Card className="w-full border-white/[0.1] pt-10 shadow-xl shadow-teal-500/25 backdrop-blur">
      <div className="flex justify-center px-6 pb-8">
        <LocaleSwitcher />
      </div>
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-3xl font-semibold tracking-tight">
          {t("auth.title")}
        </CardTitle>
        <CardDescription className="text-base">
          {t("auth.description")}
        </CardDescription>
      </CardHeader>
      <Tabs defaultValue="signin" className="w-full px-6">
        <TabsList className="mx-auto mb-10 flex w-full rounded-full border border-white/[0.1] bg-white/[0.03] p-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger className="h-11 rounded-full text-base" value="signin">
            {t("auth.login")}
          </TabsTrigger>
          <TabsTrigger className="h-11 rounded-full text-base" value="signup">
            {t("auth.register")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="signin">
          <form onSubmit={handleSignIn} className="space-y-6">
            <AuthFields />
            <div className="-mt-2 text-right">
              <Link
                href="/forgot-password"
                className="text-muted-foreground text-sm underline underline-offset-4 hover:text-primary"
              >
                {t("auth.forgotPassword")}
              </Link>
            </div>
            <Button
              className="h-[54px] w-full rounded-full text-base font-semibold"
              disabled={loading}
              type="submit"
            >
              {t("auth.continue")}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="signup">
          <form onSubmit={handleSignUp} className="space-y-6 pb-12">
            <AuthFields />
            <Button
              className="h-[54px] w-full rounded-full text-base font-semibold"
              variant="outline"
              disabled={loading}
              type="submit"
            >
              {t("auth.createAccount")}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      <CardFooter className="flex flex-col gap-6 pt-2 text-base">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.35em] text-muted-foreground">
            <span className="h-px flex-1 bg-white/10" />
            {t("auth.or")}
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-[48px] w-full rounded-full text-sm font-semibold"
            disabled={loading}
            onClick={() => void handleGoogle()}
          >
            {t("auth.google")}
          </Button>
        </div>

        <p className="text-muted-foreground text-center">
          {t("auth.installHint")}{" "}
          <span className="text-foreground font-semibold">{t("auth.addToHome")}</span>.
        </p>
        <Link
          href="/"
          className="text-muted-foreground text-center underline underline-offset-4 hover:text-primary"
        >
          {t("auth.back")}
        </Link>
      </CardFooter>

      <CardContent className="pb-10 text-muted-foreground text-center text-[11px] tracking-wide">
        <LegalFooterLinks className="mb-3" />
        {t("auth.hosted")}
      </CardContent>
    </Card>
  );
}

function AuthFields() {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
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
      <div className="space-y-2 text-left">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          placeholder="············"
          required
          className="h-[54px] rounded-2xl text-lg tracking-[0.2em]"
        />
      </div>
    </div>
  );
}
