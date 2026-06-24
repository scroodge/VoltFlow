import {
  Beaker,
  CarFront,
  FileText,
  Gauge,
  Globe2,
  LayoutDashboard,
  LockOpen,
  MessageCircle,
  Search,
  Server,
  Settings,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";

export const dynamic = "force-dynamic";

type DevRoute = {
  title: string;
  path: string;
  description?: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  href?: string;
};

const sitePrefix = "/dev";

const appRoutes: DevRoute[] = [
  route("Cockpit", "/dashboard", Gauge),
  route("Charging", "/charging", Zap),
  route("Vehicle", "/vehicle", CarFront),
  route("Service", "/service", Wrench),
  route("History", "/history", LayoutDashboard),
  route("Settings", "/settings", Settings),
  route("New car", "/cars/new", CarFront),
  route("Edit car (way)", "/cars/[id]/edit", CarFront, "Open from Settings after loading cars"),
];

const adminRoutes: DevRoute[] = [
  route("Knowledge overview", "/admin/knowledge", Shield),
  route("Articles", "/admin/knowledge/articles", FileText),
  route("New article", "/admin/knowledge/articles/new", FileText),
  route("FAQ", "/admin/knowledge/faq", MessageCircle),
  route("New FAQ", "/admin/knowledge/faq/new", MessageCircle),
  route("Accessories", "/admin/knowledge/accessories", Wrench),
  route("New accessory", "/admin/knowledge/accessories/new", Wrench),
  route("Spare parts", "/admin/knowledge/spare-parts", Wrench),
  route("New spare part", "/admin/knowledge/spare-parts/new", Wrench),
  route("Categories", "/admin/knowledge/categories", FileText),
];

const publicRoutes: DevRoute[] = [
  route("Marketing", "/", Globe2),
  route("Login", "/login", LockOpen),
  route("Forgot password", "/forgot-password", LockOpen),
  route("Reset password", "/reset-password", LockOpen),
  route("Telegram home", "/telegram", MessageCircle),
  route("Knowledge search", "/knowledge/search", Search),
];

const fixtureRoutes: DevRoute[] = [
  directRoute("WB API debug", "/dev/api", Server),
  directRoute("Vehicle fixture controls", "/dev/vehicle-telemetry-fixtures", Beaker),
  directRoute("DiPlus diagnostics", "/dev/bydmate-diplus", Beaker),
  directRoute("Vehicle remote control", "/dev/vehicle-control", CarFront),
];

const dynamicRoutes: DevRoute[] = [
  templateRoute("Edit car", "/cars/[id]/edit", CarFront),
  templateRoute("Charging session", "/charging/[id]", Zap),
  templateRoute("History session", "/history/[id]", LayoutDashboard),
  templateRoute("Edit article", "/admin/knowledge/articles/[id]", FileText),
  templateRoute("Article preview", "/admin/knowledge/articles/[id]/preview", FileText),
  templateRoute("Edit FAQ", "/admin/knowledge/faq/[id]", MessageCircle),
  templateRoute("Edit accessory", "/admin/knowledge/accessories/[id]", Wrench),
  templateRoute("Edit spare part", "/admin/knowledge/spare-parts/[id]", Wrench),
  templateRoute("Telegram article", "/telegram/article/[slug]", MessageCircle),
  templateRoute("Telegram category", "/telegram/category/[slug]", MessageCircle),
];

export default function DevIndexPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground md:px-8">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
              Dev preview
            </p>
            <h1 className="mt-2 font-heading text-3xl font-bold tracking-normal">
              Все страницы VoltFlow
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Ссылки с префиксом /dev открывают те же страницы, что и prod, без логина — данные
              scroodgemac@gmail.com и машины way. Fixture-страницы остаются отдельными
              диагностическими превью.
            </p>
          </div>
          <Link
            href="/dev/dashboard"
            className="inline-flex min-h-10 w-fit items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground"
          >
            Открыть cockpit (way)
          </Link>
        </header>

        <RouteSection title="Приложение" routes={appRoutes} />
        <RouteSection title="Админка" routes={adminRoutes} />
        <RouteSection title="Публичные страницы" routes={publicRoutes} />
        <RouteSection title="Fixture-превью" routes={fixtureRoutes} />
        <RouteSection title="Динамические маршруты" routes={dynamicRoutes} />
      </div>
    </main>
  );
}

function RouteSection({ title, routes }: { title: string; routes: DevRoute[] }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xl font-bold tracking-normal">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {routes.map((item) => (
          <RouteItem key={`${title}-${item.path}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function RouteItem({ item }: { item: DevRoute }) {
  const Icon = item.icon;
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white/[0.03] text-[var(--voltflow-cyan)]">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-heading text-base font-bold tracking-normal">
          {item.title}
        </span>
        <span className="mt-1 block break-all text-xs text-muted-foreground">
          {item.path}
        </span>
        {item.description ? (
          <span className="mt-2 block text-xs leading-5 text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </span>
    </>
  );

  if (!item.href) {
    return (
      <div className="flex min-h-24 gap-3 rounded-lg border border-dashed border-border bg-white/[0.02] p-4 opacity-75">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className="flex min-h-24 gap-3 rounded-lg border border-border bg-white/[0.03] p-4 transition hover:border-primary/50 hover:bg-white/[0.05]"
    >
      {content}
    </Link>
  );
}

function route(
  title: string,
  path: string,
  icon: DevRoute["icon"],
  description?: string,
): DevRoute {
  return {
    title,
    path,
    description,
    icon,
    href: `${sitePrefix}${path === "/" ? "" : path}`,
  };
}

function directRoute(title: string, path: string, icon: DevRoute["icon"]): DevRoute {
  return { title, path, icon, href: path };
}

function templateRoute(
  title: string,
  path: string,
  icon: DevRoute["icon"],
): DevRoute {
  return {
    title,
    path,
    icon,
    description: "Нужен реальный id/slug. Откройте из списка сущностей или подставьте значение в адрес /dev/...",
  };
}
