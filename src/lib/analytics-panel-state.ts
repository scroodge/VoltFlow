export type AnalyticsPanelState = "loading" | "error" | "empty" | "ready";

export function resolveAnalyticsPanelState({
  isLoading,
  hasError,
  itemCount,
}: {
  isLoading: boolean;
  hasError: boolean;
  itemCount: number;
}): AnalyticsPanelState {
  if (isLoading) return "loading";
  if (hasError) return "error";
  if (itemCount === 0) return "empty";
  return "ready";
}
