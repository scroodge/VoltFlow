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

// Pre-paint guard: Telegram injects window.Telegram.WebApp before the page is
// parsed, so this inline script can detect the Mini App context and inject a
// style that hides the KB BEFORE the browser paints it — no flash, regardless
// of User-Agent (Android/Desktop WebViews send a plain Chrome UA). Placed ahead
// of #tg-kb-root in document order so it runs before that markup is parsed.
// TelegramEntryGate removes #tg-kb-cover-style when the user chooses to browse
// the KB. Plain browsers have no initData → KB renders normally (SEO preserved).
const KB_PREPAINT_GUARD = `try{if(window.Telegram&&window.Telegram.WebApp&&window.Telegram.WebApp.initData){var s=document.createElement('style');s.id='tg-kb-cover-style';s.textContent='#tg-kb-root{display:none!important}';document.head.appendChild(s);}}catch(e){}`;

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
