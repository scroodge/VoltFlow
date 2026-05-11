import { BottomNavigation } from "@/components/layout/BottomNavigation";

export function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mobile-page">
      <div className="flex min-h-dvh w-full flex-col bg-background pb-[calc(env(safe-area-inset-bottom)+5.75rem)] shadow-[0_0_80px_rgba(0,0,0,0.45)]">
        <div className="flex flex-1 flex-col">{children}</div>
        <BottomNavigation />
      </div>
    </div>
  );
}
