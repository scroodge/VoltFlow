"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

const STORAGE_KEY = "voltflow:kb_viewed";

/**
 * Counts one view per article per day, per device.
 *
 * Runs on the client on purpose. Incrementing during the server render would count
 * Next.js prefetches and non-JS crawlers, and could not tell a refresh from a real read —
 * popularity would end up measuring who reloads most, which is the same dishonesty the
 * old fake "Популярные" list had.
 *
 * The "already counted" set is per-user state and stays in localStorage; only the
 * aggregate count reaches Postgres. The write goes through
 * `increment_knowledge_article_view`, a SECURITY DEFINER RPC that can do nothing but bump
 * a counter — the knowledge tables themselves stay read-only to anon.
 */
export function ArticleViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return;

    const today = new Date().toISOString().slice(0, 10);

    let seen: Record<string, string> = {};
    try {
      seen = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
        string,
        string
      >;
    } catch {
      seen = {};
    }

    if (seen[slug] === today) return;

    let cancelled = false;
    void createClient()
      .rpc("increment_knowledge_article_view", { p_slug: slug })
      .then(({ error }) => {
        if (cancelled) return;
        // A failed count is not worth interrupting the reader — the article is already on
        // screen. Only record success, so a transient failure retries on the next visit.
        if (error) return;
        try {
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ ...seen, [slug]: today }),
          );
        } catch {
          /* storage blocked or full — the count still landed */
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return null;
}
