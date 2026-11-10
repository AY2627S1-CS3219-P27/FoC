"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { parseCampusBoundary, type CampusBoundary } from "@/lib/campus";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { List, ListRow, Section } from "@/components/ui/layout";
import CampusMap, { type LatLng } from "../_errands/campus-map";
import type { BuildingItem } from "../_shared/types";

// Admins add a building by naming it and dropping a pin on the campus map (F4.3).
export function BuildingsPanel({
  buildings,
  onChanged,
}: {
  buildings: BuildingItem[];
  onChanged: () => void;
}) {
  const [canonicalName, setCanonicalName] = useState("");
  const [shortName, setShortName] = useState("");
  const [aliases, setAliases] = useState("");
  const [at, setAt] = useState<LatLng | null>(null);
  const [campus, setCampus] = useState<{ geojson: unknown; boundary: CampusBoundary } | null>(null);
  const [mapError, setMapError] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  // The outline is fetched once; the picker rejects taps outside it.
  useEffect(() => {
    let active = true;
    void api<unknown>("GET", "/api/campus-boundary").then((res) => {
      if (!active) return;
      const boundary = res.ok ? parseCampusBoundary(res.data) : null;
      if (boundary) setCampus({ geojson: res.data, boundary });
      else setMapError("Could not load the campus map. Try again in a moment.");
    });
    return () => {
      active = false;
    };
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const canonical = canonicalName.trim();
    const short = shortName.trim();
    if (!canonical || !short || !at) {
      setError(!at ? "Pick the building's spot on the map." : "Fill in both names.");
      return;
    }
    setPending(true);
    setError("");
    const aliasList = aliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const res = await api("POST", "/api/buildings", {
      body: {
        canonicalName: canonical,
        shortName: short,
        ...(aliasList.length > 0 && { aliases: aliasList }),
        coordinates: at,
      },
      idempotencyKey: crypto.randomUUID(),
    });
    setPending(false);
    if (res.ok) {
      toast.success(`Added “${canonical}”`);
      setCanonicalName("");
      setShortName("");
      setAliases("");
      setAt(null);
      setMapError("");
      onChanged();
    } else {
      setError(errorText(res, "Could not add the building."));
    }
  }

  const input = `w-full ${inputClass}`;

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="space-y-5">
        <div className="space-y-4 rounded-2xl bg-surface p-4">
          <Field label="Name" required hint="The full, official name shown across the app.">
            <input
              required
              maxLength={100}
              value={canonicalName}
              onChange={(e) => setCanonicalName(e.target.value)}
              placeholder="Computing 3"
              className={input}
            />
          </Field>
          <Field label="Short name" required hint="Used on errands and filters, e.g. COM3.">
            <input
              required
              maxLength={20}
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="COM3"
              className={input}
            />
          </Field>
          <Field label="Also known as (optional)" hint="Comma-separated; helps search and imports match this building.">
            <input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="Computing 3, COM 3"
              className={input}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="section-label mb-1.5 px-4">
            Location
            <span aria-hidden="true" className="ml-0.5 font-semibold text-danger">
              *
            </span>
          </legend>
          <div className="rounded-2xl bg-surface p-4">
            {campus ? (
              <CampusMap
                boundary={campus.boundary}
                geojson={campus.geojson}
                center={null}
                value={at}
                onChange={(next) => {
                  setMapError("");
                  setAt(next);
                }}
                onReject={setMapError}
              />
            ) : (
              !mapError && <div className="h-100 w-full animate-pulse rounded-xl bg-fill" />
            )}
            {mapError && (
              <p aria-live="polite" className="mt-1.5 text-xs text-danger">
                {mapError}
              </p>
            )}
            <p className="mt-1.5 text-xs text-muted">
              {at
                ? `Pinned at ${at.latitude.toFixed(5)}, ${at.longitude.toFixed(5)}`
                : "Tap the map to drop a pin on the building. Drag it to adjust."}
            </p>
          </div>
        </fieldset>

        {error && <FormError>{error}</FormError>}

        <Button
          type="submit"
          block
          disabled={pending || !canonicalName.trim() || !shortName.trim() || !at}
        >
          {pending ? "Adding…" : "Add building"}
        </Button>
      </form>

      <Section title={`${buildings.length} ${buildings.length === 1 ? "building" : "buildings"}`}>
        {buildings.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted">No buildings yet.</p>
        ) : (
          <List>
            {buildings.map((b) => (
              <ListRow
                key={b.id}
                title={b.shortName}
                subtitle={b.canonicalName}
                detail={`${b.venueCount} ${b.venueCount === 1 ? "venue" : "venues"}`}
              />
            ))}
          </List>
        )}
      </Section>
    </div>
  );
}
