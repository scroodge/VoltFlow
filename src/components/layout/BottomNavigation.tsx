"use client";

import { BarChart3, BookOpen, CarFront, Home, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/hooks/use-translation";
import { getDevPathPrefix, withDevPath } from "@/lib/dev/dev-path";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "nav.home", fallback: "Home", icon: Home, elevated: false },
  { href: "/vehicle", label: "nav.vehicle", fallback: "Vehicle", icon: CarFront, elevated: true },
  { href: "/history", label: "nav.history", fallback: "History", icon: BarChart3, elevated: false },
  { href: "/knowledge", label: "nav.knowledge", fallback: "Knowledge", icon: BookOpen, elevated: false },
  { href: "/settings", label: "nav.settings", fallback: "Settings", icon: Settings, elevated: false },
] as const;

export function BottomNavigation() {
  const pathname = usePathname();
  const devPrefix = getDevPathPrefix(pathname);
  const { t } = useTranslation();

  return (
    <nav className="app-bottom-nav" aria-label={t("nav.aria") as string}>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
          {items.map(({ href, label, fallback, icon: Icon, elevated }) => {
          const linkHref = withDevPath(href, devPrefix);
          const active =
            pathname === linkHref ||
            (href.startsWith(linkHref) && pathname.startsWith(linkHref + "/"));
          const showElevated = elevated && active;

          return (
            <Link
              key={href}
              href={linkHref}
              className={cn(
                "relative flex min-h-[52px] min-w-0 flex-col items-center justify-center rounded-2xl px-0.5 text-[11px] font-semibold transition-colors",
                active
                  ? "bg-white/[0.06] text-[var(--voltflow-green)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {showElevated ? (
                <span className="absolute -top-3 grid size-8 place-items-center rounded-full bg-[var(--voltflow-green)] text-[#08130C] shadow-[0_0_16px_rgba(0,230,118,0.35)]">
                  <Icon className="size-4" aria-hidden />
                </span>
              ) : (
                <Icon className="mb-1 size-5 shrink-0" aria-hidden />
              )}
              <span
                className={cn(
                  "flex min-h-[2em] max-w-full items-center justify-center break-words text-center leading-tight",
                  showElevated && "mt-2",
                )}
              >
                {t(label) || fallback}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
