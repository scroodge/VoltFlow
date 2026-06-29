import { redirect } from "next/navigation";

export default function ChargingRedirect() {
  redirect("/vehicle?tab=charge");
}
