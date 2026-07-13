import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { KnowledgeHub } from "@/components/knowledge/knowledge-hub";
import {
  getCurrentUser,
  getTelegramKnowledgeDataWithFallback,
} from "@/lib/supabase/knowledge";
import { staticTelegramKnowledgeData } from "@/lib/telegram/knowledge";

export const metadata: Metadata = {
  title: "База знаний",
};

export default async function KnowledgePage() {
  // Anonymous visitors have no reason to see the in-app shell (bottom nav,
  // onboarding banners); send them to the already-public, SEO-ready /telegram
  // knowledge base instead. See BACKLOG.md "Public, no-login access to /knowledge".
  const user = await getCurrentUser();
  if (!user) {
    redirect("/telegram");
  }

  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);

  return (
    <Suspense fallback={null}>
      <KnowledgeHub data={data} />
    </Suspense>
  );
}
