import { redirect } from "next/navigation";

export default async function ChargingSessionRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/history/${id}`);
}
