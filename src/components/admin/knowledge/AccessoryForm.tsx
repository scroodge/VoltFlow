"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AdminFormState } from "@/actions/knowledge-admin";
import { FieldError, inputClass, Panel, textareaClass } from "@/components/admin/knowledge/ArticleForm";
import { TagsInput } from "@/components/admin/knowledge/TagsInput";
import type { AccessoryItem, KnowledgeCategory } from "@/types/knowledge";

export function AccessoryForm({
  item,
  categories,
  action,
}: {
  item?: AccessoryItem;
  categories: KnowledgeCategory[];
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="max-w-4xl">
      <Panel>
        <FieldError message={state.message} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Title</span>
            <input name="title" defaultValue={item?.title ?? ""} className={inputClass} />
            <FieldError message={state.errors?.title} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Category</span>
            <select name="category_id" defaultValue={item?.category_id ?? ""} className={inputClass}>
              <option value="">Choose category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.title}</option>
              ))}
            </select>
            <FieldError message={state.errors?.category_id} />
          </label>
        </div>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Use case</span>
          <textarea name="use_case" defaultValue={item?.use_case ?? ""} className={textareaClass} />
        </label>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Why useful</span>
          <textarea name="why_useful" defaultValue={item?.why_useful ?? ""} className={textareaClass} />
        </label>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>What to check before buying</span>
          <textarea name="what_to_check" defaultValue={item?.what_to_check.join("\n") ?? ""} className={textareaClass} />
          <span className="text-xs font-normal text-muted-foreground">One item per line.</span>
        </label>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Risk notes</span>
          <textarea name="risk_notes" defaultValue={item?.risk_notes.join("\n") ?? ""} className={textareaClass} />
        </label>
        <TagsInput name="search_keywords" label="Search keywords" defaultValue={item?.search_keywords} />
        <label className="space-y-1.5 text-sm font-semibold">
          <span>External URL</span>
          <input name="external_url" defaultValue={item?.external_url ?? ""} className={inputClass} />
        </label>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Priority</span>
            <select name="priority" defaultValue={item?.priority ?? "useful"} className={inputClass}>
              <option value="must-have">Must-have</option>
              <option value="useful">Useful</option>
              <option value="optional">Optional</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Status</span>
            <select name="status" defaultValue={item?.status ?? "draft"} className={inputClass}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Sort order</span>
            <input name="sort_order" type="number" defaultValue={item?.sort_order ?? 0} className={inputClass} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={pending} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {pending ? "Saving..." : "Save"}
          </button>
          <Link href="/admin/knowledge/accessories" className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold">
            Cancel
          </Link>
        </div>
      </Panel>
    </form>
  );
}
