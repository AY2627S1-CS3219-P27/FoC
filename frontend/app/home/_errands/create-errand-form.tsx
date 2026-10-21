"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { BuildingOption, SupplierOption } from "./types";
import { Field, inputClass } from "./ui";

const EXPIRY_OPTIONS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 360, label: "6 hours" },
  { minutes: 1440, label: "1 day" },
];

interface Sufficiency {
  amount: number;
  sufficient: boolean;
}

// Advisory only (F1.2.1): the credit reservation after supplier validation is the real check.
async function checkSufficiency(me: string, amount: number, quiet: boolean): Promise<Sufficiency | null> {
  const res = await api<Sufficiency>("POST", "/api/credits/sufficiency", {
    body: { userId: me, amount },
    quiet,
  });
  return res.ok && res.data ? { amount: res.data.amount, sufficient: res.data.sufficient } : null;
}

export function CreateErrandForm({
  me,
  suppliers,
  buildings,
  onCreated,
}: {
  me: string;
  suppliers: SupplierOption[];
  buildings: BuildingOption[];
  onCreated: (errandId: string) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [collectionItems, setCollectionItems] = useState("");
  const [description, setDescription] = useState("");
  const [rewardCredits, setRewardCredits] = useState(10);
  const [expiryDurationMinutes, setExpiry] = useState(60);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sufficiency, setSufficiency] = useState<Sufficiency | null>(null);

  const supplier = suppliers.find((s) => s.id === supplierId);
  const known = sufficiency?.amount === rewardCredits ? sufficiency : null;

  useEffect(() => {
    if (!Number.isInteger(rewardCredits) || rewardCredits < 1) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const result = await checkSufficiency(me, rewardCredits, true);
      if (!stale) setSufficiency(result);
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [me, rewardCredits]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    const check = await checkSufficiency(me, rewardCredits, false);
    if (check) setSufficiency(check);
    if (check && !check.sufficient) {
      setPending(false);
      setError(`You don't have ${rewardCredits} available credits. Lower the reward or wait for reserved credits to be released.`);
      return;
    }
    const res = await api<{ errandId: string }>("POST", "/api/errands", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        supplierId,
        deliveryLocation,
        collectionItems,
        description: description.trim() || undefined,
        rewardCredits,
        expiryDurationMinutes,
      },
    });
    setPending(false);
    if (res.ok && res.data) {
      setCollectionItems("");
      setDescription("");
      onCreated(res.data.errandId);
    } else {
      setError(`${res.status} ${res.code ?? ""}: ${res.message ?? "Could not create the errand."}`);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="max-w-2xl space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <div>
        <h3 className="text-lg font-semibold">New errand</h3>
        <p className="text-sm text-muted">
          Credits are reserved once the supplier is confirmed. The errand opens to couriers after that.
        </p>
      </div>

      <Field label="Pickup from (supplier)">
        <select
          required
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className={`w-full ${inputClass}`}
        >
          <option value="">Choose a supplier…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
              {s.building ? ` · ${s.building.shortName}` : ""}
            </option>
          ))}
        </select>
        {supplier && (
          <span className="block text-xs text-muted mt-1">
            Floor {supplier.floor}
          </span>
        )}
      </Field>

      <Field label="Deliver to (building)">
        <select
          required
          value={deliveryLocation}
          onChange={(e) => setDeliveryLocation(e.target.value)}
          className={`w-full ${inputClass}`}
        >
          <option value="">Choose a building…</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.shortName}>
              {b.shortName} — {b.canonicalName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Items to collect">
        <textarea
          required
          maxLength={1000}
          value={collectionItems}
          onChange={(e) => setCollectionItems(e.target.value)}
          placeholder="1 large iced milo, less sugar"
          className={`w-full ${inputClass}`}
          rows={2}
        />
      </Field>

      <Field label="Note for the courier (optional)">
        <textarea
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Leave it at the COM2 lobby"
          className={`w-full ${inputClass}`}
          rows={2}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Credits offered">
          <input
            type="number"
            required
            min={1}
            value={rewardCredits}
            onChange={(e) => setRewardCredits(Number(e.target.value))}
            className={`w-full ${inputClass}`}
          />
          {known && (
            <span className={`block text-xs mt-1 ${known.sufficient ? "text-success" : "text-danger"}`}>
              {known.sufficient ? "You have enough available credits." : "Not enough available credits for this reward."}
            </span>
          )}
        </Field>
        <Field label="Open for">
          <select
            value={expiryDurationMinutes}
            onChange={(e) => setExpiry(Number(e.target.value))}
            className={`w-full ${inputClass}`}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        disabled={pending || known?.sufficient === false}
        className="btn-press rounded-xl bg-nus-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-nus-orange-hover disabled:opacity-50 transition-colors"
      >
        {pending ? "Creating…" : "Create errand"}
      </button>
    </form>
  );
}
