"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { AccessoryExternalLink } from "@/types/knowledge";

export function ExternalLinksEditor({
  defaultValue = [],
}: {
  defaultValue?: AccessoryExternalLink[];
}) {
  const [links, setLinks] = useState(
    defaultValue.length ? defaultValue : [{ label: "", url: "" }],
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Ссылки на товары</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Можно добавить несколько магазинов или вариантов товара.
        </p>
      </div>
      {links.map((link, index) => (
        <div key={index} className="grid gap-2 rounded-lg border border-border bg-white/[0.03] p-3 md:grid-cols-[1fr_1.5fr_auto]">
          <input
            name="external_link_label"
            defaultValue={link.label}
            placeholder="Название ссылки"
            className="min-h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
          <input
            name="external_link_url"
            defaultValue={link.url}
            placeholder="https://..."
            className="min-h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
          <button
            type="button"
            onClick={() => setLinks((items) => items.filter((_, itemIndex) => itemIndex !== index))}
            className="grid size-10 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
            aria-label="Удалить ссылку"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setLinks((items) => [...items, { label: "", url: "" }])}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-[var(--voltflow-cyan)]"
      >
        <Plus className="size-4" aria-hidden />
        Добавить ссылку
      </button>
    </div>
  );
}
