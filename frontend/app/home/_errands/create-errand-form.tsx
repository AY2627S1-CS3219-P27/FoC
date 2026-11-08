"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "@/lib/api";
import { parseCampusBoundary, type CampusBoundary } from "@/lib/campus";
import type { LatLng } from "./campus-map";
import type { BuildingOption, SupplierOption, VenueOption } from "./types";
import { Button } from "@/components/ui/button";
import { OptionCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { textareaClass } from "@/components/ui/field";
import { Field, inputClass } from "./ui";

// Leaflet touches window on import, so the map is client-only.
const CampusMap = dynamic(() => import("./campus-map"), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-xl bg-fill" />,
});

/** Where the errand goes: the building alone, a venue in it, or a map pin (at is null until dropped). */
type Location =
  | { kind: "building" }
  | { kind: "venue"; id: string }
  | { kind: "pin"; at: LatLng | null };

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
  const [deliveryBuildingId, setDeliveryBuildingId] = useState("");
  const [location, setLocation] = useState<Location>({ kind: "building" });
  // Last real building chosen: where the map starts, even after switching to the pin building.
  const [anchorBuildingId, setAnchorBuildingId] = useState("");
  const [venues, setVenues] = useState<{ buildingId: string; items: VenueOption[] } | null>(null);
  const [campus, setCampus] = useState<{ geojson: unknown; boundary: CampusBoundary } | null>(null);
  const [mapError, setMapError] = useState("");
  const [deliveryDetail, setDeliveryDetail] = useState("");
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
  const building = buildings.find((b) => b.id === deliveryBuildingId);
  const pinBuilding = buildings.find((b) => b.allowsPin);
  const showMap = location.kind === "pin";
  const venueList = venues?.buildingId === deliveryBuildingId ? venues.items : [];
  const anchor = buildings.find((b) => b.id === anchorBuildingId);
  // Rows lead with the short code; the collapsed input carries the full
  // display name so users never see a bare code or the internal id.
  const buildingOptions = useMemo<ComboboxOption<string>[]>(
    () =>
      buildings.map((b) =>
        b.allowsPin
          ? { value: b.id, label: "Other (choose on map)", title: "Other (choose on map)" }
          : {
              value: b.id,
              label: `${b.shortName} — ${b.canonicalName}`,
              title: b.shortName,
              detail: b.canonicalName,
            },
      ),
    [buildings],
  );
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
  const rewardAmount = parseCreditAmount(rewardCredits);
  const canSubmit =
    !pending &&
    supplierId !== "" &&
    deliveryBuildingId !== "" &&
    (location.kind === "venue" || deliveryDetail.trim() !== "") &&
    (location.kind !== "pin" || location.at !== null) &&
    collectionItems.trim() !== "" &&
    sufficiencyStatus === "sufficient" &&
    rewardAmount !== null &&
    confirmedAmount === rewardAmount;

  // Venues of the chosen building, only when it has any.
  useEffect(() => {
    if (!building || building.venueCount === 0) return;
    let active = true;
    void api<VenueOption[]>("GET", `/api/buildings/${building.id}/venues`).then((res) => {
      if (active) setVenues({ buildingId: building.id, items: res.ok && res.data ? res.data : [] });
    });
    return () => {
      active = false;
    };
  }, [building]);

  // The campus outline, fetched once when the map is first needed.
  useEffect(() => {
    if (!showMap || campus) return;
    let active = true;
    void api<unknown>("GET", "/api/campus-boundary").then((res) => {
      if (!active) return;
      const boundary = res.ok ? parseCampusBoundary(res.data) : null;
      if (boundary) setCampus({ geojson: res.data, boundary });
      else setMapError("Could not load the campus map. Choose a building instead.");
    });
    return () => {
      active = false;
    };
  }, [showMap, campus]);

  function onBuildingChange(id: string) {
    setDeliveryBuildingId(id);
    setMapError("");
    const b = buildings.find((x) => x.id === id);
    if (b?.allowsPin) setLocation({ kind: "pin", at: null });
    else {
      setLocation({ kind: "building" });
      setAnchorBuildingId(id);
    }
  }

  function chooseOnMap() {
    if (!pinBuilding) return;
    setDeliveryBuildingId(pinBuilding.id);
    setMapError("");
    setLocation({ kind: "pin", at: null });
  }

  useEffect(() => {
    const amount = parseCreditAmount(rewardCredits);
    if (amount === null) return;

    const requestVersion = sufficiencyRequestVersion.current;
    let active = true;
    const timer = setTimeout(() => {
      void api<CreditSufficiencyResponse>("POST", "/api/credits/sufficiency", {
        body: { userId, amount },
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
      setError("Fill in every required field and wait for the credit check.");
      return;
    }

    setError("");
    setPending(true);
    const res = await api<{ errandId: string }>("POST", "/api/errands", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        supplierId,
        deliveryBuildingId,
        ...(location.kind === "venue" && { deliveryVenueId: location.id }),
        ...(location.kind === "pin" &&
          location.at && { deliveryPin: { latitude: location.at.latitude, longitude: location.at.longitude } }),
        deliveryDetail: deliveryDetail.trim() || undefined,
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
      setError(errorText(res, "Could not create the errand."));
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <FormGroup footer="Credits are reserved once the supplier is confirmed, then couriers can see the errand.">
        <Field label="Pickup from">
          <OptionCombobox
            options={supplierOptions}
            value={supplierId}
            onValueChange={setSupplierId}
            placeholder="Choose a supplier…"
          />
          {supplier && (
            <span className="mt-1.5 block text-xs text-muted">Floor {supplier.floor}</span>
          )}
        </Field>
  
        <Field label="Deliver to">
          <OptionCombobox
            options={buildingOptions}
            value={deliveryBuildingId}
            onValueChange={onBuildingChange}
            placeholder="Choose a building…"
          />
        </Field>

        {building && building.venueCount > 0 && (
          <Field label="Venue">
            <select
              value={location.kind === "venue" ? location.id : ""}
              onChange={(e) =>
                setLocation(e.target.value ? { kind: "venue", id: e.target.value } : { kind: "building" })
              }
              className={`w-full ${inputClass}`}
            >
              <option value="">No venue (describe below)</option>
              {venueList.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.code, v.name, `Level ${v.floor}`].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
            {pinBuilding && (
              <button type="button" onClick={chooseOnMap} className="mt-1.5 text-xs text-nus-blue underline">
                Can&apos;t find it? Choose on map
              </button>
            )}
          </Field>
        )}

        {showMap && (
          <div>
            {campus ? (
              <CampusMap
                boundary={campus.boundary}
                geojson={campus.geojson}
                center={anchor?.coordinates ?? null}
                value={location.kind === "pin" ? location.at : null}
                onChange={(at) => {
                  setMapError("");
                  setLocation({ kind: "pin", at });
                }}
                onReject={setMapError}
              />
            ) : (
              !mapError && <div className="h-64 w-full animate-pulse rounded-xl bg-fill" />
            )}
            <p aria-live="polite" className={`mt-1.5 text-xs ${mapError ? "text-danger" : "text-muted"}`}>
              {mapError ||
                (location.kind === "pin" && location.at
                  ? `Pin at ${location.at.latitude.toFixed(5)}, ${location.at.longitude.toFixed(5)}`
                  : "Tap the map to drop a pin. Drag it to adjust.")}
              {location.kind === "pin" && location.at && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => setLocation({ kind: "pin", at: null })}
                    className="text-nus-blue underline"
                  >
                    change
                  </button>
                </>
              )}
            </p>
          </div>
        )}

        <Field label={location.kind === "venue" ? "Room or level (optional)" : "Room, level or note"}>
          <input
            required={location.kind !== "venue"}
            maxLength={200}
            value={deliveryDetail}
            onChange={(e) => setDeliveryDetail(e.target.value)}
            placeholder="Level 3, 04-02"
            className={`w-full ${inputClass}`}
          />
        </Field>
      </FormGroup>

      <FormGroup>
        <Field label="Items to collect">
          <textarea
            required
            maxLength={1000}
            value={collectionItems}
            onChange={(e) => setCollectionItems(e.target.value)}
            placeholder="1 large iced milo, less sugar"
            className={`w-full ${textareaClass}`}
            rows={2}
          />
        </Field>
  
        <Field label="Note for the courier (optional)">
          <textarea
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Leave it at the COM2 lobby"
            className={`w-full ${textareaClass}`}
            rows={2}
          />
        </Field>
  
      </FormGroup>

      <FormGroup>
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
              className={`mt-1.5 block text-xs ${
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
      </FormGroup>

      {error && (
        <p role="alert" className="text-[13px] break-words text-danger">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" block disabled={!canSubmit}>
        {pending ? "Creating…" : "Create errand"}
      </Button>
    </form>
  );
}

// A white group on the sheet's gray, holding related fields.
function FormGroup({ footer, children }: { footer?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="space-y-4 rounded-2xl bg-surface p-4">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-[13px] text-muted">{footer}</p>}
    </div>
  );
}
