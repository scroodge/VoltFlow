"use client";

import "leaflet/dist/leaflet.css";

import * as L from "leaflet";
import { useMemo } from "react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";

function PickerEvents({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export function TariffLocationMapPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const markerIcon = useMemo(
    () =>
      L.divIcon({
        className: "tariff-map-pin",
        html: '<div style="width:16px;height:16px;border-radius:999px;background:#00E676;border:2px solid #00D1FF;box-shadow:0 0 0 2px rgba(0,0,0,0.35);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    [],
  );
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        className="h-64 w-full"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          position={[lat, lng]}
          icon={markerIcon}
          draggable
          eventHandlers={{
            dragend: (event) => {
              const marker = event.target;
              const pos = marker.getLatLng();
              onChange(pos.lat, pos.lng);
            },
          }}
        />
        <PickerEvents onPick={onChange} />
      </MapContainer>
    </div>
  );
}
