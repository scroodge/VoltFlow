"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

export function ShareLinkButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;

    if (navigator.share) {
      await navigator.share({ title, url });
      return;
    }

    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--voltflow-cyan)]/40 bg-[var(--voltflow-cyan)]/10 px-4 text-sm font-bold text-[var(--voltflow-cyan)] transition hover:bg-[var(--voltflow-cyan)]/15"
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
      {copied ? "Ссылка скопирована" : "Поделиться"}
    </button>
  );
}
