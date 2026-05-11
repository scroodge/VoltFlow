import { MobileShell } from "@/components/layout/MobileShell";

export default function AppSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MobileShell>{children}</MobileShell>;
}
