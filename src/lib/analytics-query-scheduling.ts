export function shouldEnableDeferredAnalyticsQuery({
  criticalQueriesSettled,
  nearViewport,
}: {
  criticalQueriesSettled: boolean;
  nearViewport: boolean;
}) {
  return criticalQueriesSettled || nearViewport;
}
