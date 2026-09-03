"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MapPin, Maximize2, Minimize2, Minus, Plus } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/hooks/use-translation";
import { isRouteTrackDisplayable } from "@/lib/voltflowmate/route-insights";
import type { TranslationKey } from "@/lib/i18n";
import { nearestRoutePointIndexByTime } from "./route-time-sync";
import type {
  VoltflowMateLocation,
  VoltflowMateLiveSnapshotRow,
  VoltflowMateTelemetry,
  VoltflowMateTelemetryPointRow,
  VoltflowMateTripTrackPointRow,
} from "@/types/database";

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

type RoutePoint = {
  lat: number;
  lon: number;
  time: number;
  powerKw: number | null;
  speedKmh: number | null;
  soc: number | null;
};

type MapTile = {
  key: string;
  url: string;
  x: number;
  y: number;
};

type MapPan = { x: number; y: number };
type RouteLayer = "route" | "power" | "speed" | "soc";

const MAX_ROUTE_POINTS = 2000;
const MAP_VIEW_WIDTH = 320;
const MAP_VIEW_HEIGHT = 180;
const ROUTE_MAP_PAD_X = 16;
const ROUTE_MAP_PAD_Y = 12;
const ROUTE_MAP_INNER_WIDTH = MAP_VIEW_WIDTH - ROUTE_MAP_PAD_X * 2;
const ROUTE_MAP_INNER_HEIGHT = MAP_VIEW_HEIGHT - ROUTE_MAP_PAD_Y * 2;
const MAP_TILE_SIZE = 256;
const MAX_MAP_ZOOM = 19;
const MIN_MAP_ZOOM = 2;
const DEFAULT_MAP_ZOOM = 15;
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const ROUTE_LINE_COLOR = "#1e40af";
const ROUTE_STROKE_WIDTH = 4;
const ROUTE_HIT_RADIUS = 10;
const REGEN_POWER_THRESHOLD_KW = 0.05;
const COAST_POWER_COLOR = "#475569";
const ROUTE_LAYER_OPTIONS: Array<{ id: RouteLayer; label: string; color: string }> = [
  { id: "route", label: "Route", color: ROUTE_LINE_COLOR },
  { id: "power", label: "Power", color: "#ef4444" },
  { id: "speed", label: "Speed", color: "#22c55e" },
  { id: "soc", label: "SOC", color: "#facc15" },
];

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pointTimeMs(point: { device_time: string; received_at?: string }) {
  const deviceMs = Date.parse(point.device_time);
  if (Number.isFinite(deviceMs)) return deviceMs;
  const receivedMs = point.received_at ? Date.parse(point.received_at) : Number.NaN;
  return Number.isFinite(receivedMs) ? receivedMs : 0;
}

function downsamplePoints<T>(points: T[], maxPoints: number) {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 1) return points.slice(0, 1);
  const lastIndex = points.length - 1;
  const sampled: T[] = [];
  let previousIndex = -1;
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (maxPoints - 1));
    if (sourceIndex !== previousIndex) {
      sampled.push(points[sourceIndex]);
      previousIndex = sourceIndex;
    }
  }
  return sampled;
}

function prepareRouteFromTrack(points: VoltflowMateTripTrackPointRow[]) {
  const routePoints: RoutePoint[] = [];
  let minLat = 0;
  let maxLat = 1;
  let minLon = 0;
  let maxLon = 1;

  for (const point of points) {
    const lat = validNumber(point.lat);
    const lon = validNumber(point.lon);
    const time = Date.parse(point.device_time);
    if (lat == null || lon == null || !Number.isFinite(time)) continue;

    routePoints.push({
      lat,
      lon,
      time,
      powerKw: validNumber(point.power_kw),
      speedKmh: validNumber(point.speed_kmh),
      soc: validNumber(point.soc),
    });
    if (routePoints.length === 1) {
      minLat = lat;
      maxLat = lat;
      minLon = lon;
      maxLon = lon;
    } else {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }

  return {
    points: downsamplePoints(routePoints, MAX_ROUTE_POINTS),
    totalPoints: routePoints.length,
    start: routePoints[0],
    end: routePoints.at(-1),
    minLat,
    maxLat,
    minLon,
    maxLon,
  };
}

function prepareRoute(points: VoltflowMateTelemetryPointRow[]) {
  const routePoints: RoutePoint[] = [];
  let minLat = 0;
  let maxLat = 1;
  let minLon = 0;
  let maxLon = 1;

  for (const point of points) {
    const lat = validNumber(point.location?.lat);
    const lon = validNumber(point.location?.lon);
    const time = pointTimeMs(point);
    if (lat == null || lon == null || !Number.isFinite(time)) continue;

    routePoints.push({
      lat,
      lon,
      time,
      powerKw: validNumber(point.telemetry.power_kw),
      speedKmh: validNumber(point.telemetry.speed_kmh),
      soc: validNumber(point.telemetry.soc),
    });
    if (routePoints.length === 1) {
      minLat = lat;
      maxLat = lat;
      minLon = lon;
      maxLon = lon;
    } else {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }

  return {
    points: downsamplePoints(routePoints, MAX_ROUTE_POINTS),
    totalPoints: routePoints.length,
    start: routePoints[0],
    end: routePoints.at(-1),
    minLat,
    maxLat,
    minLon,
    maxLon,
  };
}

function prepareLiveLocationRoute(
  location: VoltflowMateLocation,
  deviceTimeMs: number,
  telemetry: VoltflowMateLiveSnapshotRow["telemetry"],
): ReturnType<typeof prepareRoute> {
  const lat = validNumber(location.lat);
  const lon = validNumber(location.lon);
  if (lat == null || lon == null || !Number.isFinite(deviceTimeMs)) {
    return prepareRoute([]);
  }

  const point: RoutePoint = {
    lat,
    lon,
    time: deviceTimeMs,
    powerKw: validNumber(telemetry.power_kw),
    speedKmh: validNumber(telemetry.speed_kmh),
    soc: validNumber(telemetry.soc),
  };

  return {
    points: [point],
    totalPoints: 1,
    start: point,
    end: point,
    minLat: lat,
    maxLat: lat,
    minLon: lon,
    maxLon: lon,
  };
}

function clampLatitude(value: number) {
  return Math.min(WEB_MERCATOR_MAX_LAT, Math.max(-WEB_MERCATOR_MAX_LAT, value));
}

function projectMercator(lat: number, lon: number, zoom: number) {
  const scale = MAP_TILE_SIZE * 2 ** zoom;
  const clampedLat = clampLatitude(lat);
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);

  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function routeBoundsAtZoom(route: ReturnType<typeof prepareRoute>, zoom: number) {
  const topLeft = projectMercator(route.maxLat, route.minLon, zoom);
  const bottomRight = projectMercator(route.minLat, route.maxLon, zoom);

  return {
    minX: topLeft.x,
    maxX: bottomRight.x,
    minY: topLeft.y,
    maxY: bottomRight.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y),
  };
}

function chooseRouteZoom(route: ReturnType<typeof prepareRoute>) {
  if (!route.start || !route.end || route.totalPoints < 2) return DEFAULT_MAP_ZOOM;

  for (let zoom = MAX_MAP_ZOOM; zoom >= MIN_MAP_ZOOM; zoom -= 1) {
    const bounds = routeBoundsAtZoom(route, zoom);
    if (bounds.width <= ROUTE_MAP_INNER_WIDTH && bounds.height <= ROUTE_MAP_INNER_HEIGHT) {
      return zoom;
    }
  }

  return MIN_MAP_ZOOM;
}

function stepRouteMapZoom(baseZoom: number, zoomOffset: number, pan: MapPan, delta: number) {
  const minOffset = MIN_MAP_ZOOM - baseZoom;
  const maxOffset = MAX_MAP_ZOOM - baseZoom;
  const nextOffset = Math.max(minOffset, Math.min(maxOffset, zoomOffset + delta));
  if (nextOffset === zoomOffset) {
    return { zoomOffset, pan };
  }

  const scale = 2 ** (nextOffset - zoomOffset);
  return {
    zoomOffset: nextOffset,
    pan: { x: pan.x * scale, y: pan.y * scale },
  };
}

function prepareRouteMap(route: ReturnType<typeof prepareRoute>, zoomOffset: number, pan: MapPan) {
  const zoom = Math.max(
    MIN_MAP_ZOOM,
    Math.min(MAX_MAP_ZOOM, chooseRouteZoom(route) + zoomOffset),
  );
  const bounds = routeBoundsAtZoom(route, zoom);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const topLeftX = centerX - MAP_VIEW_WIDTH / 2 - pan.x;
  const topLeftY = centerY - MAP_VIEW_HEIGHT / 2 - pan.y;
  const minTileX = Math.floor(topLeftX / MAP_TILE_SIZE);
  const maxTileX = Math.floor((topLeftX + MAP_VIEW_WIDTH) / MAP_TILE_SIZE);
  const minTileY = Math.floor(topLeftY / MAP_TILE_SIZE);
  const maxTileY = Math.floor((topLeftY + MAP_VIEW_HEIGHT) / MAP_TILE_SIZE);
  const tileCount = 2 ** zoom;
  const tiles: MapTile[] = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;

    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}-${wrappedTileX}-${tileY}-${tileX}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
        x: tileX * MAP_TILE_SIZE - topLeftX,
        y: tileY * MAP_TILE_SIZE - topLeftY,
      });
    }
  }

  const mapPoint = (point: RoutePoint) => {
    const projected = projectMercator(point.lat, point.lon, zoom);
    return {
      x: projected.x - topLeftX,
      y: projected.y - topLeftY,
    };
  };

  return {
    zoom,
    tiles,
    mapPoint,
  };
}

function routeLayerValue(point: RoutePoint, layer: RouteLayer) {
  if (layer === "power") return point.powerKw == null ? null : Math.abs(point.powerKw);
  if (layer === "speed") return point.speedKmh;
  if (layer === "soc") return point.soc;
  return null;
}

function routeLayerColor(layer: RouteLayer) {
  return ROUTE_LAYER_OPTIONS.find((option) => option.id === layer)?.color ?? "var(--voltflow-cyan)";
}

function routeLayerSegmentColor(layer: RouteLayer | "regen", normalized: number) {
  const intensity = Math.max(0, Math.min(1, normalized));

  if (layer === "power") {
    return `hsl(0 84% ${38 + intensity * 24}%)`;
  }

  if (layer === "regen") {
    return `hsl(158 72% ${34 + intensity * 28}%)`;
  }

  if (layer === "speed") {
    return `hsl(142 72% ${34 + intensity * 26}%)`;
  }

  if (layer === "soc") {
    return `hsl(48 96% ${32 + intensity * 30}%)`;
  }

  return routeLayerColor(layer);
}

function layerDisplayRange(layer: RouteLayer, minValue: number, maxValue: number) {
  if (layer === "soc") return { min: 0, max: 100 };
  if (layer === "speed") return { min: 0, max: Math.max(120, maxValue) };
  if (layer === "power") return { min: 0, max: Math.max(50, maxValue) };
  return { min: minValue, max: maxValue };
}

function powerScaleBounds(points: RoutePoint[]) {
  let maxTraction = 5;
  let maxRegen = 5;

  for (const point of points) {
    const powerKw = point.powerKw;
    if (powerKw == null) continue;
    if (powerKw > REGEN_POWER_THRESHOLD_KW) {
      maxTraction = Math.max(maxTraction, powerKw);
    }
    if (powerKw < -REGEN_POWER_THRESHOLD_KW) {
      maxRegen = Math.max(maxRegen, -powerKw);
    }
  }

  return {
    maxTraction: Math.max(50, maxTraction),
    maxRegen: Math.max(20, maxRegen),
  };
}

function combinedPowerColor(
  powerKw: number | null | undefined,
  maxTraction: number,
  maxRegen: number,
) {
  if (powerKw == null) return COAST_POWER_COLOR;
  if (powerKw < -REGEN_POWER_THRESHOLD_KW) {
    return routeLayerSegmentColor("regen", Math.min(1, (-powerKw) / maxRegen));
  }
  if (powerKw > REGEN_POWER_THRESHOLD_KW) {
    return routeLayerSegmentColor("power", Math.min(1, powerKw / maxTraction));
  }
  return COAST_POWER_COLOR;
}

function normalizeForLayer(
  layer: RouteLayer,
  value: number | null,
  minValue: number,
  maxValue: number,
) {
  if (value == null) return 0;
  const range = layerDisplayRange(layer, minValue, maxValue);
  if (range.max <= range.min) return 1;
  return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
}

function dedupeGradientStops(stops: Array<{ offset: number; color: string }>) {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const deduped: Array<{ offset: number; color: string }> = [];

  for (const stop of sorted) {
    const last = deduped.at(-1);
    if (last && Math.abs(last.offset - stop.offset) < 0.001) {
      last.color = stop.color;
      continue;
    }
    deduped.push({ ...stop });
  }

  if (deduped.length === 0) return [{ offset: 0, color: routeLayerSegmentColor("power", 0) }];
  if (deduped[0].offset > 0) deduped.unshift({ offset: 0, color: deduped[0].color });
  const last = deduped.at(-1)!;
  if (last.offset < 1) deduped.push({ offset: 1, color: last.color });

  return deduped;
}

function buildPathFromMappedPoints(mappedPoints: Array<{ x: number; y: number }>) {
  if (mappedPoints.length < 2) return "";
  const [first, ...rest] = mappedPoints;
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (const point of rest) {
    path += ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  return path;
}

type GradientRouteStroke = {
  key: string;
  d: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  stops: Array<{ offset: number; color: string }>;
};

function buildGradientRouteStroke(
  points: RoutePoint[],
  routeMap: ReturnType<typeof prepareRouteMap>,
  key: string,
  colorAtPoint: (point: RoutePoint) => string,
): GradientRouteStroke | null {
  if (points.length < 2) return null;

  const mappedPoints = points.map((point) => routeMap.mapPoint(point));
  const d = buildPathFromMappedPoints(mappedPoints);
  const start = mappedPoints[0];
  const end = mappedPoints[mappedPoints.length - 1];

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy || 1;

  const stops = dedupeGradientStops(
    points.map((point) => {
      const mapped = routeMap.mapPoint(point);
      const projection = ((mapped.x - start.x) * dx + (mapped.y - start.y) * dy) / lengthSq;
      const offset = Math.max(0, Math.min(1, projection));
      return {
        offset,
        color: colorAtPoint(point),
      };
    }),
  );

  return { key, d, start, end, stops };
}

function buildMetricGradientStroke(
  route: ReturnType<typeof prepareRoute>,
  routeMap: ReturnType<typeof prepareRouteMap>,
  layer: RouteLayer,
) {
  if (route.points.length < 2) return null;

  if (layer === "power") {
    const bounds = powerScaleBounds(route.points);
    return buildGradientRouteStroke(route.points, routeMap, layer, (point) =>
      combinedPowerColor(point.powerKw, bounds.maxTraction, bounds.maxRegen),
    );
  }

  const values = route.points
    .map((point) => routeLayerValue(point, layer))
    .filter((value): value is number => value != null);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;

  return buildGradientRouteStroke(route.points, routeMap, layer, (point) => {
    const normalized = normalizeForLayer(layer, routeLayerValue(point, layer), minValue, maxValue);
    return routeLayerSegmentColor(layer, normalized);
  });
}

type MappedRoutePoint = { x: number; y: number };

function clientToRouteMapPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * MAP_VIEW_WIDTH,
    y: ((clientY - rect.top) / rect.height) * MAP_VIEW_HEIGHT,
  };
}

function distanceSquared(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { x: ax, y: ay, t: 0 };
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return {
    x: ax + t * dx,
    y: ay + t * dy,
    t,
  };
}

function findNearestRoutePoint(
  mappedPoints: MappedRoutePoint[],
  svgX: number,
  svgY: number,
  hitRadius = ROUTE_HIT_RADIUS,
) {
  const hitRadiusSquared = hitRadius * hitRadius;
  let bestDistanceSquared = hitRadiusSquared;
  let bestIndex = -1;
  let bestX = 0;
  let bestY = 0;

  for (let index = 0; index < mappedPoints.length - 1; index += 1) {
    const start = mappedPoints[index];
    const end = mappedPoints[index + 1];
    const closest = closestPointOnSegment(svgX, svgY, start.x, start.y, end.x, end.y);
    const distance = distanceSquared(svgX, svgY, closest.x, closest.y);
    if (distance >= bestDistanceSquared) continue;

    bestDistanceSquared = distance;
    bestIndex = closest.t <= 0.5 ? index : index + 1;
    bestX = closest.x;
    bestY = closest.y;
  }

  if (bestIndex < 0) return null;
  return { index: bestIndex, x: bestX, y: bestY };
}

function RoutePointTooltip({
  point,
  position,
  tx,
}: {
  point: RoutePoint;
  position: { x: number; y: number };
  tx: Translator;
}) {
  const left = (position.x / MAP_VIEW_WIDTH) * 100;
  const top = (position.y / MAP_VIEW_HEIGHT) * 100;

  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[9rem] -translate-x-1/2 -translate-y-[calc(100%+0.5rem)] rounded-lg border border-border bg-background/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <p className="font-semibold text-foreground">{formatClock(point.time)}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
        <dt>{tx("vehicle.route.hoverSoc" as TranslationKey)}</dt>
        <dd className="text-right text-foreground">{fmt(point.soc, 0)}%</dd>
        <dt>{tx("vehicle.route.hoverSpeed" as TranslationKey)}</dt>
        <dd className="text-right text-foreground">{fmt(point.speedKmh, 0)} km/h</dd>
        <dt>{tx("vehicle.route.hoverPower" as TranslationKey)}</dt>
        <dd className="text-right text-foreground">{fmt(point.powerKw, 1)} kW</dd>
      </dl>
    </div>
  );
}

export function RouteMap({
  points,
  trackPoints,
  isLoading = false,
  hasError = false,
  embedded = false,
  headingMode = "route",
  selectedTimeMs = null,
  allowFullscreen = true,
}: {
  points?: VoltflowMateTelemetryPointRow[];
  trackPoints?: VoltflowMateTripTrackPointRow[];
  isLoading?: boolean;
  hasError?: boolean;
  embedded?: boolean;
  /** Location card shows last-known position, not a trip route browser. */
  headingMode?: "route" | "lastSeen";
  /** Ephemeral graph selection used to highlight the nearest GPS track point. */
  selectedTimeMs?: number | null;
  /** Disable the map's own dialog when it is already rendered inside another dialog. */
  allowFullscreen?: boolean;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const route = useMemo(() => {
    if (trackPoints) return prepareRouteFromTrack(trackPoints);
    return prepareRoute(points ?? []);
  }, [points, trackPoints]);
  const start = route.start;
  const end = route.end;
  const baseZoom = useMemo(() => chooseRouteZoom(route), [route]);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<RouteLayer>("route");

  const zoomBy = (delta: number) => {
    setZoomOffset((offset) => {
      const next = stepRouteMapZoom(baseZoom, offset, panRef.current, delta);
      if (next.zoomOffset !== offset) {
        setPan(next.pan);
      }
      return next.zoomOffset;
    });
  };
  const zoomIn = () => zoomBy(1);
  const zoomOut = () => zoomBy(-1);
  const resetView = () => {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  };
  const mapDialogTitleKey =
    headingMode === "lastSeen" ? ("vehicle.location.lastSeen" as TranslationKey) : ("vehicle.route.dialogTitle" as TranslationKey);

  return (
    <section className={embedded ? "rounded-2xl border border-border bg-white/[0.02] p-4" : "voltflow-card p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {tx(headingMode === "lastSeen" ? "vehicle.location.lastSeen" : "vehicle.route.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx(
              headingMode === "lastSeen"
                ? "vehicle.location.lastSeenPoints"
                : "vehicle.route.gpsPoints",
              { value: route.totalPoints },
            )}
          </p>
        </div>
        {start && end ? (
          <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {formatClock(start.time)} - {formatClock(end.time)}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <Skeleton className="mt-5 h-64 rounded-2xl" />
      ) : hasError ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.errors.history")}
        </p>
      ) : route.totalPoints === 0 ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.route.empty")}
        </p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-background">
          <InteractiveRouteCanvas
            route={route}
            zoomOffset={zoomOffset}
            pan={pan}
            onPanChange={setPan}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetView={resetView}
            onOpenFullscreen={allowFullscreen ? () => setIsFullscreenOpen(true) : undefined}
            selectedLayer={selectedLayer}
            onLayerChange={setSelectedLayer}
            selectedTimeMs={selectedTimeMs}
            showLayerLegend={false}
            showToolbarControls={false}
            className="h-64"
          />
          <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            {tx("vehicle.route.mapData")} &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              OpenStreetMap contributors
            </a>
          </div>
          {allowFullscreen ? (
            <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
              <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
              <DialogTitle className="sr-only">{tx(mapDialogTitleKey)}</DialogTitle>
              <InteractiveRouteCanvas
                route={route}
                zoomOffset={zoomOffset}
                pan={pan}
                onPanChange={setPan}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onResetView={resetView}
                selectedLayer={selectedLayer}
                onLayerChange={setSelectedLayer}
                selectedTimeMs={selectedTimeMs}
                onCloseFullscreen={() => setIsFullscreenOpen(false)}
                showLayerLegend
                className="min-h-0 flex-1 rounded-lg"
                isFullscreen
              />
              <div className="text-[11px] text-muted-foreground">
                {tx("vehicle.route.mapData")} &copy;{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  OpenStreetMap contributors
                </a>
              </div>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function RouteMapPreview({
  trackPoints,
  odometerDistanceKm = null,
  className = "h-40",
}: {
  trackPoints: VoltflowMateTripTrackPointRow[];
  odometerDistanceKm?: number | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const route = useMemo(() => prepareRouteFromTrack(trackPoints), [trackPoints]);
  const baseZoom = useMemo(() => chooseRouteZoom(route), [route]);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const [selectedLayer, setSelectedLayer] = useState<RouteLayer>("route");
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const displayable = useMemo(
    () => isRouteTrackDisplayable(trackPoints, 2, 75, { odometerDistanceKm }),
    [trackPoints, odometerDistanceKm],
  );

  if (!displayable || route.totalPoints < 2) return null;

  const zoomBy = (delta: number) => {
    setZoomOffset((offset) => {
      const next = stepRouteMapZoom(baseZoom, offset, panRef.current, delta);
      if (next.zoomOffset !== offset) {
        setPan(next.pan);
      }
      return next.zoomOffset;
    });
  };
  const zoomIn = () => zoomBy(1);
  const zoomOut = () => zoomBy(-1);
  const resetView = () => {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  };

  const canvasProps = {
    route,
    zoomOffset,
    pan,
    onPanChange: setPan,
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onResetView: resetView,
    selectedLayer,
    onLayerChange: setSelectedLayer,
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <InteractiveRouteCanvas
          {...canvasProps}
          onOpenFullscreen={() => setIsFullscreenOpen(true)}
          showLayerLegend={false}
          showToolbarControls={false}
          className={className}
        />
      </div>
      <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{tx("vehicle.route.dialogTitle")}</DialogTitle>
          <InteractiveRouteCanvas
            {...canvasProps}
            onCloseFullscreen={() => setIsFullscreenOpen(false)}
            showLayerLegend
            className="min-h-0 flex-1 rounded-lg"
            isFullscreen
          />
          <div className="text-[11px] text-muted-foreground">
            {tx("vehicle.route.mapData")} &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              OpenStreetMap contributors
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InteractiveRouteCanvas({
  route,
  zoomOffset,
  pan,
  onPanChange,
  onZoomIn,
  onZoomOut,
  onResetView,
  onOpenFullscreen,
  onCloseFullscreen,
  selectedLayer,
  onLayerChange,
  className = "h-64",
  isFullscreen = false,
  showLayerLegend = true,
  showToolbarControls = true,
  markerMode = "trip",
  selectedTimeMs = null,
}: {
  route: ReturnType<typeof prepareRoute>;
  zoomOffset: number;
  pan: MapPan;
  onPanChange: (pan: MapPan | ((current: MapPan) => MapPan)) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onOpenFullscreen?: () => void;
  onCloseFullscreen?: () => void;
  selectedLayer: RouteLayer;
  onLayerChange: (layer: RouteLayer) => void;
  className?: string;
  isFullscreen?: boolean;
  showLayerLegend?: boolean;
  showToolbarControls?: boolean;
  markerMode?: "trip" | "lastPoint";
  selectedTimeMs?: number | null;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const [hoveredPoint, setHoveredPoint] = useState<{ index: number; x: number; y: number } | null>(null);
  const allowMapInteraction = isFullscreen || showToolbarControls;
  const routeMap = useMemo(() => prepareRouteMap(route, zoomOffset, pan), [pan, route, zoomOffset]);
  const mappedRoutePoints = useMemo(
    () => route.points.map((point) => routeMap.mapPoint(point)),
    [route.points, routeMap],
  );
  const solidRoutePath = useMemo(
    () => buildPathFromMappedPoints(mappedRoutePoints),
    [mappedRoutePoints],
  );
  const metricGradientStroke = useMemo(() => {
    if (selectedLayer === "power" || selectedLayer === "speed" || selectedLayer === "soc") {
      return buildMetricGradientStroke(route, routeMap, selectedLayer);
    }
    return null;
  }, [route, routeMap, selectedLayer]);
  const mappedStart = route.start ? routeMap.mapPoint(route.start) : null;
  const mappedEnd = route.end ? routeMap.mapPoint(route.end) : null;
  const selectedPointIndex = useMemo(
    () => nearestRoutePointIndexByTime(route.points, selectedTimeMs),
    [route.points, selectedTimeMs],
  );
  const selectedMarker = useMemo(() => {
    if (selectedPointIndex == null) return null;
    const point = route.points[selectedPointIndex];
    if (!point) return null;
    const mapped = routeMap.mapPoint(point);
    return { index: selectedPointIndex, x: mapped.x, y: mapped.y };
  }, [route.points, routeMap, selectedPointIndex]);
  const activeMarker = hoveredPoint ?? selectedMarker;
  const activeRoutePoint = activeMarker ? route.points[activeMarker.index] ?? null : null;

  const updateRouteHover = (clientX: number, clientY: number, element: SVGSVGElement) => {
    if (dragRef.current) return;

    const pointer = clientToRouteMapPoint(element, clientX, clientY);
    const nearest = findNearestRoutePoint(mappedRoutePoints, pointer.x, pointer.y);
    setHoveredPoint((current) => {
      if (!nearest) return current ? null : current;
      if (
        current &&
        current.index === nearest.index &&
        current.x === nearest.x &&
        current.y === nearest.y
      ) {
        return current;
      }
      return nearest;
    });
  };

  const dragMap = (clientX: number, clientY: number, element: SVGSVGElement) => {
    const previous = dragRef.current;
    if (!previous) return;

    const rect = element.getBoundingClientRect();
    const deltaX = ((clientX - previous.x) * MAP_VIEW_WIDTH) / rect.width;
    const deltaY = ((clientY - previous.y) * MAP_VIEW_HEIGHT) / rect.height;
    onPanChange((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
    dragRef.current = { x: clientX, y: clientY };
  };

  return (
    <div className={`relative overflow-hidden bg-background ${className}`}>
      {showLayerLegend ? (
        <div className="absolute left-2 top-2 z-10 grid w-[10rem] grid-cols-2 gap-1 rounded-2xl border border-border bg-background/85 p-1 shadow-sm backdrop-blur sm:left-3 sm:top-3 sm:w-auto sm:grid-cols-4 sm:rounded-full">
          {ROUTE_LAYER_OPTIONS.map((option) => {
            const selected = option.id === selectedLayer;
            const label = tx(`vehicle.route.layers.${option.id}` as TranslationKey);
            const shortLabel = tx(`vehicle.route.layerShort.${option.id}` as TranslationKey);

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onLayerChange(option.id)}
                className={
                  "inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-normal transition sm:h-8 sm:px-2.5 sm:text-[11px] " +
                  (selected
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-white/10 hover:text-foreground")
                }
                aria-pressed={selected}
                aria-label={label}
                title={label}
              >
                {option.id === "power" ? (
                  <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                    <span className="size-1.5 rounded-full bg-red-500 sm:size-2" />
                    <span className="size-1.5 rounded-full bg-emerald-400 sm:size-2" />
                  </span>
                ) : (
                  <span
                    className="size-1.5 shrink-0 rounded-full sm:size-2"
                    style={{ backgroundColor: option.color }}
                    aria-hidden
                  />
                )}
                <span className="truncate">{shortLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="absolute right-2 top-2 z-10 flex gap-1.5 sm:right-3 sm:top-3 sm:gap-2">
        {showToolbarControls ? (
          <>
            <MapIconButton label={tx("vehicle.route.zoomIn")} onClick={onZoomIn}>
              <Plus className="size-4" aria-hidden />
            </MapIconButton>
            <MapIconButton label={tx("vehicle.route.zoomOut")} onClick={onZoomOut}>
              <Minus className="size-4" aria-hidden />
            </MapIconButton>
            <MapIconButton label={tx("vehicle.route.resetMap")} onClick={onResetView}>
              <MapPin className="size-4" aria-hidden />
            </MapIconButton>
          </>
        ) : null}
        {!isFullscreen && onOpenFullscreen ? (
          <MapIconButton label={tx("vehicle.route.fullscreen")} onClick={onOpenFullscreen}>
            <Maximize2 className="size-4" aria-hidden />
          </MapIconButton>
        ) : null}
        {isFullscreen && onCloseFullscreen ? (
          <MapIconButton label={tx("vehicle.route.exitFullscreen")} onClick={onCloseFullscreen}>
            <Minimize2 className="size-4" aria-hidden />
          </MapIconButton>
        ) : null}
      </div>
      {activeRoutePoint && activeMarker ? (
        <RoutePointTooltip point={activeRoutePoint} position={activeMarker} tx={tx} />
      ) : null}
      <svg
        className={`size-full touch-none ${allowMapInteraction ? "cursor-grab active:cursor-grabbing" : hoveredPoint ? "cursor-crosshair" : "cursor-default"}`}
        viewBox="0 0 320 180"
        role="img"
        aria-label={markerMode === "lastPoint" ? tx("vehicle.location.mapAria") : tx("vehicle.route.aria")}
        onPointerDown={
          allowMapInteraction
            ? (event) => {
                setHoveredPoint(null);
                dragRef.current = { x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }
            : undefined
        }
        onPointerMove={(event) => {
          if (allowMapInteraction && dragRef.current) {
            dragMap(event.clientX, event.clientY, event.currentTarget);
            return;
          }
          updateRouteHover(event.clientX, event.clientY, event.currentTarget);
        }}
        onPointerUp={
          allowMapInteraction
            ? (event) => {
                dragRef.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            : undefined
        }
        onPointerCancel={
          allowMapInteraction
            ? () => {
                dragRef.current = null;
              }
            : undefined
        }
        onPointerLeave={() => setHoveredPoint(null)}
        onWheel={
          allowMapInteraction
            ? (event) => {
                event.preventDefault();
                if (event.deltaY < 0) {
                  onZoomIn();
                } else if (event.deltaY > 0) {
                  onZoomOut();
                }
              }
            : undefined
        }
      >
        <defs>
          <filter id="route-line-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.5)" />
          </filter>
        </defs>
        {routeMap.tiles.map((tile) => (
          <image
            key={tile.key}
            href={tile.url}
            x={tile.x}
            y={tile.y}
            width={MAP_TILE_SIZE}
            height={MAP_TILE_SIZE}
            preserveAspectRatio="none"
          />
        ))}
        <rect width="320" height="180" fill="rgba(5,10,15,0.16)" />
        {selectedLayer === "route" && solidRoutePath ? (
          <path
            d={solidRoutePath}
            fill="none"
            stroke={ROUTE_LINE_COLOR}
            strokeWidth={ROUTE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="nonScalingStroke"
            filter="url(#route-line-shadow)"
          />
        ) : null}
        {metricGradientStroke ? (
          <>
            <linearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              x1={metricGradientStroke.start.x}
              y1={metricGradientStroke.start.y}
              x2={metricGradientStroke.end.x}
              y2={metricGradientStroke.end.y}
            >
              {metricGradientStroke.stops.map((stop, index) => (
                <stop
                  key={`${metricGradientStroke.key}-${index}`}
                  offset={`${(stop.offset * 100).toFixed(2)}%`}
                  stopColor={stop.color}
                />
              ))}
            </linearGradient>
            <path
              d={metricGradientStroke.d}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={ROUTE_STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="nonScalingStroke"
              filter="url(#route-line-shadow)"
            />
          </>
        ) : null}
        {markerMode === "lastPoint" && mappedEnd ? (
          <circle cx={mappedEnd.x} cy={mappedEnd.y} r="6" fill="#38bdf8" stroke="rgba(0,0,0,0.55)" strokeWidth="2">
            <title>{tx("vehicle.location.lastKnown")}</title>
          </circle>
        ) : null}
        {markerMode === "trip" && mappedStart ? (
          <circle cx={mappedStart.x} cy={mappedStart.y} r="5" fill="#22c55e" stroke="rgba(0,0,0,0.55)" strokeWidth="2">
            <title>{tx("vehicle.route.start")}</title>
          </circle>
        ) : null}
        {markerMode === "trip" && mappedEnd && route.totalPoints > 1 ? (
          <circle cx={mappedEnd.x} cy={mappedEnd.y} r="5" fill="#facc15" stroke="rgba(0,0,0,0.55)" strokeWidth="2">
            <title>{tx("vehicle.route.end")}</title>
          </circle>
        ) : null}
        {activeMarker ? (
          <circle
            cx={activeMarker.x}
            cy={activeMarker.y}
            r="4.5"
            fill="#ffffff"
            stroke={ROUTE_LINE_COLOR}
            strokeWidth="2"
            pointerEvents="none"
          />
        ) : null}
      </svg>
    </div>
  );
}

function MapIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur transition hover:border-primary/50 hover:text-primary sm:size-9"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function LiveLocationMap({
  location,
  deviceTimeMs,
  telemetry,
}: {
  location: VoltflowMateLocation;
  deviceTimeMs: number;
  telemetry: VoltflowMateTelemetry;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const route = useMemo(
    () => prepareLiveLocationRoute(location, deviceTimeMs, telemetry),
    [deviceTimeMs, location, telemetry],
  );
  const baseZoom = useMemo(() => chooseRouteZoom(route), [route]);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const [selectedLayer, setSelectedLayer] = useState<RouteLayer>("route");
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const lat = validNumber(location.lat);
  const lon = validNumber(location.lon);

  if (route.totalPoints === 0 || lat == null || lon == null) return null;

  const zoomBy = (delta: number) => {
    setZoomOffset((offset) => {
      const next = stepRouteMapZoom(baseZoom, offset, panRef.current, delta);
      if (next.zoomOffset !== offset) {
        setPan(next.pan);
      }
      return next.zoomOffset;
    });
  };
  const zoomIn = () => zoomBy(1);
  const zoomOut = () => zoomBy(-1);
  const resetView = () => {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  };

  const canvasProps = {
    route,
    zoomOffset,
    pan,
    onPanChange: setPan,
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onResetView: resetView,
    selectedLayer,
    onLayerChange: setSelectedLayer,
    markerMode: "lastPoint" as const,
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <InteractiveRouteCanvas
          {...canvasProps}
          onOpenFullscreen={() => setIsFullscreenOpen(true)}
          showLayerLegend={false}
          showToolbarControls={false}
          className="h-40"
        />
        <div className="border-t border-border px-3 py-2 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          {tx("vehicle.route.mapData")} &copy;{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            OpenStreetMap contributors
          </a>
        </div>
      </div>
      <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{tx("vehicle.location.lastKnown")}</DialogTitle>
          <InteractiveRouteCanvas
            {...canvasProps}
            onCloseFullscreen={() => setIsFullscreenOpen(false)}
            showLayerLegend={false}
            showToolbarControls
            className="min-h-0 flex-1 rounded-lg"
            isFullscreen
          />
          <div className="px-1 text-[11px] text-muted-foreground">
            {tx("vehicle.route.mapData")} &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              OpenStreetMap contributors
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
