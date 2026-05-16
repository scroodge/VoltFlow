import Link from "next/link";

const navItems = [
  { href: "/admin/knowledge", label: "Overview" },
  { href: "/admin/knowledge/articles", label: "Articles" },
  { href: "/admin/knowledge/faq", label: "FAQ" },
  { href: "/admin/knowledge/accessories", label: "Accessories" },
  { href: "/admin/knowledge/categories", label: "Categories" },
];

export function AdminNav() {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Knowledge admin">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="inline-flex min-h-9 items-center rounded-lg border border-border bg-white/[0.04] px-3 text-sm font-semibold text-muted-foreground transition hover:border-[var(--voltflow-cyan)]/60 hover:text-foreground"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
