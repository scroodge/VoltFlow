"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n";
import {
  useDeleteUserServiceCategoryMutation,
  useInsertUserServiceCategoryMutation,
  useUserServiceCategoriesQuery,
} from "@/hooks/use-service-categories";
import { BUILT_IN_SERVICE_CATEGORIES } from "@/types/service";

export function CategoryManager({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: userCategories = [], isLoading } = useUserServiceCategoriesQuery();
  const insertMutation = useInsertUserServiceCategoryMutation();
  const deleteMutation = useDeleteUserServiceCategoryMutation();
  const [newName, setNewName] = useState("");

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    const exists = [...BUILT_IN_SERVICE_CATEGORIES, ...userCategories.map((c) => c.name)]
      .some((n) => n.toLowerCase() === trimmed.toLowerCase());
    if (exists) return;

    insertMutation.mutate(trimmed, {
      onSuccess: () => setNewName(""),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="safe-bottom flex max-h-dvh flex-col p-0"
      >
        <DialogHeader className="flex flex-row items-center justify-between px-6 pt-6">
          <DialogTitle className="font-heading text-xl font-bold">
            {t("service.manageCategories") as string}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 pb-6">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("service.newCategoryPlaceholder") as string}
              className="min-h-11 flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Button
              type="button"
              size="lg"
              className="min-h-11 shrink-0"
              disabled={!newName.trim() || insertMutation.isPending}
              onClick={handleAdd}
            >
              <Plus className="size-5" />
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("service.builtInCategories") as string}
            </p>
            <div className="flex flex-wrap gap-2">
              {BUILT_IN_SERVICE_CATEGORIES.map((cat) => (
                <span
                  key={cat}
                  className="rounded-full border border-white/[0.08] px-3 py-1 text-xs text-muted-foreground"
                >
                  {(t(`service.category.${cat}` as TranslationKey) as string) || cat}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("service.myCategories") as string}
            </p>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : userCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("service.noCustomCategories") as string}
              </p>
            ) : (
              <div className="space-y-2">
                {userCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="font-heading font-semibold">{cat.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(cat.id)}
                      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-400/10 hover:text-red-400"
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
