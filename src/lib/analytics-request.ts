export async function readAnalyticsResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("Failed to load analytics");
  return response.json() as Promise<T>;
}
