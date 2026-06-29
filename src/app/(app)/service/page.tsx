import { redirect } from "next/navigation";

export default function ServiceRedirect() {
  redirect("/vehicle?tab=service");
}
