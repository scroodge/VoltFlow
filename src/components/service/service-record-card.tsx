"use client";

import { useId, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/hooks/use-translation";
import { formatCurrencyAmount } from "@/lib/i18n";
import type { Currency, Locale, TranslationKey } from "@/lib/i18n";
import type { ServiceRecordRow } from "@/types/service";

const CATEGORY_DOT: Record<string, string> = {
  tires: "bg-blue-400",
  brakes: "bg-red-400",
  battery_12v: "bg-yellow-400",
  battery_hv: "bg-green-400",
  coolant: "bg-cyan-400",
  cabin_filter: "bg-purple-400",
  wipers: "bg-slate-400",
  washer_fluid: "bg-sky-400",
  hvac: "bg-orange-400",
  electrical: "bg-amber-400",
  suspension: "bg-pink-400",
  charging_port: "bg-emerald-400",
  software: "bg-indigo-400",
  inspection: "bg-teal-400",
  registration: "bg-violet-400",
  insurance: "bg-rose-400",
  detailing: "bg-lime-400",
  parts_purchase: "bg-orange-300",
  other: "bg-gray-400",
};

function categoryDot(cat: string) {
  return CATEGORY_DOT[cat] ?? "bg-gray-400";
}

function fmtKm(v: number | null | undefined) {
  if (v == null) return null;
  return `${Math.round(v).toLocaleString()} km`;
}

function shortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ServiceRecordCard({
  record,
  currency,
  locale,
  onEdit,
  onDelete,
}: {
  record: ServiceRecordRow;
  currency: Currency;
  locale: Locale;
  onEdit: (r: ServiceRecordRow) => void;
  onDelete: (id: string) => void;
}) {
  const id = useId();
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const total = record.total_cost > 0 ? record.total_cost : record.parts_cost + record.labor_cost;

  return (
    <>
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={`mt-2 size-2.5 shrink-0 rounded-full ${categoryDot(record.category)}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate font-heading font-semibold">{record.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {shortDate(record.performed_date)}
                {record.odometer_km != null ? ` · ${fmtKm(record.odometer_km)}` : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => onEdit(record)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
              aria-label={t("service.edit") as string}
            >
              <Pencil className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-red-400/10 hover:text-red-400"
              aria-label={t("service.delete") as string}
            >
              <Trash2 className="size-5" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          {record.parts_cost > 0 && (
            <div>
              <span className="text-muted-foreground">{t("service.form.partsCost") as string}</span>
              <p className="font-semibold">
                {formatCurrencyAmount(currency, record.parts_cost, locale)}
              </p>
            </div>
          )}
          {record.labor_cost > 0 && (
            <div>
              <span className="text-muted-foreground">{t("service.form.laborCost") as string}</span>
              <p className="font-semibold">
                {formatCurrencyAmount(currency, record.labor_cost, locale)}
              </p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">{t("service.form.totalCost") as string}</span>
            <p className="font-semibold text-[var(--voltflow-green)]">
              {formatCurrencyAmount(currency, total, locale)}
            </p>
          </div>
        </div>

        {record.vendor_name && (
          <p className="mt-2 text-xs text-muted-foreground">
            {record.vendor_name}
            {record.vendor_location ? ` · ${record.vendor_location}` : ""}
          </p>
        )}

        {record.notes && (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground/80">
            {record.notes}
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t(`service.category.${record.category}` as TranslationKey) || record.category}
          </span>
          <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t(`service.type.${record.service_type}` as TranslationKey) || record.service_type}
          </span>
        </div>
      </div>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="safe-bottom">
          <DialogHeader>
            <DialogTitle>{t("service.form.deleteTitle") as string}</DialogTitle>
            <DialogDescription>
              {t("service.form.deleteBody") as string}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              size="lg"
              className="min-h-11"
              onClick={() => setShowDelete(false)}
            >
              {t("common.cancel") as string}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="min-h-11"
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                onDelete(record.id);
              }}
            >
              {t("service.delete") as string}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
