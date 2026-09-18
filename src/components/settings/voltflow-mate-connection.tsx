"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMateReleaseQuery } from "@/hooks/use-mate-release-query";
import { useTranslation } from "@/hooks/use-translation";
import { useVoltflowMateLiveQuery } from "@/hooks/use-voltflowmate-live-query";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import {
  MATE_GITHUB_RELEASES_LATEST_URL,
  summarizeReleaseNotes,
} from "@/lib/mate-release-summary";
import { compareMateVersions, isMateUpdateAvailable } from "@/lib/mate-version";

export function VoltflowMateConnection({
  profileUserId,
}: {
  profileUserId: string | null;
}) {
  const { t } = useTranslation();
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [linkCreating, setLinkCreating] = useState(false);

  useEffect(() => {
    if (!linkExpiresAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [linkExpiresAt]);

  const linkCountdownSec = linkExpiresAt
    ? Math.max(0, Math.ceil((linkExpiresAt - nowMs) / 1000))
    : null;

  const formatLinkCountdown = (totalSec: number) => {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  const handleCreateVoltflowMateLinkCode = () => {
    if (!profileUserId && !isDevAppRoute()) {
      toast.error(t("settings.toasts.signInForLink") as string);
      return;
    }

    setLinkCreating(true);
    const request = isDevAppRoute()
      ? devFetch("/api/bydmate/link-code", { method: "POST" })
      : fetch("/api/bydmate/link-code", {
          method: "POST",
          credentials: "include",
        });

    void request
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: boolean;
          code?: string;
          expires_at?: string;
          error?: string;
        };
        if (
          !response.ok ||
          !payload.ok ||
          !payload.code ||
          !payload.expires_at
        ) {
          throw new Error(
            payload.error ?? String(t("settings.cloud.linkCodeFailed")),
          );
        }
        setLinkCode(payload.code);
        setNowMs(Date.now());
        setLinkExpiresAt(new Date(payload.expires_at).getTime());
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : String(t("settings.cloud.linkCodeFailed"));
        toast.error(message);
        setLinkCode(null);
        setLinkExpiresAt(null);
      })
      .finally(() => setLinkCreating(false));
  };

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" aria-hidden />
          {t("settings.cloud.name")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("settings.cloud.description")}
        </p>
        <VoltflowMateInstallPanel />
        <MateVersionPanel />
        <MateLinkButton
          formatLinkCountdown={formatLinkCountdown}
          linkCode={linkCode}
          linkCountdownSec={linkCountdownSec}
          linkCreating={linkCreating}
          handleCreateVoltflowMateLinkCode={handleCreateVoltflowMateLinkCode}
        />
      </CardContent>
    </Card>
  );
}

function VoltflowMateInstallPanel() {
  const { t } = useTranslation();
  return (
    <details className="rounded-2xl border border-white/[0.08] bg-white/[0.2] p-4">
      <summary className="cursor-pointer list-none text-sm font-semibold tracking-tight">
        {t("settings.cloud.installTitle")}
      </summary>
      <ol className="text-muted-foreground mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
        {(t("settings.cloud.installSteps") as readonly string[]).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <Button
        asChild
        variant="secondary"
        className="mt-3 h-11 w-full rounded-full text-sm"
      >
        <a
          href="https://github.com/scroodge/BYDMate-own/releases/latest"
          target="_blank"
          rel="noreferrer"
        >
          <span className="inline-flex items-center gap-2">
            {t("settings.cloud.downloadApk")}
            <ExternalLink className="size-4" aria-hidden />
          </span>
        </a>
      </Button>
    </details>
  );
}

/**
 * VoltFlow Mate version indicator. Shows the build currently running on the car
 * (latest live snapshot `mate_version`) next to the latest published release, and
 * whether an update is available.
 */
function MateVersionPanel() {
  const { t } = useTranslation();
  const { data: voltflowMateLive = [] } = useVoltflowMateLiveQuery();
  const { data: release } = useMateReleaseQuery();

  // Snapshots come back newest-first; take the most recent one that reports a version.
  const installedVersion =
    voltflowMateLive.find((snapshot) => snapshot.mate_version)?.mate_version ??
    null;
  const latestVersion = release?.version ?? null;
  const updateAvailable = isMateUpdateAvailable(
    installedVersion,
    latestVersion,
  );
  const installedNewerThanLatest =
    !!installedVersion &&
    !!latestVersion &&
    compareMateVersions(installedVersion, latestVersion) > 0;
  const releaseSummary =
    summarizeReleaseNotes(release?.release_notes) ??
    (updateAvailable
      ? t("settings.cloud.versionReleaseSummaryFallback")
      : null);
  const releaseUrl = release?.apk_url ?? MATE_GITHUB_RELEASES_LATEST_URL;

  return (
    <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
      <p className="text-sm font-semibold tracking-tight">
        {t("settings.cloud.versionTitle")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
            {t("settings.cloud.versionInstalled")}
          </p>
          <p className="mt-2 font-mono text-sm">
            {installedVersion ?? t("settings.cloud.versionUnknown")}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
            {t("settings.cloud.versionLatest")}
          </p>
          <p className="mt-2 font-mono text-sm">
            {latestVersion ?? t("common.unavailable")}
          </p>
        </div>
      </div>
      {installedVersion ? (
        updateAvailable ? (
          <div className="space-y-2">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--voltflow-cyan)]">
              <ArrowUpCircle className="size-4 shrink-0" aria-hidden />
              {t("settings.cloud.versionUpdateAvailable")}
            </p>
            {releaseSummary ? (
              <p className="text-muted-foreground text-sm leading-relaxed">
                {releaseSummary}
              </p>
            ) : null}
            <a
              href={releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--voltflow-cyan)] underline-offset-2 hover:underline"
            >
              {t("settings.cloud.versionViewOnGitHub")}
              <ExternalLink className="size-4 shrink-0" aria-hidden />
            </a>
          </div>
        ) : installedNewerThanLatest ? (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-300">
            <RefreshCw className="size-4 shrink-0" aria-hidden />
            {t("settings.cloud.versionCatalogLag")}
          </p>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--voltflow-green)]">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            {t("settings.cloud.versionUpToDate")}
          </p>
        )
      ) : null}
    </div>
  );
}

function MateLinkButton({
  formatLinkCountdown,
  linkCode,
  linkCountdownSec,
  linkCreating,
  handleCreateVoltflowMateLinkCode,
}: {
  formatLinkCountdown: (seconds: number) => string;
  linkCode: string | null;
  linkCountdownSec: number | null;
  linkCreating: boolean;
  handleCreateVoltflowMateLinkCode: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {linkCode && linkCountdownSec != null && linkCountdownSec > 0 ? (
        <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="text-center font-mono text-4xl font-semibold tracking-[0.32em] tabular-nums">
            {linkCode.slice(0, 3)} {linkCode.slice(3)}
          </p>
          <p className="text-muted-foreground text-center text-sm">
            {t("settings.cloud.linkCodeHint")}
          </p>
          <p className="text-center text-sm text-[var(--voltflow-green)]">
            {t("settings.cloud.linkCodeExpires", {
              time: formatLinkCountdown(linkCountdownSec),
            })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full rounded-full text-sm"
            onClick={handleCreateVoltflowMateLinkCode}
            disabled={linkCreating}
          >
            <RefreshCw className="mr-2 size-4" aria-hidden />
            {t("settings.cloud.linkVoltflowMate")}
          </Button>
        </div>
      ) : linkCode && linkCountdownSec === 0 ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {t("settings.cloud.linkCodeExpired")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 w-full rounded-full text-sm"
            onClick={handleCreateVoltflowMateLinkCode}
            disabled={linkCreating}
          >
            <RefreshCw className="mr-2 size-4" aria-hidden />
            {linkCreating
              ? t("settings.cloud.linkCodeCreating")
              : t("settings.cloud.linkVoltflowMate")}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="h-11 w-full rounded-full text-sm"
          onClick={handleCreateVoltflowMateLinkCode}
          disabled={linkCreating}
        >
          <RefreshCw className="mr-2 size-4" aria-hidden />
          {linkCreating
            ? t("settings.cloud.linkCodeCreating")
            : t("settings.cloud.linkVoltflowMate")}
        </Button>
      )}
    </>
  );
}
