import type { Metadata } from "next";

import { EditCarForm } from "@/components/cars/edit-car-form";

export const metadata: Metadata = {
  title: "Edit vehicle",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCarPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-[2.875rem] p-8">
      <div>
        <p className="text-muted-foreground text-xs uppercase tracking-[0.42em]">
          Fleet
        </p>
        <h1 className="mt-[1.425rem] text-balance text-[2.725rem] font-semibold tracking-tight drop-shadow-xl">
          Edit vehicle
        </h1>
        <p className="text-muted-foreground mx-auto mt-8 max-w-2xl text-lg leading-snug tracking-tight text-balance">
          Update nickname, generation, battery size, and AC limits.
        </p>
      </div>
      <EditCarForm carId={id} />
    </div>
  );
}
