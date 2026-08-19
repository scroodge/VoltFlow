import type { Metadata } from "next";
import { Suspense } from "react";

import { KnowledgeIndex } from "@/components/telegram/KnowledgeIndex";
import { TelegramEntryGate } from "@/components/telegram/TelegramEntryGate";
import { TelegramShell } from "@/components/telegram/TelegramShell";
import { JsonLd, collectionPageSchema } from "@/lib/seo/json-ld";
import { openGraph } from "@/lib/seo/open-graph";
import { createPublicClient } from "@/lib/supabase/public";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import { staticTelegramKnowledgeData } from "@/lib/telegram/knowledge";

export const metadata: Metadata = {
  title: "База знаний BYD YUAN UP",
  description:
    "Русская база знаний VoltFlow для BYD YUAN UP: зарядка, обслуживание, аксессуары, калькуляторы и опыт эксплуатации.",
  // TelegramShell.changeTab pushes ?tab=guides|faq|buy|more into the URL, which
  // otherwise yields four indexable copies of this page.
  alternates: { canonical: "/telegram" },
  openGraph: openGraph({
    url: "/telegram",
    title: "VoltFlow: база знаний BYD YUAN UP",
    description:
      "Русская база знаний мини-приложения Telegram для владельцев BYD YUAN UP.",
    type: "website",
  }),
};

// Pre-paint guard: hides the KB BEFORE the browser paints it when opened inside
// Telegram, so it never flashes. The reliable synchronous signal is the URL hash
// — Telegram appends "#tgWebAppData=...&tgWebAppVersion=..." to the Mini App URL,
// readable at parse time with no SDK. (window.Telegram.WebApp is NOT pre-injected
// on mobile; it's built by telegram-web-app.js after load, so checking it here
// races the paint.) We also OR in the SDK object in case it is already present.
// Placed ahead of #tg-kb-root so it runs before that markup is parsed.
// TelegramEntryGate removes #tg-kb-cover-style when the user browses the KB, and
// a safety timeout there reveals it if detection never completes. Plain browsers
// have no tgWebApp hash → KB renders normally (SEO preserved).
const KB_PREPAINT_GUARD = `try{var h=location.hash||'';if(h.indexOf('tgWebApp')>-1||(window.Telegram&&window.Telegram.WebApp&&window.Telegram.WebApp.initData)){var s=document.createElement('style');s.id='tg-kb-cover-style';s.textContent='#tg-kb-root{display:none!important}';document.head.appendChild(s);}}catch(e){}`;

// Statically rendered, refreshed hourly. Safe only because KnowledgeIndex
// renders real links outside the shell's Suspense boundary — without it, static
// rendering would prerender the `fallback={null}` and ship an empty shell.
export const revalidate = 3600;

export default async function TelegramPage() {
  const data = await getTelegramKnowledgeDataWithFallback(
    staticTelegramKnowledgeData,
    createPublicClient(),
  );

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: KB_PREPAINT_GUARD }} />
      <JsonLd
        data={collectionPageSchema({
          name: "База знаний BYD YUAN UP",
          description:
            "Гайды по зарядке, обслуживанию и аксессуарам для владельцев BYD YUAN UP.",
          path: "/telegram",
          items: data.articles.map((article) => ({
            title: article.title,
            path: `/telegram/article/${article.slug}`,
          })),
        })}
      />
      {/*
        Only TelegramShell may sit inside Suspense — it calls useSearchParams(),
        which under static rendering makes Next prerender the `fallback={null}`
        and defer the subtree to the client. Wrapping the whole page in that
        boundary prerendered /telegram as a 7-word empty shell with zero links.
        KnowledgeIndex therefore lives OUTSIDE it (but still inside
        #tg-kb-root, so the Telegram pre-paint guard hides and reveals the KB
        as one unit).
      */}
      <div id="tg-kb-root">
        <Suspense fallback={null}>
          <TelegramShell data={data} />
        </Suspense>
        <div className="mobile-page px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
          <KnowledgeIndex data={data} />
        </div>
      </div>
      <Suspense fallback={null}>
        <TelegramEntryGate />
      </Suspense>
    </>
  );
}
