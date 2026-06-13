"use client";

import { ArrowUpCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useMateReleaseQuery } from "@/hooks/use-mate-release-query";
import { useTranslation } from "@/hooks/use-translation";
import { isMateUpdateAvailable } from "@/lib/mate-version";

function dismissKey(version: string) {
  return `mate-update-dismissed:${version}`;
}

/**
 * Dashboard banner that appears when the VoltFlow Mate build running on the car
 * (`installedVersion`, from the latest live snapshot) is older than the latest
 * published release. Dismissal is remembered per latest-version, so a newer
 * release brings the banner back.
 */
export function MateUpdateBanner({
  installedVersion,
}: {
  installedVersion: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { data: release } = useMateReleaseQuery();
  const [dismissed, setDismissed] = useState(true);

  const latestVersion = release?.version ?? null;
  const updateAvailable = isMateUpdateAvailable(installedVersion, latestVersion);

  useEffect(() => {
    if (!updateAvailable || !latestVersion) return;
    try {
      setDismissed(window.localStorage.getItem(dismissKey(latestVersion)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [updateAvailable, latestVersion]);

  if (!updateAvailable || !latestVersion || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(latestVersion), "1");
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  };

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--voltflow-cyan)]/35 bg-[var(--voltflow-cyan)]/[0.06] p-4">
      <ArrowUpCircle
        className="mt-0.5 size-5 shrink-0 text-[var(--voltflow-cyan)]"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm font-bold tracking-normal text-foreground">
          {t("dashboard.mateUpdateTitle")}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("dashboard.mateUpdateBody", {
            version: latestVersion,
            installed: installedVersion ?? "—",
          })}
        </p>
        {release?.release_notes ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground/80">
            {release.release_notes}
          </p>
        ) : null}
        {release?.apk_url ? (
          <a
            href={release.apk_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs font-semibold text-[var(--voltflow-cyan)] underline-offset-2 hover:underline"
          >
            {t("dashboard.mateUpdateInstall")}
          </a>
        ) : null}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t("dashboard.mateUpdateDismiss") as string}
        className="rounded-full p-1 text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
