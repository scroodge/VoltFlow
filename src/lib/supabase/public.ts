import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Cookie-free anon client for PUBLIC reads only.
 *
 * Why this exists separately from `./server`: `createClient()` there calls
 * `await cookies()`, and any `cookies()` call opts the calling route into
 * dynamic rendering. That is why the knowledge base is served with
 * `cache-control: private, no-cache, no-store` and hits Postgres on every
 * crawl, and why `generateStaticParams` on the article routes is dead weight.
 * Anything that must stay statically renderable — `sitemap.ts`, and the KB
 * pages once they move to ISR — has to read through this client instead.
 *
 * Safe by construction: it holds the **anon** key, never the service-role key,
 * so RLS still applies. The public KB tables all grant `anon` SELECT on
 * published rows — see `supabase/migrations/20260516120000_knowledge_cms.sql`
 * (knowledge_categories, knowledge_articles `status = 'published'`, faq_items,
 * accessories), `20260518101000_spare_parts_cms.sql` and
 * `20260714130000_service_providers.sql`.
 *
 * Never use this for user-scoped data: with no session it is anonymous, so any
 * `auth.uid()`-scoped policy correctly returns nothing.
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
