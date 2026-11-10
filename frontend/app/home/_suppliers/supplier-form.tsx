"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { api, errorText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { OptionCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FormError, inputClass } from "@/components/ui/field";

export type SupplierFormMode = "admin-create" | "admin-edit" | "request-create" | "request-update";

export interface FormBuilding {
  id: string;
  shortName: string;
  canonicalName: string;
  coordinates?: { latitude: number; longitude: number };
  allowsPin?: boolean; // the map-pin pseudo building: errands use it, a supplier cannot be in it
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
  onCancel?: () => void;
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
        setError(errorText(res, "Could not load the supplier."));
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

  // Rows lead with the short code; the collapsed input carries the full
  // display name so users never see a bare code or the internal id.
  const buildingOptions = useMemo<ComboboxOption<string>[]>(
    () =>
      buildings.filter((b) => !b.allowsPin).map((b) => ({
        value: b.id,
        label: `${b.shortName} — ${b.canonicalName}`,
        title: b.shortName,
        detail: b.canonicalName,
      })),
    [buildings],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (values.buildingId === "") {
      setError("Choose the building the supplier is in.");
      return;
    }
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
          : errorText(res, "Could not save."),
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

  if (loading) return <div role="status" aria-label="Loading supplier" className="skeleton h-64 rounded-2xl" />;

  return (
    <form onSubmit={submit} className="fade-in space-y-5">
      <div>
        <div className="space-y-4 rounded-2xl bg-surface p-4">
          <Field label="Name">
            <input required maxLength={100} value={values.name} onChange={(e) => set("name", e.target.value)} className={input} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={values.kind} onChange={(e) => set("kind", e.target.value)} className={input}>
                <option value="Store">Store</option>
                <option value="Facility">Facility</option>
                <option value="Landmark">Landmark</option>
              </select>
            </Field>
            <Field label="Floor">
              <input
                required
                value={values.floor}
                onChange={(e) => set("floor", e.target.value.toUpperCase())}
                pattern="B[1-9]|[1-9][0-9]?|M"
                title="B1-B9, 1-99 or M"
                className={input}
              />
            </Field>
          </div>
        </div>
        {mode.startsWith("request") && (
          <p className="mt-1.5 px-4 text-[13px] text-muted">An admin reviews this before it goes live.</p>
        )}
      </div>

      <div className="space-y-4 rounded-2xl bg-surface p-4">
        <Field label="Building">
          <OptionCombobox
            options={buildingOptions}
            value={values.buildingId}
            onValueChange={pickBuilding}
            placeholder="Choose a building…"
          />
        </Field>
        <Field label="Where exactly">
          <input
            required
            maxLength={255}
            value={values.locationDescription}
            onChange={(e) => set("locationDescription", e.target.value)}
            placeholder="Next to the lift lobby"
            className={input}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <input required type="number" step="any" value={values.latitude} onChange={(e) => set("latitude", e.target.value)} className={input} />
          </Field>
          <Field label="Longitude">
            <input required type="number" step="any" value={values.longitude} onChange={(e) => set("longitude", e.target.value)} className={input} />
          </Field>
        </div>
      </div>

      <fieldset>
        <legend className="section-label mb-1.5 px-4">Categories</legend>
        <div className="flex flex-wrap gap-2 rounded-2xl bg-surface p-4">
          {categories.length === 0 && <p className="text-[13px] text-muted">No categories yet.</p>}
          {categories.map((c) => {
            const on = values.categoryIds.includes(c.id);
            return (
              <label
                key={c.id}
                className={clsx(
                  "btn-press cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-medium select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-nus-orange/50",
                  on ? "bg-nus-orange text-white" : "bg-fill text-foreground",
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
        <p className="mt-1.5 px-4 text-[13px] text-muted">Pick at least one.</p>
      </fieldset>

      {/* Admins only: a basic user's request never carries a photo. */}
      {!mode.startsWith("request") && (
        <div className="rounded-2xl bg-surface p-4">
          <Field label="Photo URL (optional)">
            <input type="url" value={values.photoUrl} onChange={(e) => set("photoUrl", e.target.value)} className={input} />
          </Field>
        </div>
      )}

      {error && <FormError>{error}</FormError>}

      <div className="grid gap-2">
        <Button type="submit" size="lg" block disabled={pending || values.categoryIds.length === 0}>
          {pending ? "Saving…" : mode.startsWith("request") ? "Send request" : TITLES[mode]}
        </Button>
        {onCancel && (
          <Button intent="ghost" size="lg" block onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
