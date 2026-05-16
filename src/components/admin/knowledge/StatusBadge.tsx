import type { ArticleStatus } from "@/types/knowledge";

export function StatusBadge({ status }: { status: ArticleStatus }) {
  const styles: Record<ArticleStatus, string> = {
    draft: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    published: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    archived: "border-slate-300/30 bg-slate-300/10 text-slate-200",
  };

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${styles[status]}`}>
      {status}
    </span>
  );
}
