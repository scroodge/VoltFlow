"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import { CarForm } from "@/components/cars/car-form";
import { useCreateCarMutation } from "@/hooks/use-cars-query";
import { useAppPreferences } from "@/stores/use-app-preferences";

export function NewCarForm() {
  const router = useRouter();
  const mutation = useCreateCarMutation();
  const setCar = useAppPreferences((s) => s.setSelectedCarId);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    mutation.mutate(fd, {
      onSuccess: (createdId) => {
        setCar(createdId);
        router.replace("/dashboard");
      },
    });
  };

  return (
    <CarForm
      mode="create"
      cancelHref="/dashboard"
      isPending={mutation.isPending}
      onSubmit={handleSubmit}
    />
  );
}
