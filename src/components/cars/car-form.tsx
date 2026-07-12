"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";

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
import { useAppPreferences } from "@/stores/use-app-preferences";
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
  const onboardingCarGeneration = useAppPreferences(
    (s) => s.onboardingCarGeneration,
  );
  // New cars default to the generation declared during onboarding; without one
  // we keep the historical gen1_2024 default.
  const initialGeneration =
    car?.model_generation ?? onboardingCarGeneration ?? "gen1_2024";
  const initialPreset = carGenerationPresets[initialGeneration];
  const [generation, setGeneration] = useState<CarGeneration>(
    initialGeneration,
  );
  const [battery, setBattery] = useState(
    String(car?.battery_capacity_kwh ?? initialPreset.battery_capacity_kwh),
  );
  const [chargerPower, setChargerPower] = useState(
    String(
      car?.default_charger_power_kw ??
        initialPreset.default_charger_power_kw,
    ),
  );
  const [efficiency, setEfficiency] = useState(
    String(
      car?.default_efficiency_percent ??
        initialPreset.default_efficiency_percent,
    ),
  );

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
                if (!value) return;

                const nextGeneration = value as CarGeneration;
                setGeneration(nextGeneration);

                if (mode === "create" && !car) {
                  const preset = carGenerationPresets[nextGeneration];
                  setBattery(String(preset.battery_capacity_kwh));
                  setChargerPower(String(preset.default_charger_power_kw));
                  setEfficiency(String(preset.default_efficiency_percent));
                }
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
          {mode === "create" ? (
            <div className="space-y-2">
              <Label htmlFor="home_price_per_kwh">{t("cars.homePrice")}</Label>
              <Input
                id="home_price_per_kwh"
                name="home_price_per_kwh"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[,.]?[0-9]*"
                step="any"
                min={0}
                placeholder={t("cars.homePricePlaceholder") as string}
                className="min-h-[52px] rounded-2xl text-lg"
              />
              <p className="text-muted-foreground text-xs">{t("cars.homePriceHelp")}</p>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="home_charger_lat">{t("cars.homeGeofence")}</Label>
              <p className="text-muted-foreground text-xs">{t("cars.homeGeofenceHelp")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="home_charger_lat">{t("cars.homeLat")}</Label>
              <Input
                id="home_charger_lat"
                name="home_charger_lat"
                type="text"
                inputMode="decimal"
                defaultValue={car?.home_charger_lat ?? ""}
                placeholder="53.9"
                className="min-h-[52px] rounded-2xl text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="home_charger_lon">{t("cars.homeLon")}</Label>
              <Input
                id="home_charger_lon"
                name="home_charger_lon"
                type="text"
                inputMode="decimal"
                defaultValue={car?.home_charger_lon ?? ""}
                placeholder="27.56"
                className="min-h-[52px] rounded-2xl text-lg"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="home_charger_radius_m">{t("cars.homeRadius")}</Label>
              <Input
                id="home_charger_radius_m"
                name="home_charger_radius_m"
                type="number"
                inputMode="numeric"
                min={10}
                max={5000}
                step="1"
                defaultValue={car?.home_charger_radius_m ?? 150}
                className="min-h-[52px] rounded-2xl text-lg"
              />
            </div>
          </div>

          <details className="group rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
              <span>{t("cars.advanced")}</span>
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="space-y-2 px-4 pb-4">
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
          </details>
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
