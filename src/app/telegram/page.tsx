import type { Metadata } from "next";
import { Suspense } from "react";

import { TelegramEntryGate } from "@/components/telegram/TelegramEntryGate";
import { TelegramShell } from "@/components/telegram/TelegramShell";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import { staticTelegramKnowledgeData } from "@/lib/telegram/knowledge";

export const metadata: Metadata = {
  title: "База знаний BYD YUAN UP",
  description:
    "Русская база знаний VoltFlow для BYD YUAN UP: зарядка, обслуживание, аксессуары, калькуляторы и опыт эксплуатации.",
  openGraph: {
    title: "VoltFlow: база знаний BYD YUAN UP",
    description:
      "Русская база знаний мини-приложения Telegram для владельцев BYD YUAN UP.",
    type: "website",
  },
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

export default async function TelegramPage() {
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);

  return (
    <Suspense fallback={null}>
      <script dangerouslySetInnerHTML={{ __html: KB_PREPAINT_GUARD }} />
      <div id="tg-kb-root">
        <TelegramShell data={data} />
      </div>
      <TelegramEntryGate />
    </Suspense>
  );
}
