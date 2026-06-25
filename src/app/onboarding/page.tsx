"use client";

import {
  ArrowLeft,
  ArrowRight,
  Car,
  Check,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { LogoFull } from "@/components/brand/LogoFull";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/use-translation";
import { useVehicleConnection } from "@/hooks/use-vehicle-connection";
import { MATE_GITHUB_RELEASES_LATEST_URL } from "@/lib/mate-release-summary";
import { useAppPreferences } from "@/stores/use-app-preferences";

type Step = "install" | "link";

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function OnboardingPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const setOnboardingSkipped = useAppPreferences((s) => s.setOnboardingSkipped);
  const { data: connection } = useVehicleConnection();
  const connected = connection?.connected ?? false;

  const [step, setStep] = useState<Step>("install");
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const generateCode = useCallback(async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/bydmate/link-code", {
        method: "POST",
        credentials: "include",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        code?: string;
        expires_at?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.code || !payload.expires_at) {
        throw new Error(payload.error ?? "link-code-failed");
      }
      setLinkCode(payload.code);
      setLinkExpiresAt(new Date(payload.expires_at).getTime());
    } catch {
      setLinkCode(null);
      setLinkExpiresAt(null);
    } finally {
      setCreating(false);
    }
  }, []);

  function goToLink() {
    setStep("link");
    // Generate the code on the way in (driven by the click, not an effect).
    if (!linkCode) void generateCode();
  }

  function handleSkip() {
    setOnboardingSkipped(true);
    router.push("/dashboard");
  }

  function handleEnter() {
    router.push("/dashboard");
  }

  const remaining = linkExpiresAt ? linkExpiresAt - now : 0;
  const codeExpired = linkExpiresAt != null && remaining <= 0;
  const installSteps = t("settings.cloud.installSteps") as readonly string[];

  return (
    <main className="relative isolate min-h-dvh overflow-x-clip bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(0,209,255,0.28),transparent_34rem),radial-gradient(circle_at_10%_20%,rgba(0,230,118,0.18),transparent_24rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_88%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px voltflow-gradient" />

      <div className="mobile-page relative !h-auto min-h-dvh">
        <section className="flex min-h-dvh w-full flex-col px-5 pb-8 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
          <header className="flex items-center justify-between gap-3">
            <LogoFull />
            <LocaleSwitcher className="shrink-0" />
          </header>

          {/* Step indicator */}
          <ol className="mt-8 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {[
              t("onboarding.stepInstall") as string,
              t("onboarding.stepLink") as string,
              t("onboarding.stepWaiting") as string,
            ].map((label, index) => {
              const active =
                (step === "install" && index === 0) ||
                (step === "link" && !connected && index === 1) ||
                (connected && index === 2);
              const done =
                (step === "link" && index === 0) || (connected && index < 2);
              return (
                <li key={label} className="flex flex-1 items-center gap-2">
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs ${
                      done
                        ? "border-[var(--voltflow-green)] bg-[var(--voltflow-green)] text-[#06110B]"
                        : active
                          ? "border-[var(--voltflow-cyan)] text-[var(--voltflow-cyan)]"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
                  </span>
                  <span className={active || done ? "text-foreground" : ""}>{label}</span>
                </li>
              );
            })}
          </ol>

          {connected ? (
            <div className="mt-10 flex flex-1 flex-col items-center justify-center text-center">
              <div className="grid size-20 place-items-center rounded-full border border-[var(--voltflow-green)] bg-[var(--voltflow-green)]/10 text-[var(--voltflow-green)]">
                <Check className="size-10" aria-hidden />
              </div>
              <h1 className="mt-6 font-heading text-3xl font-bold">
                {t("onboarding.connectedTitle")}
              </h1>
              <p className="mt-2 max-w-[22rem] text-muted-foreground">
                {t("onboarding.connectedBody")}
              </p>
              <Button
                size="lg"
                onClick={handleEnter}
                className="mt-8 h-14 w-full rounded-full bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] font-heading text-base font-bold text-[#06110B] voltflow-glow"
              >
                {t("onboarding.enterApp")}
                <ArrowRight className="size-5" aria-hidden />
              </Button>
            </div>
          ) : (
            <>
              <div className="mt-8 space-y-2">
                <h1 className="font-heading text-3xl font-bold leading-tight">
                  {step === "install"
                    ? t("onboarding.installTitle")
                    : t("onboarding.linkTitle")}
                </h1>
                <p className="text-muted-foreground">{t("onboarding.subtitle")}</p>
              </div>

              {step === "install" ? (
                <div className="mt-6 voltflow-card p-5">
                  <ol className="space-y-3">
                    {installSteps.map((stepText, index) => (
                      <li key={index} className="flex gap-3 text-sm leading-6">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs font-bold text-[var(--voltflow-cyan)]">
                          {index + 1}
                        </span>
                        <span>{stepText}</span>
                      </li>
                    ))}
                  </ol>
                  <Button
                    variant="outline"
                    className="mt-5 h-12 w-full rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
                    asChild
                  >
                    <a
                      href={MATE_GITHUB_RELEASES_LATEST_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="size-4" aria-hidden />
                      {t("settings.cloud.downloadApk")}
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="mt-6 voltflow-card p-5">
                  {creating ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                      <Loader2 className="size-5 animate-spin" aria-hidden />
                      {t("settings.cloud.linkCodeCreating")}
                    </div>
                  ) : linkCode && !codeExpired ? (
                    <div className="text-center">
                      <p className="font-heading text-5xl font-bold tracking-[0.2em] text-[var(--voltflow-green)]">
                        {linkCode.slice(0, 3)} {linkCode.slice(3)}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {t("settings.cloud.linkCodeHint")}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t("settings.cloud.linkCodeExpires", {
                          time: formatCountdown(remaining),
                        })}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">
                        {t("settings.cloud.linkCodeExpired")}
                      </p>
                      <Button
                        variant="outline"
                        className="mt-3 h-11 rounded-full border-border bg-white/[0.03] text-sm font-bold"
                        onClick={() => void generateCode()}
                      >
                        <RefreshCw className="size-4" aria-hidden />
                        {t("onboarding.generateCode")}
                      </Button>
                    </div>
                  )}

                  {/* Live waiting indicator — auto-advances when telemetry lands. */}
                  <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-white/[0.03] p-3">
                    <Loader2
                      className="size-5 shrink-0 animate-spin text-[var(--voltflow-cyan)]"
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-semibold">
                        {t("onboarding.waitingTitle")}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {t("onboarding.waitingBody")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-auto flex flex-col gap-3 pt-8">
                {step === "install" ? (
                  <Button
                    size="lg"
                    onClick={goToLink}
                    className="h-14 w-full rounded-full bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] font-heading text-base font-bold text-[#06110B] voltflow-glow"
                  >
                    <Car className="size-5" aria-hidden />
                    {t("onboarding.next")}
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => setStep("install")}
                    className="h-12 w-full rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
                  >
                    <ArrowLeft className="size-4" aria-hidden />
                    {t("onboarding.back")}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={handleSkip}
                  className="py-1 text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {t("onboarding.skip")}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
