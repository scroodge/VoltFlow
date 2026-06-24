"use client";

import { BarChart3, CarFront, Home, Settings, Wrench, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/hooks/use-translation";
import { useVehicleDrivingMode } from "@/hooks/use-vehicle-driving-mode";
import { getDevPathPrefix, withDevPath } from "@/lib/dev/dev-path";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "nav.home", fallback: "Home", icon: Home },
  { href: "/charging", label: "nav.charge", fallback: "Charging", icon: Zap },
  { href: "/vehicle", label: "nav.vehicle", fallback: "Vehicle", icon: CarFront },
  { href: "/service", label: "nav.service", fallback: "Service", icon: Wrench },
  { href: "/history", label: "nav.history", fallback: "History", icon: BarChart3 },
  { href: "/settings", label: "nav.settings", fallback: "Settings", icon: Settings },
] as const;

export function BottomNavigation() {
  const pathname = usePathname();
  const devPrefix = getDevPathPrefix(pathname);
  const { t } = useTranslation();
  const isDriving = useVehicleDrivingMode();
  const visibleItems = isDriving ? items.filter((item) => item.href !== "/charging") : items;

  return (
    <nav className="app-bottom-nav" aria-label={t("nav.aria") as string}>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
      >
        {visibleItems.map(({ href, label, fallback, icon: Icon }) => {
          const linkHref = withDevPath(href, devPrefix);
          const active =
            pathname === linkHref ||
            (href === "/charging" && pathname.startsWith(withDevPath("/charging/", devPrefix))) ||
            (href !== "/charging" && pathname.startsWith(linkHref + "/"));

          return (
            <Link
              key={href}
              href={linkHref}
              className={cn(
                "flex min-h-[52px] flex-col items-center justify-center rounded-2xl text-[11px] font-semibold transition-colors",
                active
                  ? "bg-white/[0.06] text-[var(--voltflow-green)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="mb-1 size-5 shrink-0" aria-hidden />
              {t(label) || fallback}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
