import { ExternalLink } from "lucide-react";

import { ShareLinkButton } from "@/components/telegram/ShareLinkButton";

type ExternalLinkItem = { label: string; url: string };

export function ExternalLinksShare({
  links,
  title,
}: {
  links: readonly ExternalLinkItem[];
  title: string;
}) {
  return links.length ? (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <a
          key={`${link.label}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--voltflow-cyan)]/40 bg-[var(--voltflow-cyan)]/10 px-4 text-sm font-bold text-[var(--voltflow-cyan)] transition hover:bg-[var(--voltflow-cyan)]/15"
        >
          {link.label}
          <ExternalLink className="size-4" aria-hidden />
        </a>
      ))}
      <span className="ml-auto">
        <ShareLinkButton title={title} />
      </span>
    </div>
  ) : (
    <div className="mt-6 flex justify-end">
      <ShareLinkButton title={title} />
    </div>
  );
}
