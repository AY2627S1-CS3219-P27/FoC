"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TileConfig, TrackPosition, TrackRoute } from "@/lib/tracking";

interface Props {
  tiles: TileConfig;
  position: TrackPosition | null;
  stale: boolean;
  route: TrackRoute | null;
  destination: { lat: number; lng: number } | null;
}

// Client-only: loaded via next/dynamic with ssr: false. Uses vector markers so no image assets are needed.
export default function TrackingMap({ tiles, position, stale, route, destination }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{
    courier: L.CircleMarker | null;
    accuracy: L.Circle | null;
    route: L.Polyline | null;
    dest: L.CircleMarker | null;
  }>({ courier: null, accuracy: null, route: null, dest: null });
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(
      [1.2966, 103.7764],
      16,
    );
    L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: 19 }).addTo(m);
    map.current = m;
    const l = layers.current;
    return () => {
      m.remove();
      map.current = null;
      fitted.current = false;
      l.courier = l.accuracy = l.route = l.dest = null;
    };
  }, [tiles.url, tiles.attribution]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const l = layers.current;
    const colour = stale ? "#64748b" : "#003D7C";

    if (position) {
      const ll: L.LatLngExpression = [position.lat, position.lng];
      if (l.courier) l.courier.setLatLng(ll).setStyle({ color: colour, fillColor: colour });
      else
        l.courier = L.circleMarker(ll, {
          radius: 9,
          color: colour,
          fillColor: colour,
          fillOpacity: 0.9,
          weight: 3,
        }).addTo(m);
      if (position.accuracy !== null && position.accuracy > 0) {
        if (l.accuracy) l.accuracy.setLatLng(ll).setRadius(position.accuracy).setStyle({ color: colour });
        else
          l.accuracy = L.circle(ll, {
            radius: position.accuracy,
            color: colour,
            weight: 1,
            fillOpacity: 0.12,
          }).addTo(m);
      } else if (l.accuracy) {
        l.accuracy.remove();
        l.accuracy = null;
      }
    } else {
      l.courier?.remove();
      l.accuracy?.remove();
      l.courier = l.accuracy = null;
    }

    if (route && route.polyline.length > 1) {
      const pts = route.polyline.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
      if (l.route) l.route.setLatLngs(pts);
      else l.route = L.polyline(pts, { color: "#EF7C00", weight: 4, opacity: 0.85 }).addTo(m);
    } else if (l.route) {
      l.route.remove();
      l.route = null;
    }

    if (destination) {
      const ll: L.LatLngExpression = [destination.lat, destination.lng];
      if (l.dest) l.dest.setLatLng(ll);
      else
        l.dest = L.circleMarker(ll, {
          radius: 8,
          color: "#16a34a",
          fillColor: "#ffffff",
          fillOpacity: 1,
          weight: 4,
        }).addTo(m);
    } else if (l.dest) {
      l.dest.remove();
      l.dest = null;
    }

    // Fit once when first data arrives; afterwards leave the viewport to the user, only following the courier if it leaves view.
    const pts: L.LatLngTuple[] = [];
    if (position) pts.push([position.lat, position.lng]);
    if (destination) pts.push([destination.lat, destination.lng]);
    if (pts.length && !fitted.current) {
      fitted.current = true;
      if (pts.length === 1) m.setView(pts[0], 17);
      else m.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 18 });
    } else if (position && !m.getBounds().contains([position.lat, position.lng])) {
      m.panTo([position.lat, position.lng]);
    }
  }, [position, stale, route, destination, tiles.url, tiles.attribution]);

  return <div ref={el} className="h-64 w-full rounded-lg z-0" role="presentation" />;
}
