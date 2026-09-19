"use client";

import { ExternalLink, KeyRound, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { deleteAccount } from "@/actions/account";
import { PremiumBadge } from "@/components/premium/premium-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountEmailQuery } from "@/hooks/use-account-email-query";
import { useTranslation } from "@/hooks/use-translation";
import { sendPasswordResetEmail } from "@/lib/auth/password-reset";
import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { useAppPath } from "@/lib/dev/dev-path";
import { clearPrivateBrowserData } from "@/lib/privacy/client";
import { createClient } from "@/lib/supabase/client";
import { isTelegramWebView } from "@/lib/telegram/environment";

export function AccountSettings() {
  const { t } = useTranslation();
  const appPath = useAppPath();
  const router = useRouter();
  const { data: email } = useAccountEmailQuery();
  const [securityBusy, setSecurityBusy] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountText, setDeleteAccountText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleSignOut = async () => {
    if (isDevAppRoute()) {
      toast.message(t("settings.toasts.devSignOutDisabled") as string);
      return;
    }
    const returnPath = isTelegramWebView() ? "/telegram" : "/login";
    await clearPrivateBrowserData();
    await createClient().auth.signOut();
    toast.success(t("settings.signedOut") as string);
    router.replace(returnPath);
    router.refresh();
  };

  const handleAddPassword = async () => {
    if (!email) {
      toast.error(t("settings.security.emailMissing") as string);
      return;
    }

    setSecurityBusy(true);
    try {
      const result = await sendPasswordResetEmail(email);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("settings.security.resetSent") as string);
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    const result = await deleteAccount();
    setDeletingAccount(false);
    if (result.ok) {
      await clearPrivateBrowserData();
      toast.success(t("settings.deleteAccountDone") as string);
      router.replace("/login");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <>
      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("settings.account")}
            <PremiumBadge />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
              {t("settings.email")}
            </p>
            {email === undefined ? (
              <Skeleton className="mt-2 h-5 w-2/5 rounded-xl" />
            ) : (
              <p className="mt-2 text-sm">{email ?? t("common.unavailable")}</p>
            )}
          </div>

          <Button
            className="h-11 w-full rounded-full text-sm font-semibold"
            variant="outline"
            type="button"
            onClick={() => void handleSignOut()}
          >
            {t("settings.signOut")}
          </Button>

          <div className="border-t border-white/[0.08] pt-3">
            <p className="text-muted-foreground mb-2 text-sm">
              {t("settings.exportRecentBody")}
            </p>
            <Button
              asChild
              variant="secondary"
              className="h-10 w-full rounded-full text-sm"
            >
              <a href={appPath("/api/vehicle/export?format=json")}>
                <ExternalLink className="mr-2 size-4" aria-hidden />
                {t("settings.exportRecent")}
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="size-5 text-destructive" aria-hidden />
            {t("settings.deleteAccount")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            {t("settings.deleteAccountBody")}
          </p>
          {deleteAccountOpen ? (
            <div className="space-y-3">
              <Input
                placeholder={t("settings.deleteAccountConfirm") as string}
                value={deleteAccountText}
                onChange={(e) => setDeleteAccountText(e.target.value)}
                className="h-11 rounded-2xl text-sm"
              />
              <Button
                className="h-11 w-full rounded-full text-sm font-semibold"
                variant="destructive"
                disabled={deleteAccountText !== "DELETE" || deletingAccount}
                onClick={() => void handleDeleteAccount()}
              >
                {deletingAccount
                  ? t("settings.deleteAccountConfirming")
                  : t("settings.deleteAccount")}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setDeleteAccountOpen(false);
                  setDeleteAccountText("");
                }}
                className="w-full py-1 text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {t("common.cancel") as string}
              </button>
            </div>
          ) : (
            <Button
              className="h-11 w-full rounded-full text-sm font-semibold"
              variant="outline"
              type="button"
              onClick={() => setDeleteAccountOpen(true)}
            >
              {t("settings.deleteAccount")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" aria-hidden />
            {t("settings.security.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("settings.security.body")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 w-full rounded-full text-sm font-semibold"
            disabled={securityBusy || !email}
            onClick={() => void handleAddPassword()}
          >
            {securityBusy
              ? t("settings.security.sending")
              : t("settings.security.addPassword")}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
