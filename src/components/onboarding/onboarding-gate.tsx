"use client";

import { Car } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useTranslation } from "@/hooks/use-translation";
import { useVehicleConnection } from "@/hooks/use-vehicle-connection";
import { useAppPreferences } from "@/stores/use-app-preferences";

/**
 * Soft post-login gate: a signed-in user whose car has never streamed telemetry
 * is sent to the onboarding wizard, UNLESS they chose "Explore first" (skip
 * preference). Once the car connects, this never fires again. Mounted only
 * inside the authenticated shell, so it never runs on /onboarding itself.
 */
export function OnboardingGate() {
  const { data } = useVehicleConnection();
  const skipped = useAppPreferences((s) => s.onboardingSkipped);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!data?.authenticated) return;
    if (data.connected || skipped) return;
    if (pathname === "/onboarding") return;
    router.replace("/onboarding");
  }, [data, skipped, pathname, router]);

  return null;
}

/**
 * Persistent nudge shown to users who skipped onboarding but still have no car
 * connected. Disappears the moment telemetry arrives.
 */
export function ConnectCarBanner() {
  const { t } = useTranslation();
  const { data } = useVehicleConnection();

  if (!data?.authenticated || data.connected) return null;

  return (
    <div className="px-6 pt-4">
      <Link
        href="/onboarding"
        className="flex items-center gap-3 rounded-2xl border border-[var(--voltflow-cyan)]/40 bg-[var(--voltflow-cyan)]/[0.07] px-4 py-3 text-sm font-semibold"
      >
        <Car className="size-5 shrink-0 text-[var(--voltflow-cyan)]" aria-hidden />
        <span className="flex-1">{t("onboarding.reconnectBanner")}</span>
        <span className="text-[var(--voltflow-cyan)]">→</span>
      </Link>
    </div>
  );
}
