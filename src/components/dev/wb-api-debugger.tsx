"use client";

import Image from "next/image";
import { Loader2, RefreshCw, Save, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type WbProduct = {
  wb_id: string;
  name: string;
  brand: string;
  price: number | null;
  rating: number | null;
  image: string;
  url: string;
  exists_in_db: boolean;
  availability: boolean | null;
};

type SearchResponse = {
  query: string;
  sources: string[];
  total: number;
  items: WbProduct[];
  related_total: number;
  related_items: WbProduct[];
};

type CheckResponse = {
  exists: boolean;
  product?: {
    id: string;
    wb_id: string;
    name: string;
  } | null;
};

type SaveResponse = {
  success: boolean;
  saved_item?: {
    id: number;
    vehicle: string;
    query: string;
  };
  product?: {
    id: string;
    wb_id: string;
  } | null;
};

type SavedProduct = {
  id: number | null;
  vehicle: string;
  query: string;
  saved_at: string;
  product: WbProduct;
};

type SavedProductsResponse = {
  total: number;
  items: SavedProduct[];
};

type AvailabilityRefreshResponse = {
  total: number;
  available_total: number;
  unavailable_total: number;
  unknown_total: number;
};

type RowState = {
  checking?: boolean;
  saving?: boolean;
  checkResult?: CheckResponse;
  saveResult?: SaveResponse;
  error?: string;
};

type ProductTab = "search" | "saved";

export function WbApiDebugger() {
  const [activeTab, setActiveTab] = useState<ProductTab>("search");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<WbProduct[]>([]);
  const [relatedItems, setRelatedItems] = useState<WbProduct[]>([]);
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedProduct[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [isRefreshingAvailability, setIsRefreshingAvailability] = useState(false);
  const [availabilitySummary, setAvailabilitySummary] =
    useState<AvailabilityRefreshResponse | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  useEffect(() => {
    void loadSavedProducts();
  }, []);

  async function loadSavedProducts() {
    setIsLoadingSaved(true);
    setSavedError(null);

    try {
      const response = await localApiGet<SavedProductsResponse>("/api/dev/wb/products");

      setSavedItems(response.items ?? []);
    } catch (savedProductsError) {
      setSavedItems([]);
      setSavedError(errorMessage(savedProductsError));
    } finally {
      setIsLoadingSaved(false);
    }
  }

  async function searchProducts() {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Enter a Wildberries search query.");
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    setRowStates({});

    try {
      const params = new URLSearchParams({ query: trimmedQuery });
      const response = await localApiGet<SearchResponse>(
        `/api/dev/wb/search?${params.toString()}`,
      );

      setItems(response.items ?? []);
      setRelatedItems(response.related_items ?? []);
      setResolvedQuery(response.query || trimmedQuery);
    } catch (searchError) {
      setItems([]);
      setRelatedItems([]);
      setResolvedQuery("");
      setError(errorMessage(searchError));
    } finally {
      setIsSearching(false);
    }
  }

  async function refreshAvailability() {
    setIsRefreshingAvailability(true);
    setSavedError(null);

    try {
      const response = await localApiPost<AvailabilityRefreshResponse>(
        "/api/dev/wb/products/availability",
        {},
      );

      setAvailabilitySummary(response);
      await loadSavedProducts();
    } catch (refreshError) {
      setSavedError(errorMessage(refreshError));
    } finally {
      setIsRefreshingAvailability(false);
    }
  }

  async function checkProduct(product: WbProduct) {
    setRowState(product.wb_id, { checking: true, error: undefined });

    try {
      const params = new URLSearchParams({ wb_id: product.wb_id });
      const response = await localApiGet<CheckResponse>(
        `/api/dev/wb/products/check?${params.toString()}`,
      );

      setRowState(product.wb_id, {
        checking: false,
        checkResult: response,
        error: undefined,
      });
    } catch (checkError) {
      setRowState(product.wb_id, {
        checking: false,
        error: errorMessage(checkError),
      });
    }
  }

  async function saveProduct(product: WbProduct) {
    setRowState(product.wb_id, { saving: true, error: undefined });

    try {
      const response = await localApiPost<SaveResponse>("/api/dev/wb/products", {
        wb_id: product.wb_id,
        name: product.name,
        brand: product.brand,
        price: product.price,
        rating: product.rating,
        image: product.image,
        url: product.url,
        availability: product.availability,
        query: resolvedQuery || query,
      });

      setRowState(product.wb_id, {
        saving: false,
        saveResult: response,
        checkResult: response.product
          ? {
              exists: true,
              product: {
                id: response.product.id,
                wb_id: response.product.wb_id,
                name: product.name,
              },
            }
          : undefined,
        error: undefined,
      });
      await loadSavedProducts();
      setActiveTab("saved");
    } catch (saveError) {
      setRowState(product.wb_id, {
        saving: false,
        error: errorMessage(saveError),
      });
    }
  }

  function setRowState(wbId: string, nextState: RowState) {
    setRowStates((current) => ({
      ...current,
      [wbId]: {
        ...current[wbId],
        ...nextState,
      },
    }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wildberries backend debug</CardTitle>
        <CardDescription>
          Backend URL: {process.env.NEXT_PUBLIC_API_URL}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Tabs
          className="gap-5"
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ProductTab)}
        >
          <TabsList className="w-full justify-start sm:w-fit">
            <TabsTrigger className="px-3" value="search">
              Search
            </TabsTrigger>
            <TabsTrigger className="px-3" value="saved">
              Saved products ({savedItems.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent className="grid gap-5" value="search">
            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void searchProducts();
              }}
            >
              <input
                className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search goods in Wildberries"
                type="search"
              />
              <Button disabled={isSearching} type="submit">
                {isSearching ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Search className="size-4" aria-hidden />
                )}
                Search
              </Button>
            </form>

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <ResultsTable
              hasSearched={hasSearched}
              isSearching={isSearching}
              items={items}
              query={resolvedQuery}
              relatedItems={relatedItems}
              rowStates={rowStates}
              onCheck={checkProduct}
              onSave={saveProduct}
            />
          </TabsContent>

          <TabsContent className="grid gap-5" value="saved">
            <SavedProductsSection
              availabilitySummary={availabilitySummary}
              error={savedError}
              isLoading={isLoadingSaved}
              isRefreshing={isRefreshingAvailability}
              items={savedItems}
              onRefresh={() => void refreshAvailability()}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function SavedProductsSection({
  availabilitySummary,
  error,
  isLoading,
  isRefreshing,
  items,
  onRefresh,
}: {
  availabilitySummary: AvailabilityRefreshResponse | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  items: SavedProduct[];
  onRefresh: () => void;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Saved products ({items.length})
          </h2>
          {error ? (
            <p className="mt-1 text-xs text-destructive">{error}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              User-confirmed BYD Yuan Up products saved through the backend.
            </p>
          )}
          {availabilitySummary ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Availability: {availabilitySummary.available_total} available,{" "}
              {availabilitySummary.unavailable_total} unavailable,{" "}
              {availabilitySummary.unknown_total} unknown.
            </p>
          ) : null}
        </div>
        <Button
          disabled={isLoading || isRefreshing || items.length === 0}
          size="sm"
          type="button"
          variant="outline"
          onClick={onRefresh}
        >
          {isRefreshing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          Refresh availability
        </Button>
      </div>
      {isLoading ? (
        <div className="rounded-lg border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          Loading saved products...
        </div>
      ) : items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="p-3">Image</th>
                <th className="p-3">Name</th>
                <th className="p-3">Query</th>
                <th className="p-3">Price</th>
                <th className="p-3">WB ID</th>
                <th className="p-3">Status</th>
                <th className="p-3">Saved</th>
              </tr>
            </thead>
            <tbody>
              {items.map((savedItem) => (
                <SavedProductRow
                  key={`${savedItem.id ?? "saved"}-${savedItem.product.wb_id}`}
                  savedItem={savedItem}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          No saved products yet.
        </div>
      )}
    </section>
  );
}

function SavedProductRow({ savedItem }: { savedItem: SavedProduct }) {
  const item = savedItem.product;

  return (
    <tr className="border-t border-border align-top">
      <td className="p-3">
        <div className="relative size-14 overflow-hidden rounded-md border border-border bg-white/[0.03]">
          {item.image ? (
            <Image
              alt={item.name}
              className="object-cover"
              fill
              sizes="56px"
              src={item.image}
              unoptimized
            />
          ) : null}
        </div>
      </td>
      <td className="max-w-xs p-3">
        <a
          className="font-medium text-foreground underline-offset-4 hover:underline"
          href={item.url}
          rel="noreferrer"
          target="_blank"
        >
          {item.name}
        </a>
      </td>
      <td className="p-3 text-muted-foreground">{savedItem.query || "n/a"}</td>
      <td className="p-3">{formatPrice(item.price)}</td>
      <td className="p-3 font-mono text-xs">{item.wb_id}</td>
      <td className="p-3">
        <AvailabilityBadge availability={item.availability} />
      </td>
      <td className="p-3 text-xs text-muted-foreground">
        {formatDateTime(savedItem.saved_at)}
      </td>
    </tr>
  );
}

function AvailabilityBadge({ availability }: { availability: boolean | null }) {
  if (availability === false) {
    return (
      <span className="inline-flex rounded-full bg-destructive/15 px-2 py-1 text-xs font-semibold text-destructive">
        Not available
      </span>
    );
  }

  if (availability === true) {
    return (
      <span className="inline-flex rounded-full bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
        Available
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-white/[0.04] px-2 py-1 text-xs font-semibold text-muted-foreground">
      Unknown
    </span>
  );
}

function ResultsTable({
  hasSearched,
  isSearching,
  items,
  query,
  relatedItems,
  rowStates,
  onCheck,
  onSave,
}: {
  hasSearched: boolean;
  isSearching: boolean;
  items: WbProduct[];
  query: string;
  relatedItems: WbProduct[];
  rowStates: Record<string, RowState>;
  onCheck: (product: WbProduct) => void;
  onSave: (product: WbProduct) => void;
}) {
  if (isSearching) {
    return (
      <div className="rounded-lg border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
        Loading products...
      </div>
    );
  }

  if (hasSearched && items.length === 0 && relatedItems.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
        No products returned.
      </div>
    );
  }

  if (!hasSearched) {
    return (
      <div className="rounded-lg border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
        Enter a query to call GET /api/dev/wb/search.
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {items.length > 0 ? (
        <ProductTable
          items={items}
          rowStates={rowStates}
          title="Exact matches"
          onCheck={onCheck}
          onSave={onSave}
        />
      ) : relatedItems.length > 0 ? (
        <div className="rounded-lg border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          No exact results for {query ? `"${query}"` : "this query"}.
        </div>
      ) : null}

      {relatedItems.length > 0 ? (
        <ProductTable
          description="Broader BYD Yuan Up products returned by the backend fallback contract."
          items={relatedItems}
          rowStates={rowStates}
          title="Related products"
          onCheck={onCheck}
          onSave={onSave}
        />
      ) : null}
    </div>
  );
}

function ProductTable({
  description,
  items,
  rowStates,
  title,
  onCheck,
  onSave,
}: {
  description?: string;
  items: WbProduct[];
  rowStates: Record<string, RowState>;
  title: string;
  onCheck: (product: WbProduct) => void;
  onSave: (product: WbProduct) => void;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {title} ({items.length})
        </h2>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="p-3">Image</th>
              <th className="p-3">Name</th>
              <th className="p-3">Brand</th>
              <th className="p-3">Price</th>
              <th className="p-3">Rating</th>
              <th className="p-3">WB ID</th>
              <th className="p-3">Exists</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ProductRow
                key={item.wb_id}
                item={item}
                rowState={rowStates[item.wb_id] ?? {}}
                onCheck={onCheck}
                onSave={onSave}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductRow({
  item,
  rowState,
  onCheck,
  onSave,
}: {
  item: WbProduct;
  rowState: RowState;
  onCheck: (product: WbProduct) => void;
  onSave: (product: WbProduct) => void;
}) {
  const exists = rowState.checkResult?.exists ?? item.exists_in_db;
  const isSaved = Boolean(rowState.saveResult?.success);

  return (
    <tr className="border-t border-border align-top">
      <td className="p-3">
        <div className="relative size-16 overflow-hidden rounded-md border border-border bg-white/[0.03]">
          {item.image ? (
            <Image
              alt={item.name}
              className="object-cover"
              fill
              sizes="64px"
              src={item.image}
              unoptimized
            />
          ) : null}
        </div>
      </td>
      <td className="max-w-xs p-3">
        <a
          className="font-medium text-foreground underline-offset-4 hover:underline"
          href={item.url}
          rel="noreferrer"
          target="_blank"
        >
          {item.name}
        </a>
        {rowState.error ? (
          <p className="mt-2 text-xs text-destructive">{rowState.error}</p>
        ) : null}
        {rowState.saveResult?.success ? (
          <p className="mt-2 text-xs text-primary">
            Saved as{" "}
            {rowState.saveResult.product?.id ??
              rowState.saveResult.saved_item?.id ??
              "new product"}
            .
          </p>
        ) : null}
      </td>
      <td className="p-3">{item.brand}</td>
      <td className="p-3">{formatPrice(item.price)}</td>
      <td className="p-3">{formatNullableNumber(item.rating)}</td>
      <td className="p-3 font-mono text-xs">{item.wb_id}</td>
      <td className="p-3">
        <span
          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
            exists
              ? "bg-primary/15 text-primary"
              : "bg-white/[0.04] text-muted-foreground"
          }`}
        >
          {exists ? "Yes" : "No"}
        </span>
        {rowState.checkResult?.product ? (
          <p className="mt-2 max-w-40 break-all text-xs text-muted-foreground">
            {rowState.checkResult.product.id}
          </p>
        ) : null}
      </td>
      <td className="p-3">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={rowState.checking}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onCheck(item)}
          >
            {rowState.checking ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Check DB
          </Button>
          <Button
            disabled={rowState.saving || isSaved}
            size="sm"
            type="button"
            onClick={() => onSave(item)}
          >
            {rowState.saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : isSaved ? (
              <Save className="size-4" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            {isSaved ? "Saved" : "Save"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function formatPrice(price: number | null) {
  if (price == null) {
    return "n/a";
  }

  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "BYN",
  }).format(price);
}

function formatNullableNumber(value: number | null) {
  return value == null ? "n/a" : value;
}

function formatDateTime(value: string) {
  if (!value) {
    return "n/a";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown API request error.";
}

async function localApiGet<TResponse>(path: string) {
  return localApiRequest<TResponse>(path, { method: "GET" });
}

async function localApiPost<TResponse>(path: string, body: unknown) {
  return localApiRequest<TResponse>(path, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

async function localApiRequest<TResponse>(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = readableErrorDetail(payload);

    throw new Error(
      `API request failed with ${response.status} ${response.statusText}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  return payload as TResponse;
}

function readableErrorDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if ("detail" in payload && typeof payload.detail === "string") {
    return payload.detail;
  }

  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return JSON.stringify(payload);
}
