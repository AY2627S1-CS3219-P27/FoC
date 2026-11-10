"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { OptionCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormError, textareaClass } from "@/components/ui/field";
import { EXPIRY_OPTIONS, MAX_CREDITS, parseCreditAmount } from "./create-errand-form";
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
import { useCreditSufficiency } from "./use-credit-sufficiency";

export function EditErrandForm({
  errand,
  userId,
  suppliers,
  buildings,
  onSaved,
}: {
  errand: Errand;
  userId: string;
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

  // The credits already reserved for this errand stay reserved, so only a raise needs more available credits.
  const reward = parseCreditAmount(values.rewardCredits);
  const before = parseCreditAmount(initial.rewardCredits);
  const extra = reward !== null && before !== null && reward > before ? reward - before : null;
  const sufficiency = useCreditSufficiency(userId, extra);
  const short = extra !== null && sufficiency !== "sufficient";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (problem || short) return;

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
            {extra !== null && (
              <span aria-live="polite" className={`mt-1.5 block text-xs ${sufficiency === "sufficient" ? "text-muted" : sufficiency === "checking" ? "text-muted" : "text-danger"}`}>
                {sufficiency === "checking"
                  ? "Checking available credits…"
                  : sufficiency === "sufficient"
                    ? `You have the ${extra.toLocaleString()} extra credits available.`
                    : sufficiency === "insufficient"
                      ? `You do not have ${extra.toLocaleString()} more credits available.`
                      : "Could not check your available credits. Edit the amount to try again."}
              </span>
            )}
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

      {/* Pinned, so the reason Save is blocked shows wherever the edit was made. The offset cancels the sheet's bottom padding, or content shows below the bar. */}
      <div className="sticky bottom-[calc(-1*max(1.5rem,env(safe-area-inset-bottom)))] -mx-4 space-y-2 bg-[var(--background)] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:-mx-5 md:px-5">
        {problem && problem !== NOTHING_CHANGED && <p className="text-[13px] break-words text-muted">{problem}</p>}
        {error && <FormError>{error}</FormError>}

        <Button type="submit" size="lg" block disabled={pending || problem !== null || short}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

// A white group on the sheet's gray, as in the create form.
function FormGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 rounded-2xl bg-surface p-4">{children}</div>;
}
