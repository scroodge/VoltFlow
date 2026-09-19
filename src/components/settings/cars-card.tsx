"use client";

import Link from "next/link";

import { CarRow } from "@/components/settings/car-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPath } from "@/lib/dev/dev-path";

export function CarsCard() {
  const { t } = useTranslation();
  const appPath = useAppPath();
  const { data: carsResult, isLoading } = useCarsQuery();
  const cars = carsResult?.cars;

  return (
    <Card>
      <CardContent>
        <Separator className="my-6 bg-white/15" />

        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                {t("settings.housekeeping")}
              </p>
            </div>
            <Button
              asChild
              variant="secondary"
              className="h-10 rounded-full text-sm"
            >
              <Link href={appPath("/cars/new")}>{t("settings.addEv")}</Link>
            </Button>
          </div>
          <div className="space-y-5">
            {isLoading &&
              Array.from({ length: 2 }).map((_, index) => (
                <Skeleton
                  key={index}
                  className="h-[120px] w-full rounded-3xl"
                />
              ))}
            {!isLoading &&
              cars?.map((car) => <CarRow key={car.id} car={car} />)}
            {!isLoading && !(cars ?? []).length ? (
              <p className="text-muted-foreground text-base leading-relaxed">
                {t("settings.noRides")}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
