"use client";

import { ChargingCalculator } from "@/components/telegram/ChargingCalculator";

/**
 * Deliberately just the one working calculator. This screen used to also render a card
 * per *unbuilt* calculator ("В следующей фазе"), plus a note that the rest were
 * "подготовлены для следующих фаз" — a catalog of things the user cannot use, which
 * advertises absence instead of the tool that works.
 */
export function Calculators() {
  return (
    <section className="space-y-4" aria-labelledby="tools-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          Инструменты
        </p>
        <h2 id="tools-title" className="mt-1 font-heading text-2xl font-bold">
          Калькулятор зарядки
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Посчитайте время, энергию и стоимость одной зарядной сессии.
        </p>
      </div>

      <ChargingCalculator />
    </section>
  );
}
