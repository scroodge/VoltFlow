import type { Metadata } from "next";
import { Suspense } from "react";

import { KnowledgeHub } from "@/components/knowledge/knowledge-hub";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import { staticTelegramKnowledgeData } from "@/lib/telegram/knowledge";

export const metadata: Metadata = {
  title: "База знаний",
};

export default async function KnowledgePage() {
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);

  return (
    <Suspense fallback={null}>
      <KnowledgeHub data={data} />
    </Suspense>
  );
}
