import { NextRequest, NextResponse } from "next/server";

import { proxyBackendRequest } from "../_proxy";

export const runtime = "nodejs";

export async function GET() {
  const params = new URLSearchParams({
    vehicle: "BYD Yuan Up",
    limit: "50",
  });
  const backendResponse = await proxyBackendRequest(
    `/api/marketplace/saved-items?${params.toString()}`,
  );
  const backendPayload = await backendResponse.json();

  if (!backendResponse.ok) {
    return NextResponse.json(backendPayload, { status: backendResponse.status });
  }

  return NextResponse.json({
    total: numberValue(backendPayload.total) ?? 0,
    items: Array.isArray(backendPayload.items)
      ? backendPayload.items.map(mapSavedItem)
      : [],
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);

  if (!payload || typeof payload !== "object") {
    return NextResponse.json(
      { error: "Request body must be a product object." },
      { status: 400 },
    );
  }

  const product = payload as Record<string, unknown>;
  const wbId = stringValue(product.wb_id);

  if (!wbId) {
    return NextResponse.json({ error: "wb_id is required." }, { status: 400 });
  }

  const backendResponse = await proxyBackendRequest("/api/marketplace/saved-items", {
    body: JSON.stringify({
      query: stringValue(product.query),
      vehicle: "BYD Yuan Up",
      item: {
        source: "wildberries",
        external_id: wbId,
        title: stringValue(product.name),
        price: numberValue(product.price),
        currency: "BYN",
        url: stringValue(product.url),
        image_url: stringValue(product.image),
        seller: stringValue(product.brand),
        rating: numberValue(product.rating),
        reviews_count: null,
        availability: booleanValue(product.availability) ?? true,
        location: null,
        relevance_score: null,
        raw_data: {
          id: Number(wbId),
          brand: stringValue(product.brand),
          name: stringValue(product.name),
        },
      },
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const backendPayload = await backendResponse.json();

  if (!backendResponse.ok) {
    return NextResponse.json(backendPayload, { status: backendResponse.status });
  }

  return NextResponse.json({
    success: true,
    saved_item: backendPayload,
    product: {
      id: String(backendPayload.id ?? ""),
      wb_id: wbId,
    },
  });
}

function mapSavedItem(savedItem: unknown) {
  const saved = savedItem && typeof savedItem === "object"
    ? (savedItem as Record<string, unknown>)
    : {};
  const item = saved.item && typeof saved.item === "object"
    ? (saved.item as Record<string, unknown>)
    : {};
  const wbId = stringValue(item.external_id);

  return {
    id: numberValue(saved.id),
    vehicle: stringValue(saved.vehicle),
    query: stringValue(saved.query),
    saved_at: stringValue(saved.saved_at),
    product: {
      wb_id: wbId,
      name: stringValue(item.title),
      brand: stringValue(item.seller),
      price: numberValue(item.price),
      rating: numberValue(item.rating),
      image: stringValue(item.image_url),
      url: stringValue(item.url) || wildberriesUrl(wbId),
      exists_in_db: true,
      availability: booleanValue(item.availability),
    },
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function wildberriesUrl(wbId: string) {
  return wbId ? `https://www.wildberries.by/catalog/${wbId}/detail.aspx` : "";
}
