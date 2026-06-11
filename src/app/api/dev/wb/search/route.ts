import { NextRequest, NextResponse } from "next/server";

import { proxyBackendRequest } from "../_proxy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim();

  if (!query) {
    return NextResponse.json(
      { error: "Query is required." },
      { status: 400 },
    );
  }

  const existingIds = await getExistingWbIds(query);
  const backendResponse = await proxyBackendRequest("/api/marketplace/search", {
    body: JSON.stringify({
      query,
      sources: ["wildberries"],
      limit: 20,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await backendResponse.json();

  if (!backendResponse.ok) {
    return NextResponse.json(payload, { status: backendResponse.status });
  }

  const items = mapMarketplaceItems(payload.items, existingIds);
  const relatedItems = mapMarketplaceItems(payload.related_items, existingIds);

  return NextResponse.json({
    query: stringValue(payload.query) || query,
    sources: Array.isArray(payload.sources)
      ? payload.sources.map(stringValue).filter(Boolean)
      : ["wildberries"],
    total: numberValue(payload.total) ?? items.length,
    items,
    related_total: numberValue(payload.related_total) ?? relatedItems.length,
    related_items: relatedItems,
  });
}

async function getExistingWbIds(query: string) {
  const params = new URLSearchParams({
    limit: "200",
    query,
    source: "wildberries",
  });
  const response = await proxyBackendRequest(
    `/api/marketplace/items?${params.toString()}`,
  );

  if (!response.ok) {
    return new Set<string>();
  }

  const payload = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];

  const ids: string[] = [];

  for (const item of items as Record<string, unknown>[]) {
    const id = stringValue(item.external_id);

    if (id) {
      ids.push(id);
    }
  }

  return new Set<string>(ids);
}

function mapMarketplaceItems(items: unknown, existingIds: Set<string>) {
  return Array.isArray(items)
    ? items.map(mapMarketplaceItem).map((item) => ({
        ...item,
        exists_in_db: existingIds.has(item.wb_id),
      }))
    : [];
}

function mapMarketplaceItem(item: Record<string, unknown>) {
  const wbId = stringValue(item.external_id);

  return {
    wb_id: wbId,
    name: stringValue(item.title),
    brand: stringValue(item.seller),
    price: numberValue(item.price),
    rating: numberValue(item.rating),
    image: stringValue(item.image_url),
    url: stringValue(item.url) || wildberriesUrl(wbId),
    exists_in_db: false,
  };
}

function wildberriesUrl(wbId: string) {
  return wbId ? `https://www.wildberries.ru/catalog/${wbId}/detail.aspx` : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : null;
}
