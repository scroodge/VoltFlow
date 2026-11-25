import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardSimulator } from "@/components/dev/dashboard-simulator";

export const metadata: Metadata = {
  title: "Dashboard simulator",
  robots: { index: false, follow: false },
};

export default async function DashboardSimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ devSnapshot?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { devSnapshot } = await searchParams;
  return (
    <DashboardSimulator
      initialScenario={typeof devSnapshot === "string" ? devSnapshot : "charge-ac"}
    />
  );
}
