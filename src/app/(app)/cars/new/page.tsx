import type { Metadata } from "next";

import { NewCarForm } from "@/components/cars/new-car-form";
import { NewCarIntro } from "@/components/cars/new-car-intro";

export const metadata: Metadata = {
  title: "Garage intake",
};

export default function NewCarPage() {
  return (
    <div className="flex flex-col gap-[2.875rem] p-8">
      <NewCarIntro />
      <NewCarForm />
    </div>
  );
}
