"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

export function AnalyticsSortableCard({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={label}
      className={
        "relative select-none rounded-2xl outline-offset-2 " +
        (isDragging
          ? "z-10 opacity-90 outline outline-2 outline-primary"
          : "outline outline-1 outline-primary/25")
      }
    >
      <div
        className="pointer-events-none absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full border border-primary/40 bg-background/80 text-primary"
        aria-hidden
      >
        <GripVertical className="size-4" />
      </div>
      {children}
    </div>
  );
}
