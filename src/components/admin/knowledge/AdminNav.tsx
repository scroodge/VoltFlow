import Link from "next/link";

const navItems = [
  { href: "/admin/knowledge", label: "Обзор" },
  { href: "/admin/knowledge/articles", label: "Статьи" },
  { href: "/admin/knowledge/faq", label: "Вопросы" },
  { href: "/admin/knowledge/accessories", label: "Аксессуары" },
  { href: "/admin/knowledge/spare-parts", label: "Запчасти" },
  { href: "/admin/knowledge/service-providers", label: "Сервис" },
  { href: "/admin/knowledge/categories", label: "Разделы" },
];

export function AdminNav() {
  return (
    <nav
      className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
      aria-label="Админка базы знаний"
    >
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-border bg-white/[0.04] px-3 text-sm font-semibold text-muted-foreground transition hover:border-[var(--voltflow-cyan)]/60 hover:text-foreground"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
