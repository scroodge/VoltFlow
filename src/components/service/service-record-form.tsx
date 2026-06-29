"use client";

import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/use-translation";
import { useUserServiceCategoriesQuery } from "@/hooks/use-service-categories";
import type { TranslationKey } from "@/lib/i18n";
import {
  BUILT_IN_SERVICE_CATEGORIES,
  SERVICE_TYPES,
  type ServiceRecordRow,
} from "@/types/service";

interface FormData {
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
}

export function ServiceRecordForm({
  open,
  onOpenChange,
  record,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: ServiceRecordRow | null;
  onSave: (data: FormData) => void;
  saving: boolean;
}) {
  const id = useId();
  const { t } = useTranslation();
  const { data: userCategories = [] } = useUserServiceCategoriesQuery();
  const isEdit = record !== null;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      title: "",
      category: "other",
      serviceType: "maintenance",
      performedDate: new Date().toISOString().split("T")[0],
      odometerKm: "",
      partsCost: "",
      laborCost: "",
      totalCost: "",
      vendorName: "",
      vendorLocation: "",
      notes: "",
      nextDueDate: "",
      nextDueKm: "",
    },
  });

  useEffect(() => {
    if (open) {
      if (record) {
        reset({
          title: record.title,
          category: record.category,
          serviceType: record.service_type,
          performedDate: record.performed_date.split("T")[0],
          odometerKm: record.odometer_km != null ? String(record.odometer_km) : "",
          partsCost: record.parts_cost > 0 ? String(record.parts_cost) : "",
          laborCost: record.labor_cost > 0 ? String(record.labor_cost) : "",
          totalCost: record.total_cost > 0 ? String(record.total_cost) : "",
          vendorName: record.vendor_name ?? "",
          vendorLocation: record.vendor_location ?? "",
          notes: record.notes ?? "",
          nextDueDate: record.next_due_date ?? "",
          nextDueKm: record.next_due_km != null ? String(record.next_due_km) : "",
        });
      } else {
        reset({
          title: "",
          category: "other",
          serviceType: "maintenance",
          performedDate: new Date().toISOString().split("T")[0],
          odometerKm: "",
          partsCost: "",
          laborCost: "",
          totalCost: "",
          vendorName: "",
          vendorLocation: "",
          notes: "",
          nextDueDate: "",
          nextDueKm: "",
        });
      }
    }
  }, [open, record, reset]);

  const partsCost = watch("partsCost");
  const laborCost = watch("laborCost");
  const totalCost = watch("totalCost");

  const autoTotal =
    !totalCost && partsCost && laborCost
      ? Number(partsCost) + Number(laborCost)
      : null;
  const builtInOptions = BUILT_IN_SERVICE_CATEGORIES.map((value) => ({
    value,
    label: (t(`service.category.${value}` as TranslationKey) || value) as string,
  }));
  const userOptions = userCategories.map((c) => ({
    value: c.name,
    label: c.name,
    color: c.color,
  }));
  const categoryOptions = [...builtInOptions, ...userOptions];
  const serviceTypeOptions = SERVICE_TYPES.map((value) => ({
    value,
    label: (t(`service.type.${value}` as TranslationKey) || value) as string,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="safe-bottom flex max-h-dvh flex-col p-0"
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="font-heading text-xl font-bold">
            {isEdit
              ? (t("service.edit") as string)
              : (t("service.add") as string)}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
          <form
            id={`${id}-form`}
            onSubmit={handleSubmit(onSave)}
            className="space-y-5"
          >
            <Field>
              <Label htmlFor={`${id}-title`}>{t("service.form.title") as string} *</Label>
              <Input
                id={`${id}-title`}
                placeholder={t("service.form.title") as string}
                {...register("title", { required: "Required" })}
                className="min-h-11"
              />
              {errors.title && (
                <p className="text-xs text-red-400">{errors.title.message}</p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label>{t("service.form.category") as string}</Label>
                <Select
                  value={watch("category")}
                  onValueChange={(v) => v && setValue("category", v)}
                  items={categoryOptions}
                >
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{t("service.builtInCategories") as string}</SelectLabel>
                      {builtInOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {userOptions.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{t("service.myCategories") as string}</SelectLabel>
                        {userOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span
                              className="mr-2 inline-block size-2 rounded-full"
                              style={{ backgroundColor: option.color }}
                            />
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <Label>{t("service.form.serviceType") as string}</Label>
                <Select
                  value={watch("serviceType")}
                  onValueChange={(v) => v && setValue("serviceType", v)}
                  items={serviceTypeOptions}
                >
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label>{t("service.form.date") as string} *</Label>
                <Input
                  type="date"
                  value={watch("performedDate")}
                  onChange={(e) => setValue("performedDate", e.target.value)}
                  className="min-h-11"
                />
              </Field>
              <Field>
                <Label>{t("service.form.odometer") as string}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="km"
                  {...register("odometerKm")}
                  className="min-h-11"
                />
              </Field>
            </div>

            <fieldset className="space-y-3 rounded-xl border border-white/[0.08] p-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Costs
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label>{t("service.form.partsCost") as string}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    {...register("partsCost")}
                    className="min-h-11"
                  />
                </Field>
                <Field>
                  <Label>{t("service.form.laborCost") as string}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    {...register("laborCost")}
                    className="min-h-11"
                  />
                </Field>
              </div>
              <Field>
                <Label>
                  {t("service.form.totalCost") as string}
                  {autoTotal !== null && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      (auto: {autoTotal.toFixed(2)})
                    </span>
                  )}
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder={autoTotal?.toFixed(2) ?? "0.00"}
                  {...register("totalCost")}
                  className="min-h-11"
                />
              </Field>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label>{t("service.form.vendorName") as string}</Label>
                <Input
                  placeholder={t("service.form.vendorName") as string}
                  {...register("vendorName")}
                  className="min-h-11"
                />
              </Field>
              <Field>
                <Label>{t("service.form.vendorLocation") as string}</Label>
                <Input
                  placeholder={t("service.form.vendorLocation") as string}
                  {...register("vendorLocation")}
                  className="min-h-11"
                />
              </Field>
            </div>

            <Field>
              <Label>{t("service.form.notes") as string}</Label>
              <textarea
                rows={3}
                placeholder={t("service.form.notes") as string}
                {...register("notes")}
                className="min-h-[88px] w-full rounded-xl border border-border bg-[#12151C]/70 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </Field>

            <div className="border-t border-white/[0.08] pt-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t("service.form.nextDueDate") as string}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label>{t("service.form.nextDueDate") as string}</Label>
                  <Input
                    type="date"
                    value={watch("nextDueDate")}
                    onChange={(e) => setValue("nextDueDate", e.target.value)}
                    className="min-h-11"
                  />
                </Field>
                <Field>
                  <Label>{t("service.form.nextDueKm") as string}</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="km"
                    {...register("nextDueKm")}
                    className="min-h-11"
                  />
                </Field>
              </div>
            </div>
          </form>
        </div>

        <div className="safe-bottom flex items-center justify-end gap-3 border-t border-white/[0.08] px-6 py-4">
          <Button
            variant="outline"
            size="lg"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel") as string}
          </Button>
          <Button
            type="submit"
            form={`${id}-form`}
            size="lg"
            className="min-h-11"
            disabled={saving}
          >
            {saving
              ? (t("service.form.updating") as string)
              : (t("service.form.save") as string)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}
