"use client";

import { useActionState, useState } from "react";

import type { AdminFormState } from "@/actions/knowledge-admin";
import { FieldError, inputClass, Panel, textareaClass } from "@/components/admin/knowledge/ArticleForm";
import type { KnowledgeCategory } from "@/types/knowledge";

export function CategoryForm({
  category,
  action,
}: {
  category?: KnowledgeCategory;
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [title, setTitle] = useState(category?.title ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(category?.slug));

  return (
    <form action={formAction}>
      <Panel>
        {category ? <input type="hidden" name="id" value={category.id} /> : null}
        <FieldError message={state.message} />
        {state.ok ? <p className="text-sm font-semibold text-emerald-200">{state.message}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Title</span>
            <input
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
              className={inputClass}
            />
            <FieldError message={state.errors?.title} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Slug</span>
            <input
              name="slug"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              className={inputClass}
            />
            <FieldError message={state.errors?.slug} />
          </label>
        </div>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Description</span>
          <textarea name="description" defaultValue={category?.description ?? ""} className={textareaClass} />
        </label>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Sort order</span>
          <input name="sort_order" type="number" defaultValue={category?.sort_order ?? 0} className={inputClass} />
        </label>
        <button disabled={pending} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60">
          {pending ? "Saving..." : category ? "Update category" : "Create category"}
        </button>
      </Panel>
    </form>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
