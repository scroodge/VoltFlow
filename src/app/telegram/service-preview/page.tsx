import { redirect } from "next/navigation";

export default function ServicePreviewRedirect() {
  redirect("/telegram?tab=buy");
}
