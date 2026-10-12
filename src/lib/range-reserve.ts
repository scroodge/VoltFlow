/** Allowed values for cars.range_reserve_soc_percent (5%-step, CHECK-locked in Postgres). */
export const rangeReserveSteps = [0, 5, 10, 15, 20, 25, 30, 35, 40] as const;

export type RangeReserveStep = (typeof rangeReserveSteps)[number];

export function isRangeReserveStep(value: unknown): value is RangeReserveStep {
  return (rangeReserveSteps as readonly number[]).includes(Number(value));
}
