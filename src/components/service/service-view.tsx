"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Settings2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ServiceRecordCard } from "@/components/service/service-record-card";
import { ServiceRecordForm } from "@/components/service/service-record-form";
import { CategoryManager } from "@/components/service/category-manager";
import { ServiceStats } from "@/components/service/service-stats";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n";
import { useCarsQuery } from "@/hooks/use-cars-query";
import {
  useDeleteServiceRecordMutation,
  useInsertServiceRecordMutation,
  useServiceRecordsQuery,
} from "@/hooks/use-service-records";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { ServiceRecordRow } from "@/types/service";

type ViewTab = "timeline" | "categories" | "stats";

function TabToggle({
  active,
  onChange,
}: {
  active: ViewTab;
  onChange: (tab: ViewTab) => void;
}) {
  const { t } = useTranslation();
  const tabs: { id: ViewTab; label: string }[] = [
    { id: "timeline", label: t("service.tab.timeline") as string },
    { id: "categories", label: t("service.tab.categories") as string },
    { id: "stats", label: t("service.tab.stats") as string },
  ];

  return (
    <div className="flex rounded-full border border-border bg-white/[0.03] p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={[
            "flex-1 rounded-full py-1.5 font-heading text-sm font-semibold transition",
            active === tab.id
              ? "bg-primary text-[#06110B]"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <Wrench className="mb-4 size-12 text-muted-foreground/40" />
      <p className="font-heading text-lg font-bold">{t("service.emptyTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("service.emptyBody")}</p>
    </div>
  );
}

export function ServiceView() {
  const { t } = useTranslation();
  const { data: carsData } = useCarsQuery();
  const cars = carsData?.cars ?? [];
  const preferredCarId = carsData?.preferredCarId ?? null;
  const selectedCarId = useAppPreferences((s) => s.selectedCarId);
  const setSelectedCarId = useAppPreferences((s) => s.setSelectedCarId);
  const currency = useAppPreferences((s) => s.currency);
  const locale = useAppPreferences((s) => s.locale);

  useEffect(() => {
    const exists = cars.some((c) => c.id === selectedCarId);
    if (!exists && cars.length > 0 && preferredCarId) {
      setSelectedCarId(preferredCarId);
    } else if (!exists && cars.length > 0) {
      setSelectedCarId(cars[0].id);
    }
  }, [cars, preferredCarId, selectedCarId, setSelectedCarId]);

  const activeCarId = useMemo(() => {
    if (!selectedCarId && cars.length > 0) return cars[0].id;
    const exists = cars.some((c) => c.id === selectedCarId);
    return exists ? selectedCarId : cars[0]?.id ?? null;
  }, [cars, selectedCarId]);

  const { data: records = [], isLoading } = useServiceRecordsQuery(activeCarId);
  const insertMutation = useInsertServiceRecordMutation();
  const deleteMutation = useDeleteServiceRecordMutation();

  const [viewTab, setViewTab] = useState<ViewTab>("timeline");
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ServiceRecordRow | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const handleSave = (data: {
    title: string;
    category: string;
    serviceType: string;
    performedDate: string;
    odometerKm: string;
    partsCost: string;
    laborCost: string;
    totalCost: string;
    vendorName: string;
    vendorLocation: string;
    notes: string;
    nextDueDate: string;
    nextDueKm: string;
  }) => {
    if (!activeCarId) return;
    insertMutation.mutate(
      {
        carId: activeCarId,
        title: data.title,
        category: data.category,
        serviceType: data.serviceType,
        performedDate: data.performedDate,
        odometerKm: data.odometerKm ? Number(data.odometerKm) : undefined,
        vendorName: data.vendorName || undefined,
        vendorLocation: data.vendorLocation || undefined,
        partsCost: data.partsCost ? Number(data.partsCost) : 0,
        laborCost: data.laborCost ? Number(data.laborCost) : 0,
        totalCost: data.totalCost ? Number(data.totalCost) : 0,
        currency,
        notes: data.notes || undefined,
        nextDueDate: data.nextDueDate || undefined,
        nextDueKm: data.nextDueKm ? Number(data.nextDueKm) : undefined,
      },
      {
        onSuccess: () => {
          setFormOpen(false);
          setEditingRecord(null);
        },
      },
    );
  };

  const handleDelete = (id: string) => {
    if (!activeCarId) return;
    deleteMutation.mutate({ id, carId: activeCarId });
  };

  const handleEdit = (record: ServiceRecordRow) => {
    setEditingRecord(record);
    setFormOpen(true);
  };

  const categoryGroups = useMemo(() => {
    const map = new Map<string, ServiceRecordRow[]>();
    for (const r of records) {
      const existing = map.get(r.category) ?? [];
      existing.push(r);
      map.set(r.category, existing);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [records]);

  return (
    <div className="flex flex-1 flex-col px-6 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("service.eyebrow") as string}
          </p>
          <h1 className="font-heading text-2xl font-bold">
            {t("service.title") as string}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setCategoriesOpen(true)}
            className="size-11 rounded-full p-0"
            aria-label={t("service.manageCategories") as string}
          >
            <Settings2 className="size-5" />
          </Button>
          <Button
            onClick={() => {
              setEditingRecord(null);
              setFormOpen(true);
            }}
            className="size-11 rounded-full p-0"
            aria-label={t("service.add") as string}
          >
            <Plus className="size-5" />
          </Button>
        </div>
      </div>

      {cars.length > 1 && (
        <div className="mb-4">
          <Select
            value={activeCarId ?? undefined}
            onValueChange={(value) => value && setSelectedCarId(value)}
          >
            <SelectTrigger className="min-h-11 rounded-xl border-border bg-[#12151C]/70 text-sm">
              <SelectValue placeholder={t("dashboard.chooseCar") as string} />
            </SelectTrigger>
            <SelectContent>
              {cars.map((car) => (
                <SelectItem key={car.id} value={car.id}>
                  <div className="flex flex-col text-left leading-tight">
                    <span className="font-medium">{car.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {car.battery_capacity_kwh} kWh · {car.default_charger_power_kw} kW
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="mb-5">
        <TabToggle active={viewTab} onChange={setViewTab} />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : viewTab === "stats" ? (
        <ServiceStats records={records} currency={currency} locale={locale} />
      ) : viewTab === "categories" ? (
        <div className="flex-1 space-y-3 overflow-y-auto pb-24 overscroll-contain">
          {categoryGroups.length === 0 ? (
            <EmptyState />
          ) : (
            categoryGroups.map(([cat, catRecords]) => (
              <button
                key={cat}
                type="button"
                onClick={() => setViewTab("timeline")}
                className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-heading font-semibold">
                    {t(`service.category.${cat}` as TranslationKey) || cat}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {catRecords.length} · {catRecords.reduce((s, r) => s + (r.total_cost > 0 ? r.total_cost : r.parts_cost + r.labor_cost), 0).toFixed(2)} {currency}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {catRecords.slice(0, 5).map((r) => (
                    <span
                      key={r.id}
                      className="truncate rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {r.title}
                    </span>
                  ))}
                  {catRecords.length > 5 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{catRecords.length - 5}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      ) : records.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto pb-24 overscroll-contain">
          {records.map((record) => (
            <ServiceRecordCard
              key={record.id}
              record={record}
              currency={currency}
              locale={locale}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <ServiceRecordForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingRecord(null);
        }}
        record={editingRecord}
        onSave={handleSave}
        saving={insertMutation.isPending}
      />

      <CategoryManager
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
      />
    </div>
  );
}
