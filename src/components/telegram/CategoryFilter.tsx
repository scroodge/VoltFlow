import { cn } from "@/lib/utils";

type CategoryFilterProps<T extends string> = {
  categories: readonly T[];
  activeCategory: T | "All";
  onChange: (category: T | "All") => void;
  labels?: Partial<Record<T | "All", string>>;
};

export function CategoryFilter<T extends string>({
  categories,
  activeCategory,
  onChange,
  labels,
}: CategoryFilterProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {(["All", ...categories] as Array<T | "All">).map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => onChange(category)}
          className={cn(
            "min-h-10 rounded-full border px-4 text-sm font-semibold transition",
            activeCategory === category
              ? "border-[var(--voltflow-green)] bg-[var(--voltflow-green)] text-[#06110B]"
              : "border-border bg-white/[0.03] text-muted-foreground",
          )}
        >
          {labels?.[category] ?? (category === "All" ? "Все" : category)}
        </button>
      ))}
    </div>
  );
}
