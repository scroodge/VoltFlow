import { BottomNavigation } from "@/components/layout/BottomNavigation";

export function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mobile-page">
      <div className="flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background shadow-[0_0_80px_rgba(0,0,0,0.45)]">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)]">
          {children}
        </main>
        <BottomNavigation />
      </div>
    </div>
  );
}
