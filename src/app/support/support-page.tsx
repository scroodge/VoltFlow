"use client";

import {
  ArrowLeft,
  Check,
  Coffee,
  Copy,
  Heart,
  Mail,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/use-translation";
import { createClient } from "@/lib/supabase/client";
import {
  SUPPORT_BUYMEACOFFEE_URL,
  SUPPORT_CARDS,
  SUPPORT_EMAIL,
  SUPPORT_TELEGRAM_BOT_URL,
} from "@/lib/support";

function CopyRow({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white/[0.03] px-4 py-3">
      <div className="min-w-0">
        {label ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
        ) : null}
        <p className="truncate font-heading text-base font-bold">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <Check className="size-3.5 text-[var(--voltflow-green)]" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        {copied ? t("support.copied") : t("support.copy")}
      </button>
    </div>
  );
}

export default function SupportPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const funds = [t("support.fund1"), t("support.fund2"), t("support.fund3")];

  const receiptBody = [
    `Account email: ${email ?? "—"}`,
    `Account ID: ${userId ?? "—"}`,
    "",
    "(attach the receipt screenshot or PDF)",
  ].join("\n");
  const receiptMailto = `mailto:${SUPPORT_EMAIL}?${new URLSearchParams({
    subject: "VoltFlow support receipt",
    body: receiptBody,
  }).toString()}`;

  return (
    <main className="relative isolate min-h-dvh overflow-x-clip bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(0,209,255,0.28),transparent_34rem),radial-gradient(circle_at_10%_20%,rgba(0,230,118,0.18),transparent_24rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_88%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px voltflow-gradient" />

      <div className="mobile-page relative !h-auto min-h-dvh">
        <section className="flex w-full flex-col gap-5 px-5 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
          <header className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-border bg-white/[0.03]"
              asChild
            >
              <Link href="/dashboard" aria-label={t("support.backToApp") as string}>
                <ArrowLeft className="size-4" aria-hidden />
              </Link>
            </Button>
            <LocaleSwitcher className="shrink-0" />
          </header>

          <div className="space-y-3">
            <div className="grid size-12 place-items-center rounded-2xl border border-[var(--voltflow-green)]/40 bg-[var(--voltflow-green)]/10 text-[var(--voltflow-green)]">
              <Heart className="size-6" aria-hidden />
            </div>
            <h1 className="font-heading text-3xl font-bold leading-tight">
              {t("support.title")}
            </h1>
            <p className="text-muted-foreground">{t("support.intro")}</p>
            <ul className="space-y-2">
              {funds.map((fund) => (
                <li key={fund as string} className="flex gap-2 text-sm leading-6">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-[var(--voltflow-green)]"
                    aria-hidden
                  />
                  <span>{fund}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Premium perk */}
          <div className="voltflow-card p-4">
            <p className="font-heading text-base font-bold">
              🎁 {t("support.premiumPerkTitle")}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("support.premiumPerkBody")}
            </p>
          </div>

          {/* Bank cards */}
          <div className="space-y-2">
            <p className="font-heading text-base font-bold">{t("support.cardTitle")}</p>
            {SUPPORT_CARDS.map((card, index) => (
              <CopyRow key={index} value={card.number} label={card.bank} />
            ))}
          </div>

          {/* International */}
          <div className="space-y-2">
            <p className="font-heading text-base font-bold">{t("support.intlTitle")}</p>
            <Button
              size="lg"
              className="h-12 w-full rounded-full bg-[#FFDD00] font-heading text-sm font-bold text-[#06110B]"
              asChild
            >
              <a href={SUPPORT_BUYMEACOFFEE_URL} target="_blank" rel="noreferrer">
                <Coffee className="size-4" aria-hidden />
                {t("support.buyMeCoffee")}
              </a>
            </Button>
          </div>

          {/* Receipt */}
          <div className="voltflow-card space-y-3 p-4">
            <p className="font-heading text-base font-bold">
              {t("support.receiptTitle")}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("support.receiptBody")}
            </p>
            {email ? <CopyRow value={email} label={t("support.yourAccountEmail") as string} /> : null}
            {userId ? <CopyRow value={userId} label={t("support.yourAccountId") as string} /> : null}
            <div className="flex flex-col gap-2 pt-1">
              <Button
                size="lg"
                className="h-12 w-full rounded-full bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] font-heading text-sm font-bold text-[#06110B] voltflow-glow"
                asChild
              >
                <a href={SUPPORT_TELEGRAM_BOT_URL} target="_blank" rel="noreferrer">
                  <Send className="size-4" aria-hidden />
                  {t("support.sendViaBot")}
                </a>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
                asChild
              >
                <a href={receiptMailto}>
                  <Mail className="size-4" aria-hidden />
                  {t("support.sendViaEmail")}
                </a>
              </Button>
            </div>
          </div>

          <p className="pt-2 text-center font-heading text-lg font-bold">
            🙏 {t("support.thanks")}
          </p>
        </section>
      </div>
    </main>
  );
}
