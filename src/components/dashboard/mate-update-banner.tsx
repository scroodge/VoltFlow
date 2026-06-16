"use client";

import { ArrowUpCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useMateReleaseQuery } from "@/hooks/use-mate-release-query";
import { useTranslation } from "@/hooks/use-translation";
import {
  MATE_GITHUB_RELEASES_LATEST_URL,
  summarizeReleaseNotes,
} from "@/lib/mate-release-summary";
import {
  dismissMateUpdateBanner,
  shouldShowMateUpdateBanner,
} from "@/lib/mate-update-dismiss";
import { isMateUpdateAvailable } from "@/lib/mate-version";

/**
 * Dismissible banner when the VoltFlow Mate build on the car is older than the
 * latest published release. Shown across main tabs via MobileShell.
 */
export function MateUpdateBanner({
  installedVersion,
}: {
  installedVersion: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { data: release } = useMateReleaseQuery();
  const [visible, setVisible] = useState(false);

  const latestVersion = release?.version ?? null;
  const updateAvailable = isMateUpdateAvailable(installedVersion, latestVersion);
  const releaseSummary = summarizeReleaseNotes(release?.release_notes);
  const releaseUrl = release?.apk_url ?? MATE_GITHUB_RELEASES_LATEST_URL;

  useEffect(() => {
    if (!updateAvailable || !latestVersion) {
      setVisible(false);
      return;
    }
    setVisible(shouldShowMateUpdateBanner(latestVersion));
  }, [updateAvailable, latestVersion]);

  if (!updateAvailable || !latestVersion || !visible) return null;

  const handleDismiss = () => {
    setVisible(false);
    dismissMateUpdateBanner(latestVersion);
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
        {releaseSummary ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground/80">{releaseSummary}</p>
        ) : null}
        <a
          href={releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs font-semibold text-[var(--voltflow-cyan)] underline-offset-2 hover:underline"
        >
          {t("dashboard.mateUpdateInstall")}
        </a>
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
