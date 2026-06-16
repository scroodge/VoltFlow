"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";

import type { LegalDocument } from "@/content/legal/types";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils";
import type { LegalDocumentType, LegalRegion } from "@/lib/legal-region";

type LegalDocumentViewProps = {
  document: LegalDocumentType;
  region: LegalRegion;
  contentByLocale: Record<"en" | "be" | "ru", LegalDocument>;
  operatorEmail: string;
};

export function LegalDocumentView({
  document: _document,
  region: _region,
  contentByLocale,
  operatorEmail,
}: LegalDocumentViewProps) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const content = contentByLocale[locale];

  return (
    <div className="mobile-page relative min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-white/[0.08] bg-background/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("legal.back")}
          </button>
          <LocaleSwitcher className="shrink-0 scale-90" />
        </div>
        <h1 className="mt-3 text-balance text-lg font-semibold tracking-tight">
          {content.title}
        </h1>
      </header>

      <article className="space-y-5 px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        {content.sections.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-sm font-semibold tracking-tight">{section.title}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p
                key={paragraph}
                className="text-sm leading-relaxed text-muted-foreground"
              >
                {paragraph}
              </p>
            ))}
            {section.bullets?.length ? (
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <footer className="border-t border-white/[0.08] pt-4 text-xs leading-relaxed text-muted-foreground">
          <p>
            {t("legal.lastUpdated", {
              date: new Date(content.updatedAt).toLocaleDateString(),
            })}
          </p>
          <p className="mt-2">
            {t("legal.contact")}{" "}
            <a
              href={`mailto:${operatorEmail}`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              {operatorEmail}
            </a>
          </p>
        </footer>
      </article>
    </div>
  );
}

export function LegalFooterLinks({ className }: { className?: string }) {
  const { t } = useTranslation();

  const links = [
    { href: "/legal/privacy/world", label: t("settings.legal.privacy") },
    { href: "/legal/terms/world", label: t("settings.legal.terms") },
  ] as const;

  return (
    <nav className={cn("flex flex-wrap justify-center gap-x-3 gap-y-1", className)}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function LegalSettingsRow({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.03]"
    >
      <span className="truncate">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
