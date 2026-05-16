"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AdminFormState } from "@/actions/knowledge-admin";
import { FieldError, inputClass, Panel, textareaClass } from "@/components/admin/knowledge/ArticleForm";
import { TagsInput } from "@/components/admin/knowledge/TagsInput";
import type { FAQItem, KnowledgeCategory } from "@/types/knowledge";

export function FAQForm({
  item,
  categories,
  action,
}: {
  item?: FAQItem;
  categories: KnowledgeCategory[];
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="max-w-3xl">
      <Panel>
        <FieldError message={state.message} />
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Question</span>
          <input name="question" defaultValue={item?.question ?? ""} className={inputClass} />
          <FieldError message={state.errors?.question} />
        </label>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Answer</span>
          <textarea name="answer" defaultValue={item?.answer ?? ""} className={textareaClass} />
          <FieldError message={state.errors?.answer} />
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
        <TagsInput name="tags" label="Tags" defaultValue={item?.tags} />
        <div className="grid gap-4 md:grid-cols-2">
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
          <Link href="/admin/knowledge/faq" className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold">
            Cancel
          </Link>
        </div>
      </Panel>
    </form>
  );
}
