"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { BuildingOption, SupplierOption } from "./types";
import { Field, inputClass } from "./ui";

const MAX_CREDITS = 2_147_483_647;
const SUFFICIENCY_DEBOUNCE_MS = 300;

type SufficiencyStatus =
  | "unchecked"
  | "checking"
  | "sufficient"
  | "insufficient"
  | "error";

interface CreditSufficiencyResponse {
  userId: string;
  amount: number;
  sufficient: boolean;
}

function parseCreditAmount(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;

  const amount = Number(value);
  return Number.isInteger(amount) && amount >= 1 && amount <= MAX_CREDITS
    ? amount
    : null;
}

const EXPIRY_OPTIONS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 360, label: "6 hours" },
  { minutes: 1440, label: "1 day" },
];

export function CreateErrandForm({
  userId,
  suppliers,
  buildings,
  onCreated,
}: {
  userId: string;
  suppliers: SupplierOption[];
  buildings: BuildingOption[];
  onCreated: (errandId: string) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [collectionItems, setCollectionItems] = useState("");
  const [description, setDescription] = useState("");
  const [rewardCredits, setRewardCredits] = useState("");
  const [sufficiencyStatus, setSufficiencyStatus] =
    useState<SufficiencyStatus>("unchecked");
  const [confirmedAmount, setConfirmedAmount] = useState<number | null>(null);
  const [expiryDurationMinutes, setExpiry] = useState(60);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sufficiencyRequestVersion = useRef(0);

  const supplier = suppliers.find((s) => s.id === supplierId);
  const rewardAmount = parseCreditAmount(rewardCredits);
  const canSubmit =
    !pending &&
    sufficiencyStatus === "sufficient" &&
    rewardAmount !== null &&
    confirmedAmount === rewardAmount;

  useEffect(() => {
    const amount = parseCreditAmount(rewardCredits);
    if (amount === null) return;

    const requestVersion = sufficiencyRequestVersion.current;
    let active = true;
    const timer = setTimeout(() => {
      void api<CreditSufficiencyResponse>("POST", "/api/credits/sufficiency", {
        body: { userId, amount },
        quiet: true,
      }).then((res) => {
        if (!active || sufficiencyRequestVersion.current !== requestVersion) return;

        if (
          !res.ok ||
          !res.data ||
          res.data.userId !== userId ||
          res.data.amount !== amount
        ) {
          setConfirmedAmount(null);
          setSufficiencyStatus("error");
          return;
        }

        setConfirmedAmount(amount);
        setSufficiencyStatus(res.data.sufficient ? "sufficient" : "insufficient");
      });
    }, SUFFICIENCY_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [rewardCredits, userId]);

  function onRewardCreditsChange(value: string) {
    sufficiencyRequestVersion.current += 1;
    setRewardCredits(value);
    setConfirmedAmount(null);
    setSufficiencyStatus(parseCreditAmount(value) === null ? "unchecked" : "checking");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || rewardAmount === null) {
      setError("Enter a valid credit amount and wait for the sufficiency check.");
      return;
    }

    setError("");
    setPending(true);
    const res = await api<{ errandId: string }>("POST", "/api/errands", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        supplierId,
        deliveryLocation,
        collectionItems,
        description: description.trim() || undefined,
        rewardCredits: rewardAmount,
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
          <span className="block text-xs text-muted mt-1">Floor {supplier.floor}</span>
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
            max={MAX_CREDITS}
            step={1}
            value={rewardCredits}
            onChange={(e) => onRewardCreditsChange(e.target.value)}
            aria-describedby="credit-sufficiency-status"
            className={`w-full ${inputClass}`}
          />
          <span
            id="credit-sufficiency-status"
            aria-live="polite"
            className={`mt-1 block text-xs ${
              sufficiencyStatus === "insufficient" || sufficiencyStatus === "error"
                ? "text-danger"
                : "text-muted"
            }`}
          >
            {rewardCredits !== "" && rewardAmount === null
              ? `Enter a whole number from 1 to ${MAX_CREDITS.toLocaleString()}.`
              : sufficiencyStatus === "checking"
                ? "Checking available credits…"
                : sufficiencyStatus === "sufficient"
                  ? "You have enough available credits."
                  : sufficiencyStatus === "insufficient"
                    ? "You do not have enough available credits."
                    : sufficiencyStatus === "error"
                      ? "Could not check your available credits. Edit the amount to try again."
                      : ""}
          </span>
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
        disabled={!canSubmit}
        className="btn-press rounded-xl bg-nus-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-nus-orange-hover disabled:opacity-50 transition-colors"
      >
        {pending ? "Creating…" : "Create errand"}
      </button>
    </form>
  );
}
