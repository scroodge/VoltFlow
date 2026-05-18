"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  carGenerationPresets,
  carGenerations,
  type CarGeneration,
} from "@/lib/car-generations";
import { useTranslation } from "@/hooks/use-translation";
import type { Car } from "@/types/database";

type CarFormProps = {
  mode: "create" | "edit";
  car?: Car;
  cancelHref: string;
  isPending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function CarForm({
  mode,
  car,
  cancelHref,
  isPending,
  onSubmit,
}: CarFormProps) {
  const { t } = useTranslation();
  const [generation, setGeneration] = useState<CarGeneration>(
    car?.model_generation ?? "gen1_2024",
  );
  const [battery, setBattery] = useState(
    String(car?.battery_capacity_kwh ?? carGenerationPresets.gen1_2024.battery_capacity_kwh),
  );
  const [chargerPower, setChargerPower] = useState(
    String(
      car?.default_charger_power_kw ??
        carGenerationPresets.gen1_2024.default_charger_power_kw,
    ),
  );
  const [efficiency, setEfficiency] = useState(
    String(
      car?.default_efficiency_percent ??
        carGenerationPresets.gen1_2024.default_efficiency_percent,
    ),
  );

  useEffect(() => {
    if (mode !== "create" || car) return;
    const preset = carGenerationPresets[generation];
    setBattery(String(preset.battery_capacity_kwh));
    setChargerPower(String(preset.default_charger_power_kw));
    setEfficiency(String(preset.default_efficiency_percent));
  }, [car, generation, mode]);

  const generationItems = carGenerations.map((value) => ({
    value,
    label: t(`cars.generation.${value}`) as string,
  }));

  return (
    <Card className="border-white/[0.1] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
      <CardHeader>
        <CardTitle className="text-2xl tracking-tight">
          {mode === "create" ? t("cars.title") : t("cars.editTitle")}
        </CardTitle>
        <p className="text-muted-foreground text-base">
          {mode === "create" ? t("cars.description") : t("cars.editDescription")}
        </p>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-5">
          <div className="space-y-2">
            <Label htmlFor="model_generation">{t("cars.generationLabel")}</Label>
            <input type="hidden" name="model_generation" value={generation} />
            <Select
              value={generation}
              onValueChange={(value) => {
                if (value) setGeneration(value as CarGeneration);
              }}
              items={generationItems}
            >
              <SelectTrigger
                id="model_generation"
                className="min-h-[52px] w-full rounded-2xl text-lg"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {carGenerations.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`cars.generation.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {t(`cars.generationHelp.${generation}`)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{t("cars.nickname")}</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={car?.name}
              placeholder={t("cars.nicknamePlaceholder") as string}
              className="min-h-[52px] rounded-2xl text-lg"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="battery_capacity_kwh">{t("cars.battery")}</Label>
            <Input
              id="battery_capacity_kwh"
              name="battery_capacity_kwh"
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              min={10}
              max={300}
              step="0.1"
              required
              value={battery}
              onChange={(event) => setBattery(event.target.value)}
              className="min-h-[52px] rounded-2xl text-lg"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="default_charger_power_kw">{t("cars.wallbox")}</Label>
              <Input
                id="default_charger_power_kw"
                name="default_charger_power_kw"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[,.]?[0-9]*"
                step="0.1"
                min={1}
                max={300}
                value={chargerPower}
                onChange={(event) => setChargerPower(event.target.value)}
                className="min-h-[52px] rounded-2xl text-lg"
              />
              <p className="text-muted-foreground text-xs">{t("cars.wallboxHelp")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="default_efficiency_percent">{t("cars.efficiency")}</Label>
              <Input
                id="default_efficiency_percent"
                name="default_efficiency_percent"
                type="number"
                inputMode="numeric"
                min={70}
                max={100}
                step="1"
                value={efficiency}
                onChange={(event) => setEfficiency(event.target.value)}
                className="min-h-[52px] rounded-2xl text-lg"
              />
              <p className="text-muted-foreground text-xs">{t("cars.efficiencyHelp")}</p>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 pt-8 sm:flex-row">
          <Button
            variant="outline"
            className="min-h-[52px] w-full rounded-full border-white/20 sm:w-1/2"
            type="button"
            asChild
          >
            <Link href={cancelHref}>{t("common.cancel")}</Link>
          </Button>
          <Button
            className="hover:brightness-110 min-h-[52px] w-full rounded-full text-base font-semibold sm:flex-1"
            type="submit"
            disabled={isPending}
          >
            {isPending
              ? t("common.saving")
              : mode === "create"
                ? t("cars.save")
                : t("cars.update")}
          </Button>
          {isPending ? <Skeleton className="h-[18px] w-full rounded-full" /> : null}
        </CardFooter>
      </form>
    </Card>
  );
}
