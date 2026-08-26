import type { Metadata } from "next";
import { Suspense } from "react";

import { TelegramEntryGate } from "@/components/telegram/TelegramEntryGate";

/**
 * Telegram Mini App entry gate — and nothing else.
 *
 * BotFather points t.me/Voltflowscr_bot/voltflow at this path, so it must keep
 * existing. It used to double as the public knowledge base, which is why the
 * SERP URL for every article read `/telegram/...`; the KB now lives at
 * `/knowledge/*` and this route carries no KB markup at all.
 *
 * That split deleted KB_PREPAINT_GUARD, revealKnowledgeBase() and the 5s safety
 * timeout: they existed only to hide the KB before paint when the gate and the
 * KB shared a URL. Nothing to hide now.
 *
 * `noindex` rather than a robots.txt Disallow — Disallow would stop Google
 * reading this very directive. `follow` stays on so the outbound link to
 * /knowledge still passes.
 */
export const metadata: Metadata = {
  title: "VoltFlow в Telegram",
  robots: { index: false, follow: true },
};

export default function TelegramPage() {
  return (
    <Suspense fallback={null}>
      <TelegramEntryGate />
    </Suspense>
  );
}
