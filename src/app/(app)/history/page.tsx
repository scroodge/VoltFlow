import type { Metadata } from "next";
import { Suspense } from "react";

import { HistoryView } from "@/components/history/history-view";

export const metadata: Metadata = {
  title: "History",
};

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryView />
    </Suspense>
  );
}
