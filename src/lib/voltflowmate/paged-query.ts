export async function collectPagedRows<T>({
  fetchPage,
  limit,
  pageSize = 1_000,
}: {
  fetchPage: (from: number, to: number) => Promise<T[]>;
  limit: number;
  pageSize?: number;
}) {
  const rows: T[] = [];
  const cappedLimit = Math.max(0, Math.floor(limit));

  for (let from = 0; from < cappedLimit; from += pageSize) {
    const page = await fetchPage(from, Math.min(from + pageSize - 1, cappedLimit - 1));
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}
