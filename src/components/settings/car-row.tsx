"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { deleteCar } from "@/actions/cars";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPath } from "@/lib/dev/dev-path";
import type { TranslationKey } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";
import {
  auxBatteryChemistries,
  deriveAuxBatteryChemistry,
  type AuxBatteryChemistry,
} from "@/lib/vehicle/aux-battery-chemistry";
import type { Car } from "@/types/database";

export function CarRow({ car }: { car: Car }) {
  const { t } = useTranslation();
  const appPath = useAppPath();
  const qc = useQueryClient();
  const [chemistrySaving, setChemistrySaving] = useState(false);
  const generationLabel = t(
    `cars.generation.${car.model_generation}`,
  ) as string;
  const derivedChemistry = deriveAuxBatteryChemistry(car.model_generation);

  const handleChemistryChange = async (value: string | null) => {
    if (value == null) return;
    const batteryChemistry =
      value === "auto" ? null : (value as AuxBatteryChemistry);
    setChemistrySaving(true);
    const { error } = await createClient()
      .from("cars")
      .update({ battery_chemistry: batteryChemistry })
      .eq("id", car.id)
      .eq("user_id", car.user_id);
    setChemistrySaving(false);
    if (error) {
      toast.error(t("settings.auxBattery.saveError") as string);
      return;
    }
    await qc.invalidateQueries({ queryKey: queryKeys.cars });
    toast.success(t("settings.auxBattery.saved") as string);
  };

  const handleDelete = async () => {
    if (!confirm(t("settings.removeConfirm", { name: car.name }) as string))
      return;
    const res = await deleteCar(car.id);
    if (!res.ok) {
      toast.error(
        typeof res.error === "string"
          ? res.error
          : (t("settings.deleteError") as string),
      );
      return;
    }
    toast.success(t("settings.removed", { name: car.name }) as string);
  };

  return (
    <div className="border-white/[0.08] flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white/[0.02] px-4 py-3.5">
      <div className="min-w-[16rem] flex-1">
        <p className="text-base font-semibold tracking-tight">{car.name}</p>
        <p className="text-muted-foreground text-sm">{generationLabel}</p>
        <p className="text-muted-foreground text-sm">
          {t("settings.pedestal", {
            battery: car.battery_capacity_kwh,
            power: car.default_charger_power_kw,
          })}
        </p>
        <div className="mt-3 max-w-sm space-y-1.5">
          <Label htmlFor={`battery-chemistry-${car.id}`}>
            {t("settings.auxBattery.label")}
          </Label>
          <Select
            value={car.battery_chemistry ?? "auto"}
            onValueChange={(value) => void handleChemistryChange(value)}
            disabled={chemistrySaving}
          >
            <SelectTrigger
              id={`battery-chemistry-${car.id}`}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {t("settings.auxBattery.derived", {
                  chemistry: t(
                    `settings.auxBattery.options.${derivedChemistry}` as TranslationKey,
                  ) as string,
                })}
              </SelectItem>
              {auxBatteryChemistries.map((chemistry) => (
                <SelectItem key={chemistry} value={chemistry}>
                  {t(
                    `settings.auxBattery.options.${chemistry}` as TranslationKey,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("settings.auxBattery.help")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="lg"
          className="h-9 rounded-full px-4 text-xs"
          asChild
        >
          <Link href={appPath(`/cars/${car.id}/edit`)}>
            <Pencil className="mr-2 size-4" aria-hidden />
            {t("settings.edit")}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="h-9 rounded-full px-4 text-xs"
          type="button"
          onClick={() => void handleDelete()}
        >
          {t("settings.remove")}
        </Button>
      </div>
    </div>
  );
}
