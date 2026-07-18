"use client";

import { ArrowRight, MoreVertical, Share, SquarePlus } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/hooks/use-translation";
import { isIos, isStandalone, noopSubscribe, subscribeDisplayMode } from "@/lib/pwa";

/**
 * Landing "Start tracking" CTA. When the app already runs installed (standalone)
 * it goes straight to /login. Otherwise it opens an install-first dialog — PWAs
 * sign in best from the installed instance (push + standalone only work there) —
 * while still letting the user continue in the browser.
 */
export function StartTrackingButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const installed = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
  const ios = useSyncExternalStore(noopSubscribe, isIos, () => false);
  const [open, setOpen] = useState(false);

  if (installed) {
    return (
      <Button size="lg" variant="outline" className={className} asChild>
        <Link href="/login">
          {t("landing.start")}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button
        size="lg"
        variant="outline"
        className={className}
        onClick={() => setOpen(true)}
      >
        {t("landing.start")}
        <ArrowRight className="size-4" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("landing.installFirstTitle")}</DialogTitle>
            <DialogDescription>{t("landing.installFirstBody")}</DialogDescription>
          </DialogHeader>

          <ol className="space-y-2 text-sm leading-6">
            <li className="flex items-center gap-2">
              {ios ? (
                <Share
                  className="size-4 shrink-0 text-[var(--voltflow-cyan)]"
                  aria-hidden
                />
              ) : (
                <MoreVertical
                  className="size-4 shrink-0 text-[var(--voltflow-cyan)]"
                  aria-hidden
                />
              )}
              <span>
                {ios ? t("landing.installIosStep1") : t("landing.installGenericStep1")}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <SquarePlus
                className="size-4 shrink-0 text-[var(--voltflow-cyan)]"
                aria-hidden
              />
              <span>{t("landing.installIosStep2")}</span>
            </li>
          </ol>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full border-border bg-white/[0.03] font-semibold"
              asChild
            >
              <Link href="/login">{t("landing.continueInBrowser")}</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
