"use client";

import { ArrowRight, BookOpen, ChevronRight, Route, Wrench, Zap } from "lucide-react";

import { useTranslation } from "@/hooks/use-translation";

type TelegramWelcomeProps = {
  busy?: boolean;
  onOpenApp: () => void;
  onHaveAccount: () => void;
  onOpenKnowledge: () => void;
};

/**
 * Telegram Mini App welcome / onboarding screen — the first thing a user sees
 * when opening the bot's Mini App. Rendered as a full-screen overlay on top of
 * the knowledge base (which stays SSR'd underneath for browser SEO).
 *
 * Primary action ("Open the app") runs the silent Telegram login; secondary
 * action drops into the public knowledge base.
 */
export function TelegramWelcome({ busy = false, onOpenApp, onHaveAccount, onOpenKnowledge }: TelegramWelcomeProps) {
  const { t } = useTranslation();

  const features = [
    { icon: Zap, title: t("telegram.chargingTitle"), desc: t("telegram.chargingDesc") },
    { icon: Route, title: t("telegram.tripsTitle"), desc: t("telegram.tripsDesc") },
    { icon: Wrench, title: t("telegram.serviceTitle"), desc: t("telegram.serviceDesc") },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.16),transparent_22rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_72%)]" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--voltflow-green)]/30 bg-[var(--voltflow-green)]/10 text-[var(--voltflow-green)]">
              <Zap className="size-5" aria-hidden />
            </div>
            <div>
              <h1 className="font-heading text-lg font-bold leading-none">VoltFlow</h1>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">BYD YUAN UP</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--voltflow-green)]/30 px-2.5 py-1 text-[11px] font-semibold text-[var(--voltflow-green)]">
            {t("telegram.free")}
          </span>
        </header>

        <div className="mt-7">
          <h2 className="font-heading text-2xl font-bold leading-tight">
            {t("telegram.welcomeTitle")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("telegram.welcomeSubtitle")}
          </p>
        </div>

        <ul className="mt-5 space-y-2.5">
          {features.map(({ icon: Icon, title, desc }) => (
            <li
              key={title as string}
              className="flex items-center gap-3 rounded-2xl border border-border bg-white/[0.03] p-3"
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--voltflow-green)]/10 text-[var(--voltflow-green)]">
                <Icon className="size-4" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onOpenApp}
          disabled={busy}
          className="mt-7 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--voltflow-green)] text-base font-semibold text-[#08130C] transition-opacity disabled:opacity-60"
        >
          {busy ? t("telegram.openingApp") : t("telegram.openApp")}
          {!busy ? <ArrowRight className="size-5" aria-hidden /> : null}
        </button>

        <button
          type="button"
          onClick={onHaveAccount}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-white/[0.12] bg-white/[0.03] px-4 text-sm font-semibold text-foreground transition-colors hover:bg-white/[0.06]"
        >
          {t("telegram.haveAccount")}
        </button>
        <p className="mt-2 text-center text-[11px] leading-5 text-muted-foreground">
          {t("telegram.haveAccountHint")}
        </p>

        <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
          <span className="h-px flex-1 bg-white/10" />
          {t("telegram.or")}
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <button
          type="button"
          onClick={onOpenKnowledge}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl border border-[var(--voltflow-cyan)]/35 bg-white/[0.03] px-4 text-sm font-semibold transition-colors hover:bg-white/[0.05]"
        >
          <span className="flex items-center gap-2.5">
            <BookOpen className="size-5 text-[var(--voltflow-cyan)]" aria-hidden />
            {t("telegram.knowledge")}
          </span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </button>

        <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
          {t("telegram.footer")}
        </p>
      </div>
    </div>
  );
}
