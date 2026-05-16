import type { Metadata } from "next";
import { Suspense } from "react";

import { TelegramShell } from "@/components/telegram/TelegramShell";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import { staticTelegramKnowledgeData } from "@/lib/telegram/knowledge";

export const metadata: Metadata = {
  title: "BYD YUAN UP Knowledge Base",
  description:
    "VoltFlow Telegram Mini App knowledge base for BYD YUAN UP charging, maintenance, accessories, calculators, and owner experience.",
  openGraph: {
    title: "VoltFlow BYD YUAN UP Knowledge Base",
    description:
      "Static Telegram Mini App knowledge base for BYD YUAN UP owners.",
    type: "website",
  },
};

export default async function TelegramPage() {
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);

  return (
    <Suspense fallback={null}>
      <TelegramShell data={data} />
    </Suspense>
  );
}
