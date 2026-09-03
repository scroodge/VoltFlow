export type SohPanelState = "loading" | "error" | "empty" | "ready";

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
  return "ready";
}
