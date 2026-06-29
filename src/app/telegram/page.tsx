import type { Metadata } from "next";
import { headers } from "next/headers";
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

export default async function TelegramPage() {
  const ua = (await headers()).get("user-agent") ?? "";
  // Telegram Mobile WebView includes "Telegram-iOS" or "Telegram-Android" in the UA.
  // When true the gate renders an opaque cover in the SSR HTML so the KB never flashes
  // before the welcome overlay or dashboard redirect completes.
  const isTelegramWebView = /\bTelegram\b/i.test(ua);

  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);

  return (
    <Suspense fallback={null}>
      <TelegramShell data={data} />
      <TelegramEntryGate initiallyDetecting={isTelegramWebView} />
    </Suspense>
  );
}
