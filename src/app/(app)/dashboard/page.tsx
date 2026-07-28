import type { Metadata } from "next";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";

import type { DashboardBootstrapData } from "@/components/dashboard/dashboard-bootstrap-types";
import { DashboardDevToolbar } from "@/components/dev/dashboard-dev-toolbar";
import { loadDashboardBootstrap } from "@/components/dashboard/dashboard-bootstrap";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { queryKeys } from "@/lib/query-keys";

export const metadata: Metadata = {
  title: "Cockpit",
};

function DashboardHydration({ data }: { data: DashboardBootstrapData }) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.cars, { cars: data.cars, preferredCarId: null });
  queryClient.setQueryData(queryKeys.bydmateLive, data.liveSnapshots);
  queryClient.setQueryData(queryKeys.sessions, data.sessions);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardView initialData={data} />
    </HydrationBoundary>
  );
}

export default async function DashboardPage() {
  const initialData = await loadDashboardBootstrap();

  return (
    <>
      <DashboardDevToolbar />
      {initialData ? <DashboardHydration data={initialData} /> : <DashboardView />}
    </>
  );
}
