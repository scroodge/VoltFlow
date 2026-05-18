"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import { CarForm } from "@/components/cars/car-form";
import { Skeleton } from "@/components/ui/skeleton";
import { useCarsQuery, useUpdateCarMutation } from "@/hooks/use-cars-query";
import { useTranslation } from "@/hooks/use-translation";

export function EditCarForm({ carId }: { carId: string }) {
  const router = useRouter();
  const { data: cars, isLoading } = useCarsQuery();
  const mutation = useUpdateCarMutation(carId);
  const { t } = useTranslation();
  const car = cars?.find((item) => item.id === carId);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    mutation.mutate(fd, {
      onSuccess: () => {
        router.replace("/settings");
      },
    });
  };

  if (isLoading) {
    return <Skeleton className="h-[420px] w-full rounded-3xl" />;
  }

  if (!car) {
    return (
      <p className="text-muted-foreground text-base leading-relaxed">
        {t("cars.notFound")}
      </p>
    );
  }

  return (
    <CarForm
      mode="edit"
      car={car}
      cancelHref="/settings"
      isPending={mutation.isPending}
      onSubmit={handleSubmit}
    />
  );
}
