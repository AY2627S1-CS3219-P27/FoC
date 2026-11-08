"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CampusBoundary } from "@/lib/campus";

export interface LatLng {
  latitude: number;
  longitude: number;
}

const MARKER = L.divIcon({
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: '<div style="width:22px;height:22px;border-radius:50%;background:#ef7c00;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>',
});

// Inline picker: one draggable marker, kept inside the campus polygon. Loaded client-only (Leaflet needs window).
export default function CampusMap({
  boundary,
  geojson,
  center,
  value,
  onChange,
  onReject,
}: {
  boundary: CampusBoundary;
  geojson: unknown;
  /** Where the map starts; never limits where the pin may go. Null fits the whole campus. */
  center: LatLng | null;
  value: LatLng | null;
  onChange: (at: LatLng) => void;
  onReject: (message: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const last = useRef<LatLng | null>(value);
  // Latest callbacks, so the map is built once.
  const cb = useRef({ onChange, onReject });
  useEffect(() => {
    cb.current = { onChange, onReject };
  });

  useEffect(() => {
    // A margin around the campus so panning is not stopped dead at the outline.
    const m = L.map(el.current!, {
      maxBounds: L.latLngBounds(boundary.bounds).pad(0.5),
      maxBoundsViscosity: 0.8,
      minZoom: 14,
    });
    map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(m);
    // The view must exist before vector layers are added (Leaflet clips them against it).
    // No building: start centred on the campus, at a zoom that shows most of it.
    if (center) m.setView([center.latitude, center.longitude], 18);
    else m.setView(L.latLngBounds(boundary.bounds).getCenter(), 15);
    const outline = L.geoJSON(geojson as GeoJSON.GeoJsonObject, {
      style: { color: "#003d7c", weight: 2, fill: false },
    }).addTo(m);
    // Gray out everything outside the campus: a world-sized ring with the campus outlines cut out.
    const outers: L.LatLng[][] = [];
    const inners: L.LatLng[][] = [];
    outline.eachLayer((layer) => {
      const rings = (layer as L.Polygon).getLatLngs() as L.LatLng[][] | L.LatLng[][][];
      // Polygon: [outer, ...holes]; MultiPolygon: one of those per polygon.
      const polys = (Array.isArray(rings[0]?.[0]) ? rings : [rings]) as L.LatLng[][][];
      for (const [outer, ...holes] of polys) {
        outers.push(outer);
        inners.push(...holes);
      }
    });
    const world = [L.latLng(-85, -180), L.latLng(-85, 180), L.latLng(85, 180), L.latLng(85, -180)];
    const gray = { stroke: false, fillColor: "#000", fillOpacity: 0.4, interactive: false };
    L.polygon([world, ...outers], gray).addTo(m);
    inners.forEach((hole) => L.polygon(hole, gray).addTo(m));

    const place = (at: LatLng) => {
      last.current = at;
      cb.current.onChange(at);
    };
    m.on("click", (e: L.LeafletMouseEvent) => {
      const at = { latitude: e.latlng.lat, longitude: e.latlng.lng };
      if (boundary.contains(at.latitude, at.longitude)) place(at);
      else cb.current.onReject("That spot is outside the campus. Pick a spot inside the outline.");
    });
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // Built once per boundary; center only sets the first view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary, geojson]);

  // Marker follows the form's value; dragging it back out of campus snaps it to the last good spot.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    last.current = value;
    const ll: L.LatLngExpression = [value.latitude, value.longitude];
    if (marker.current) {
      marker.current.setLatLng(ll);
      return;
    }
    const mk = L.marker(ll, { draggable: true, icon: MARKER }).addTo(m);
    mk.on("dragend", () => {
      const p = mk.getLatLng();
      if (boundary.contains(p.lat, p.lng)) {
        last.current = { latitude: p.lat, longitude: p.lng };
        cb.current.onChange(last.current);
      } else {
        const back = last.current!;
        mk.setLatLng([back.latitude, back.longitude]);
        cb.current.onReject("That spot is outside the campus. Pick a spot inside the outline.");
      }
    });
    marker.current = mk;
  }, [value, boundary]);

  return <div ref={el} className="h-100 w-full overflow-hidden rounded-xl" role="application" aria-label="Campus map" />;
}
