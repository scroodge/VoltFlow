"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { AdminFormState } from "@/actions/knowledge-admin";
import { JsonSectionsEditor } from "@/components/admin/knowledge/JsonSectionsEditor";
import { TagsInput } from "@/components/admin/knowledge/TagsInput";
import type { KnowledgeArticle, KnowledgeCategory } from "@/types/knowledge";

type ArticleFormProps = {
  article?: KnowledgeArticle;
  categories: KnowledgeCategory[];
  articles: KnowledgeArticle[];
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
};

export function ArticleForm({ article, categories, articles, action }: ArticleFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(article?.slug));

  return (
    <form action={formAction} className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <Panel>
          <FieldError message={state.message} />
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
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Summary</span>
            <textarea name="summary" defaultValue={article?.summary ?? ""} className={textareaClass} />
          </label>
          <JsonSectionsEditor defaultValue={article?.content} error={state.errors?.content} />
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Tips</span>
            <textarea name="tips" defaultValue={article?.tips.join("\n") ?? ""} className={textareaClass} />
            <span className="text-xs font-normal text-muted-foreground">One tip per line.</span>
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Warnings</span>
            <textarea name="warnings" defaultValue={article?.warnings.join("\n") ?? ""} className={textareaClass} />
            <span className="text-xs font-normal text-muted-foreground">One warning per line.</span>
          </label>
        </Panel>
      </div>

      <aside className="space-y-4">
        <Panel>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Status</span>
            <select name="status" defaultValue={article?.status ?? "draft"} className={inputClass}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
            <FieldError message={state.errors?.status} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Category</span>
            <select name="category_id" defaultValue={article?.category_id ?? ""} className={inputClass}>
              <option value="">Choose category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.title}</option>
              ))}
            </select>
            <FieldError message={state.errors?.category_id} />
          </label>
          <TagsInput name="tags" label="Tags" defaultValue={article?.tags} />
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Source label</span>
            <input name="source_label" defaultValue={article?.source_label ?? ""} className={inputClass} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Sort order</span>
            <input name="sort_order" type="number" defaultValue={article?.sort_order ?? 0} className={inputClass} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Related articles</span>
            <select
              name="related_article_ids"
              multiple
              defaultValue={article?.related_article_ids ?? []}
              className="min-h-40 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              {articles
                .filter((item) => item.id !== article?.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 pt-2">
            <button disabled={pending} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60">
              {pending ? "Saving..." : "Save"}
            </button>
            <Link href="/admin/knowledge/articles" className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold">
              Cancel
            </Link>
          </div>
        </Panel>
      </aside>
    </form>
  );
}

export const inputClass =
  "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
export const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

export function Panel({ children }: { children: React.ReactNode }) {
  return <section className="space-y-4 rounded-lg border border-border bg-card p-4">{children}</section>;
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs font-semibold text-destructive">{message}</p> : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
