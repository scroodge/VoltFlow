"use client";

import { BarChart3, Home, Settings, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "nav.home", fallback: "Home", icon: Home },
  { href: "/charging", label: "nav.charge", fallback: "Charging", icon: Zap },
  { href: "/history", label: "nav.history", fallback: "History", icon: BarChart3 },
  { href: "/settings", label: "nav.settings", fallback: "Settings", icon: Settings },
] as const;

export function BottomNavigation() {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <nav className="bottom-nav" aria-label={t("nav.aria") as string}>
      <div className="grid grid-cols-4 gap-1">
        {items.map(({ href, label, fallback, icon: Icon }) => {
          const active =
            pathname === href ||
            (href === "/charging" && pathname.startsWith("/charging/")) ||
            (href !== "/charging" && pathname.startsWith(href + "/"));

          return (
            <Link
              key={href}
              href={href}
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
