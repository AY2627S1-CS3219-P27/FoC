"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { OptionCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormError, textareaClass } from "@/components/ui/field";
import { EXPIRY_OPTIONS, MAX_CREDITS } from "./create-errand-form";
import {
  buildEditBody,
  editableBuildings,
  editProblem,
  initialEditValues,
  NOTHING_CHANGED,
  savedMessage,
  type EditValues,
} from "./edit-errand";
import { formatDelivery, type BuildingOption, type Errand, type SupplierOption } from "./types";
import { Field, inputClass } from "./ui";

export function EditErrandForm({
  errand,
  suppliers,
  buildings,
  onSaved,
}: {
  errand: Errand;
  suppliers: SupplierOption[];
  buildings: BuildingOption[];
  onSaved: () => void;
}) {
  // Taken once, so the detail sheet's polling cannot overwrite what is being typed.
  const [initial] = useState(() => initialEditValues(errand, buildings));
  const [values, setValues] = useState<EditValues>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<{ body: string; key: string } | null>(null);

  const supplierOptions = useMemo<ComboboxOption<string>[]>(
    () =>
      suppliers.map((s) => ({
        value: s.id,
        label: s.displayName,
        detail: s.building?.shortName,
        keywords: s.building ? [s.building.shortName] : [],
      })),
    [suppliers],
  );
  const buildingOptions = useMemo<ComboboxOption<string>[]>(
    () =>
      editableBuildings(buildings).map((b) => ({
        value: b.id,
        label: `${b.shortName} — ${b.canonicalName}`,
        title: b.shortName,
        detail: b.canonicalName,
      })),
    [buildings],
  );

  const set = <K extends keyof EditValues>(field: K, value: EditValues[K]) =>
    setValues((prev) => ({ ...prev, [field]: value }));

  const body = buildEditBody(initial, values);
  const problem = editProblem(initial, values);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;

    const sent = JSON.stringify(body);
    // The same key only for a request that may not have arrived; a refusal is stored under its key.
    if (retry.current?.body !== sent) retry.current = { body: sent, key: crypto.randomUUID() };

    setError("");
    setPending(true);
    const res = await api("PATCH", `/api/errands/${errand.id}`, {
      idempotencyKey: retry.current.key,
      body,
    });
    setPending(false);
    if (res.status !== 0) retry.current = null;
    if (res.ok) {
      const { title, description } = savedMessage(body);
      toast.success(title, description ? { description } : undefined);
      onSaved();
    } else {
      setError(errorText(res, "Could not save your changes."));
    }
  }

  return (
    <form onSubmit={onSubmit} className="fade-in space-y-5">
      <FormGroup>
        <Field label="Pickup from">
          <OptionCombobox
            options={supplierOptions}
            value={values.supplierId}
            onValueChange={(v) => set("supplierId", v)}
            placeholder={errand.pickupName ?? "Choose a supplier…"}
          />
        </Field>

        <Field
          label="Deliver to"
          hint={body.deliveryBuildingId ? "Changing the building removes any venue or pin." : undefined}
        >
          <OptionCombobox
            options={buildingOptions}
            value={values.deliveryBuildingId}
            onValueChange={(v) => set("deliveryBuildingId", v)}
            placeholder={formatDelivery(errand)}
          />
        </Field>

        <Field label="Room or level">
          <input
            maxLength={200}
            value={values.deliveryDetail}
            onChange={(e) => set("deliveryDetail", e.target.value)}
            placeholder="Level 3, 04-02"
            className={`w-full ${inputClass}`}
          />
        </Field>
      </FormGroup>

      <FormGroup>
        <Field label="Items to collect">
          <textarea
            maxLength={1000}
            value={values.collectionItems}
            onChange={(e) => set("collectionItems", e.target.value)}
            className={`w-full ${textareaClass}`}
            rows={2}
          />
        </Field>

        <Field label="Note for the courier (optional)">
          <textarea
            maxLength={1000}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            className={`w-full ${textareaClass}`}
            rows={2}
          />
        </Field>
      </FormGroup>

      <FormGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Credits offered" hint="Your reserved credits are updated to the new amount.">
            <input
              type="number"
              min={1}
              max={MAX_CREDITS}
              step={1}
              value={values.rewardCredits}
              onChange={(e) => set("rewardCredits", e.target.value)}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Field label="Open for" hint="Counted from when the errand opened, not from now.">
            <select
              value={values.expiryDurationMinutes ?? ""}
              onChange={(e) => set("expiryDurationMinutes", e.target.value === "" ? null : Number(e.target.value))}
              className={`w-full ${inputClass}`}
            >
              <option value="">Keep current</option>
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </FormGroup>

      {problem && problem !== NOTHING_CHANGED && <p className="text-[13px] break-words text-muted">{problem}</p>}
      {error && <FormError>{error}</FormError>}

      <Button type="submit" size="lg" block disabled={pending || problem !== null}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

// A white group on the sheet's gray, as in the create form.
function FormGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 rounded-2xl bg-surface p-4">{children}</div>;
}
