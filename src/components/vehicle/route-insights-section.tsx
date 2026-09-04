"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Pencil } from "lucide-react";
import dynamic from "next/dynamic";

import { TempConsumptionBarChart } from "@/components/vehicle/telemetry-analytics-charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n";
import {
  isRouteTrackDisplayable,
  type ParkedRouteInsight,
  type RouteInsight,
  type RouteInsightsResult,
} from "@/lib/voltflowmate/route-insights";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { cn } from "@/lib/utils";
import type { VoltflowMateTripTrackPointRow } from "@/types/database";

const RouteMapPreview = dynamic(
  () => import("@/components/vehicle/vehicle-route-map").then((module) => module.RouteMapPreview),
  {
    loading: () => <Skeleton className="h-44 rounded-xl" />,
  },
);

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

function fmt(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

async function saveRoutePreference({
  vehicleId,
  routeId,
  name,
  isPark,
}: {
  vehicleId: string;
  routeId: string;
  name?: string;
  isPark?: boolean;
}) {
  const response = isDevAppRoute()
    ? await devFetch("/api/vehicle/route-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: vehicleId, route_id: routeId, name, is_park: isPark }),
      })
    : await fetch("/api/vehicle/route-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: vehicleId, route_id: routeId, name, is_park: isPark }),
      });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Failed to save route preference");
  }

  return response.json() as Promise<{ name: string | null; isPark: boolean }>;
}

function invalidateRouteInsights(queryClient: ReturnType<typeof useQueryClient>, vehicleId: string) {
  queryClient.invalidateQueries({ queryKey: ["vehicle-analytics", "route-insights", vehicleId] });
}

function patchRouteInsightInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  vehicleId: string,
  routeId: string,
  patch: Partial<Pick<RouteInsight, "name">>,
) {
  queryClient.setQueriesData<RouteInsightsResult>(
    { queryKey: ["vehicle-analytics", "route-insights", vehicleId] },
    (current) => {
      if (!current) return current;
      return {
        ...current,
        routes: current.routes.map((item) =>
          item.routeId === routeId ? { ...item, ...patch } : item,
        ),
      };
    },
  );
}

function RouteInsightCard({
  route,
  vehicleId,
  tx,
}: {
  route: RouteInsight;
  vehicleId: string;
  tx: Translator;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(route.name ?? "");

  const saveMutation = useMutation({
    mutationFn: (payload: { name?: string; isPark?: boolean }) =>
      saveRoutePreference({ vehicleId, routeId: route.routeId, ...payload }),
    onMutate: (payload) => {
      if (payload.name === undefined) return undefined;
      const nextName = payload.name.trim() || null;
      const previousName = route.name;
      patchRouteInsightInCache(queryClient, vehicleId, route.routeId, { name: nextName });
      setIsEditing(false);
      return { previousName };
    },
    onSuccess: (data, payload) => {
      if (payload.name !== undefined) {
        patchRouteInsightInCache(queryClient, vehicleId, route.routeId, { name: data.name });
      }
      invalidateRouteInsights(queryClient, vehicleId);
    },
    onError: (_error, payload, context) => {
      if (payload.name !== undefined && context) {
        patchRouteInsightInCache(queryClient, vehicleId, route.routeId, { name: context.previousName });
        setDraftName(payload.name);
        setIsEditing(true);
      }
    },
  });

  const displayTitle = route.name?.trim() || route.label;
  const hasUserName = Boolean(route.name?.trim());
  const isSavingName = saveMutation.isPending && saveMutation.variables?.name !== undefined;
  const showMap = expanded && isRouteTrackDisplayable(route.trackPoints);

  const startEditing = () => {
    setDraftName(route.name ?? "");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftName(route.name ?? "");
    setIsEditing(false);
  };

  return (
    <article className="rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="grid gap-2">
              <Input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder={tx("vehicle.analytics.routeNamePlaceholder")}
                maxLength={80}
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ name: draftName })}
                >
                  {saveMutation.isPending ? tx("common.saving") : tx("vehicle.analytics.routeNameSave")}
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEditing}>
                  {tx("vehicle.analytics.routeNameCancel")}
                </Button>
              </div>
              {saveMutation.isError ? (
                <p className="text-xs text-destructive">{saveMutation.error.message}</p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-full text-left"
              aria-expanded={expanded}
            >
              <h3 className="font-heading text-base font-semibold tracking-tight">{displayTitle}</h3>
              {isSavingName ? (
                <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  {tx("common.saving")}
                </p>
              ) : hasUserName ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{route.label}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {tx("vehicle.analytics.routeTripCount", { value: route.tripCount })}
              </p>
            </button>
          )}
        </div>
        {!isEditing ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-white/[0.03] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              aria-label={tx("vehicle.analytics.routeNameRename")}
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-white/[0.03] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              aria-label={expanded ? tx("vehicle.analytics.routeCollapse") : tx("vehicle.analytics.routeExpand")}
            >
              <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-3 grid gap-3">
          {showMap ? (
            <RouteMapPreview
              trackPoints={route.trackPoints as VoltflowMateTripTrackPointRow[]}
              className="h-44"
            />
          ) : null}
          {!hasUserName ? (
            <div className="rounded-xl border border-border/80 bg-white/[0.02] p-3">
              <p className="text-xs text-muted-foreground">{tx("vehicle.analytics.routeParkHint")}</p>
              <Button
                size="sm"
                variant="destructive"
                className="mt-2"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate({ isPark: true })}
              >
                {tx("vehicle.analytics.routeMarkPark")}
              </Button>
            </div>
          ) : null}
          <div className="grid gap-2">
            <p className="text-sm tabular-nums">
              {fmt(route.medianConsumptionKwh100, 1)} kWh/100 · {fmt(route.minConsumptionKwh100, 1)}–{fmt(route.maxConsumptionKwh100, 1)}
            </p>
            {route.predictedConsumptionKwh100 ? (
              <p className="text-sm text-primary">
                {tx("vehicle.analytics.routePrediction", {
                  low: fmt(route.predictedConsumptionKwh100.low, 1),
                  high: fmt(route.predictedConsumptionKwh100.high, 1),
                })}
              </p>
            ) : null}
            {route.tempBuckets.length >= 2 ? (
              <TempConsumptionBarChart
                buckets={route.tempBuckets.map((bucket) => ({
                  tempLabel: bucket.label,
                  tempMid: bucket.tempC,
                  tripCount: bucket.count,
                  avgConsumptionKwh100: bucket.avgConsumptionKwh100,
                }))}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ParkedRouteCard({
  route,
  vehicleId,
  tx,
}: {
  route: ParkedRouteInsight;
  vehicleId: string;
  tx: Translator;
}) {
  const queryClient = useQueryClient();
  const displayTitle = route.name?.trim() || route.label;

  const restoreMutation = useMutation({
    mutationFn: () => saveRoutePreference({ vehicleId, routeId: route.routeId, isPark: false }),
    onSuccess: () => invalidateRouteInsights(queryClient, vehicleId),
  });

  return (
    <article className="rounded-2xl border border-dashed border-border bg-white/[0.01] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-semibold tracking-tight">{displayTitle}</h3>
          {route.name ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{route.label}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">{tx("vehicle.analytics.routeParkedNote")}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={restoreMutation.isPending}
          onClick={() => restoreMutation.mutate()}
        >
          {tx("vehicle.analytics.routeUnmarkPark")}
        </Button>
      </div>
    </article>
  );
}

function RouteInsightsLoading({ tx }: { tx: Translator }) {
  return (
    <div
      className="mt-4 grid gap-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-white/[0.02] p-4">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden />
        <div>
          <p className="text-sm font-medium">{tx("vehicle.analytics.routeInsightsLoading")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tx("vehicle.analytics.routeInsightsLoadingHint")}</p>
        </div>
      </div>
      {[0, 1].map((index) => (
        <div key={index} className="rounded-2xl border border-border bg-white/[0.02] p-4">
          <Skeleton className="h-5 w-3/5 rounded-md" />
          <Skeleton className="mt-2 h-3 w-2/5 rounded-md" />
          <Skeleton className="mt-4 h-24 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function RouteInsightsSection({
  routes,
  parkedRoutes,
  isLoading,
  hasError,
  onRetry,
  isRetrying,
  vehicleId,
}: {
  routes: RouteInsight[];
  parkedRoutes: ParkedRouteInsight[];
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  isRetrying: boolean;
  vehicleId: string;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [parkedOpen, setParkedOpen] = useState(parkedRoutes.length > 0);

  if (isLoading) {
    return <RouteInsightsLoading tx={tx} />;
  }

  if (hasError) {
    return (
      <div className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="text-destructive">{tx("vehicle.analytics.routeInsightsLoadError")}</p>
        <Button className="mt-3" size="sm" variant="outline" disabled={isRetrying} onClick={onRetry}>
          {tx("vehicle.analytics.retry")}
        </Button>
      </div>
    );
  }

  if (routes.length === 0 && parkedRoutes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{tx("vehicle.analytics.routeInsightsEmpty")}</p>
    );
  }

  return (
    <div id="route-insights" className="mt-4 grid gap-3">
      {routes.map((route) => (
        <RouteInsightCard key={route.routeId} route={route} vehicleId={vehicleId} tx={tx} />
      ))}

      {parkedRoutes.length > 0 ? (
        <section className="mt-1">
          <button
            type="button"
            onClick={() => setParkedOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-left"
          >
            <span className="text-sm font-medium">
              {tx("vehicle.analytics.routeParkedTitle", { value: parkedRoutes.length })}
            </span>
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", parkedOpen && "rotate-180")} aria-hidden />
          </button>
          {parkedOpen ? (
            <div className="mt-2 grid gap-2">
              {parkedRoutes.map((route) => (
                <ParkedRouteCard key={route.routeId} route={route} vehicleId={vehicleId} tx={tx} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
