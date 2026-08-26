"use client";

import { ArrowRight, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useTranslation } from "@/hooks/use-translation";
import { createClient } from "@/lib/supabase/client";

/**
 * Header for the public knowledge base — deliberately a SEPARATE component from
 * KnowledgeChrome, and mounted OUTSIDE its `<Suspense>` boundary.
 *
 * KnowledgeChrome calls useSearchParams() for `?tab=`; under static rendering
 * Next prerenders that boundary's `fallback={null}` and defers the subtree to
 * the client. When the <h1> lived in there, the prerendered HTML of /knowledge
 * had 29 crawlable links and no heading at all. This component touches no
 * request-time API, so it server-renders into the static HTML.
 *
 * The session check is client-side on purpose: reading it on the server would
 * make the route dynamic and cost `revalidate = 3600` plus the CDN cache, which
 * is what makes the KB indexable. Crawlers get the anonymous CTA; signed-in
 * users see it swap a beat later. Chrome flashes, never content.
 */
export function KnowledgeHeader() {
  const router = useRouter();
  const { t } = useTranslation();
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (active) setHasSession(Boolean(session));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 -mx-3 space-y-2 border-b border-border/60 bg-background/88 px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--voltflow-green)]/30 bg-[var(--voltflow-green)]/10 text-[var(--voltflow-green)]">
            <Zap className="size-4" aria-hidden />
          </div>
          <div>
            <h1 className="font-heading text-lg font-bold leading-none">
              База знаний BYD YUAN UP
            </h1>
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
              VoltFlow
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            router.push(hasSession ? "/dashboard" : "/login?next=/dashboard")
          }
          className="flex min-h-9 max-w-[8.75rem] shrink-0 items-center gap-1.5 rounded-full border border-[var(--voltflow-green)]/35 bg-[var(--voltflow-green)] px-3 text-xs font-bold text-[#08130C] transition-opacity"
        >
          <span className="truncate">
            {hasSession ? t("telegram.openApp") : t("telegram.openFullApp")}
          </span>
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </div>
    </header>
  );
}
