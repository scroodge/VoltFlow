"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { KnowledgeArticleSection } from "@/types/knowledge";

export function JsonSectionsEditor({
  defaultValue = [{ heading: "", body: "" }],
  error,
}: {
  defaultValue?: KnowledgeArticleSection[];
  error?: string;
}) {
  const [sections, setSections] = useState(
    defaultValue.length ? defaultValue : [{ heading: "", body: "" }],
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Content sections</p>
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
      {sections.map((section, index) => (
        <div key={index} className="rounded-lg border border-border bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Section {index + 1}
            </p>
            <button
              type="button"
              onClick={() =>
                setSections((items) => items.filter((_, itemIndex) => itemIndex !== index))
              }
              className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
              aria-label="Remove section"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <input
            name="content_heading"
            defaultValue={section.heading}
            className="mt-3 min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            placeholder="Heading"
          />
          <textarea
            name="content_body"
            defaultValue={section.body}
            className="mt-3 min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            placeholder="Body"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => setSections((items) => [...items, { heading: "", body: "" }])}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-[var(--voltflow-cyan)]"
      >
        <Plus className="size-4" aria-hidden />
        Add section
      </button>
    </div>
  );
}
