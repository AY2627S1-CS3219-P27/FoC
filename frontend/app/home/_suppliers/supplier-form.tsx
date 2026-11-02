"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";

export type SupplierFormMode = "admin-create" | "admin-edit" | "request-create" | "request-update";

export interface FormBuilding {
  id: string;
  shortName: string;
  canonicalName: string;
  coordinates?: { latitude: number; longitude: number };
}

interface Values {
  name: string;
  kind: string;
  categoryIds: string[];
  buildingId: string;
  floor: string;
  locationDescription: string;
  latitude: string;
  longitude: string;
  photoUrl: string;
}

interface SupplierDetail {
  name: string;
  kind: string;
  categories: { id: string }[];
  building: { id: string };
  floor: string;
  locationDescription: string;
  coordinates: { latitude: number; longitude: number };
  thumbnailUrl?: string | null;
}

const EMPTY: Values = {
  name: "",
  kind: "Store",
  categoryIds: [],
  buildingId: "",
  floor: "1",
  locationDescription: "",
  latitude: "",
  longitude: "",
  photoUrl: "",
};

const TITLES: Record<SupplierFormMode, string> = {
  "admin-create": "Add supplier",
  "admin-edit": "Edit supplier",
  "request-create": "Suggest a new supplier",
  "request-update": "Suggest a change",
};

const fromDetail = (d: SupplierDetail): Values => ({
  name: d.name,
  kind: d.kind,
  categoryIds: d.categories.map((c) => c.id),
  buildingId: d.building.id,
  floor: d.floor,
  locationDescription: d.locationDescription,
  latitude: String(d.coordinates.latitude),
  longitude: String(d.coordinates.longitude),
  photoUrl: d.thumbnailUrl ?? "",
});

function toBody(v: Values) {
  return {
    name: v.name,
    kind: v.kind,
    categoryIds: v.categoryIds,
    buildingId: v.buildingId,
    floor: v.floor,
    locationDescription: v.locationDescription,
    coordinates: { latitude: Number(v.latitude), longitude: Number(v.longitude) },
    ...(v.photoUrl.trim() ? { photoUrl: v.photoUrl.trim() } : {}),
  };
}

// Only the fields that differ, since updates are partial.
function changedFields(before: Values, after: Values): Record<string, unknown> {
  const a = toBody(after) as Record<string, unknown>;
  const b = toBody(before) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(a).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(b[k])),
  );
}

export function SupplierForm({
  mode,
  supplierId,
  buildings,
  categories,
  onDone,
  onCancel,
}: {
  mode: SupplierFormMode;
  supplierId?: string;
  buildings: FormBuilding[];
  categories: { id: string; name: string }[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const editing = mode === "admin-edit" || mode === "request-update";
  const [values, setValues] = useState<Values>(EMPTY);
  const [original, setOriginal] = useState<Values | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loading, setLoading] = useState(editing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing || !supplierId) return;
    let stale = false;
    api<SupplierDetail>("GET", `/api/suppliers/${supplierId}`).then((res) => {
      // A superseded load must not overwrite what the user has typed since.
      if (stale) return;
      setLoading(false);
      if (res.ok && res.data) {
        const v = fromDetail(res.data);
        setValues(v);
        setOriginal(v);
        setEtag(res.etag);
      } else {
        setError(`${res.status} ${res.message ?? "Could not load the supplier."}`);
      }
    });
    return () => {
      stale = true;
    };
  }, [editing, supplierId]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function pickBuilding(id: string) {
    const b = buildings.find((x) => x.id === id);
    setValues((v) => ({
      ...v,
      buildingId: id,
      // Start from the building's coordinates; the user can refine them.
      ...(b?.coordinates && !editing
        ? { latitude: String(b.coordinates.latitude), longitude: String(b.coordinates.longitude) }
        : {}),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    let res;
    if (mode === "admin-create") {
      res = await send(() => api("POST", "/api/suppliers", { body: toBody(values) }));
    } else if (mode === "request-create") {
      res = await send(() => api("POST", "/api/supplier-requests/creations", { body: toBody(values) }));
    } else {
      const changes = original ? changedFields(original, values) : {};
      if (Object.keys(changes).length === 0) {
        setError("Nothing has changed.");
        return;
      }
      res =
        mode === "admin-edit"
          ? await send(() =>
              api("PATCH", `/api/suppliers/${supplierId}`, { body: changes, ifMatch: etag ?? undefined }),
            )
          : await send(() =>
              api("POST", "/api/supplier-requests/updates", {
                body: { supplierId, changes },
                ifMatch: etag ?? undefined,
              }),
            );
    }
    if (!res.ok) {
      setError(
        res.code === "VERSION_CONFLICT"
          ? "This supplier changed since you opened it. Close and reopen to get the latest version."
          : `${res.status} ${res.message ?? res.code ?? "Could not save."}`,
      );
      return;
    }
    onDone(
      mode === "admin-create"
        ? "Supplier added."
        : mode === "admin-edit"
          ? "Supplier updated."
          : "Request sent. An admin will review it.",
    );
  }

  async function send<T>(call: () => Promise<T>): Promise<T> {
    setPending(true);
    try {
      return await call();
    } finally {
      setPending(false);
    }
  }

  const input = `w-full ${inputClass}`;

  if (loading) return <div role="status" aria-label="Loading supplier" className="skeleton h-48 rounded-2xl" />;

  return (
    <form onSubmit={submit} className="fade-in space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="font-semibold">{TITLES[mode]}</h2>
      {mode.startsWith("request") && (
        <p className="-mt-3 text-xs text-muted">An admin reviews this before it goes live.</p>
      )}

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Name</span>
        <input required maxLength={100} value={values.name} onChange={(e) => set("name", e.target.value)} className={input} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Type</span>
          <select value={values.kind} onChange={(e) => set("kind", e.target.value)} className={input}>
            <option value="Store">Store</option>
            <option value="Facility">Facility</option>
            <option value="Landmark">Landmark</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Floor</span>
          <input
            required
            value={values.floor}
            onChange={(e) => set("floor", e.target.value.toUpperCase())}
            pattern="B[1-9]|[1-9][0-9]?|M"
            title="B1-B9, 1-99 or M"
            className={input}
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Building</span>
        <select required value={values.buildingId} onChange={(e) => pickBuilding(e.target.value)} className={input}>
          <option value="">Choose a building…</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.shortName} — {b.canonicalName}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Where exactly</span>
        <input
          required
          maxLength={255}
          value={values.locationDescription}
          onChange={(e) => set("locationDescription", e.target.value)}
          placeholder="Next to the lift lobby"
          className={input}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Latitude</span>
          <input required type="number" step="any" value={values.latitude} onChange={(e) => set("latitude", e.target.value)} className={input} />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Longitude</span>
          <input required type="number" step="any" value={values.longitude} onChange={(e) => set("longitude", e.target.value)} className={input} />
        </label>
      </div>

      <fieldset className="text-sm">
        <legend className="mb-1.5 font-medium">Categories</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = values.categoryIds.includes(c.id);
            return (
              <label
                key={c.id}
                className={clsx(
                  "btn-press cursor-pointer rounded-full border px-3 py-1 text-xs font-medium select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-nus-orange/50",
                  on ? "border-nus-orange bg-nus-orange/10 text-nus-orange" : "border-border text-muted hover:text-foreground",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() =>
                    set("categoryIds", on ? values.categoryIds.filter((x) => x !== c.id) : [...values.categoryIds, c.id])
                  }
                />
                {c.name}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Photo URL (optional)</span>
        <input type="url" value={values.photoUrl} onChange={(e) => set("photoUrl", e.target.value)} className={input} />
      </label>

      {error && <FormError>{error}</FormError>}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || values.categoryIds.length === 0}>
          {pending ? "Saving…" : mode.startsWith("request") ? "Send request" : "Save"}
        </Button>
        <Button intent="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
