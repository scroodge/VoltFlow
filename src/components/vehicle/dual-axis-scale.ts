type AxisScale = {
  minValue: number;
  maxValue: number;
  y: (value: number) => number;
  yTickValues: number[];
};

const PLOT_TOP_Y = 16;
const PLOT_BOTTOM_Y = 104;
const SCALE_PAD = 0.12;
const MIN_ZERO_FRACTION_FROM_BOTTOM = 0.15;
const MAX_ZERO_FRACTION_FROM_BOTTOM = 0.85;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function uniqueTicks(values: number[]) {
  return values.filter((value, index) =>
    values.slice(0, index).every((candidate) => Math.abs(candidate - value) > 1e-9),
  );
}

/**
 * Builds separate numeric scales whose zeroes occupy the same plotted Y coordinate.
 *
 * The units remain independent: a shared zero says only that neither speed nor
 * traction power is positive or negative at that line. It does not equate km/h to kW.
 */
export function buildZeroAlignedAxisScales(valueSets: readonly (readonly number[])[]): AxisScale[] {
  const extents = valueSets.map((values) => {
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const negative = Math.max(0, -min) * (min < 0 ? 1 + SCALE_PAD : 1);
    const positive = Math.max(0, max) * (max > 0 ? 1 + SCALE_PAD : 1);
    return { negative, positive };
  });

  const zeroFractions = extents.map(({ negative, positive }) => {
    if (negative === 0 && positive === 0) return 1;
    if (negative === 0) return 1;
    if (positive === 0) return 0;
    return positive / (negative + positive);
  });
  const zeroFractionFromBottom = clamp(
    Math.min(...zeroFractions),
    MIN_ZERO_FRACTION_FROM_BOTTOM,
    MAX_ZERO_FRACTION_FROM_BOTTOM,
  );

  return extents.map(({ negative, positive }) => {
    // A series containing only zero needs a visible, stable domain too.
    const safePositive = negative === 0 && positive === 0 ? 1 : positive;
    const minExtent = Math.max(
      negative,
      (safePositive * (1 - zeroFractionFromBottom)) / zeroFractionFromBottom,
    );
    const maxExtent = Math.max(
      safePositive,
      (negative * zeroFractionFromBottom) / (1 - zeroFractionFromBottom),
    );
    const minValue = -minExtent;
    const maxValue = maxExtent;
    const y = (value: number) =>
      PLOT_BOTTOM_Y - ((value - minValue) / (maxValue - minValue)) * (PLOT_BOTTOM_Y - PLOT_TOP_Y);
    const yTickValues = uniqueTicks([maxValue, (minValue + maxValue) / 2, 0, minValue]);

    return { minValue, maxValue, y, yTickValues };
  });
}
