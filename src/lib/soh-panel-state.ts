export type SohPanelState = "loading" | "error" | "empty" | "single" | "ready";

export function resolveSohPanelState({
  isLoading,
  hasError,
  pointCount,
}: {
  isLoading: boolean;
  hasError: boolean;
  pointCount: number;
}): SohPanelState {
  if (isLoading) return "loading";
  if (hasError) return "error";
  if (pointCount === 0) return "empty";
  if (pointCount === 1) return "single";
  return "ready";
}
