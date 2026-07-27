import type { Metadata } from "next";

import { ChargingSessionScreen } from "@/features/charging/client";

export const metadata: Metadata = {
  title: "Session detail",
};

export default async function HistorySessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChargingSessionScreen sessionId={id} mode="history" />;
}
