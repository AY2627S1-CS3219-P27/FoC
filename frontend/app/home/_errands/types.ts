export type ErrandStatus =
  | "Pending"
  | "Open"
  | "Accepted"
  | "Picked Up"
  | "Delivered"
  | "Completed"
  | "Cancelled"
  | "Incomplete"
  | "Resolved";

export const ERRAND_STATUSES: ErrandStatus[] = [
  "Pending",
  "Open",
  "Accepted",
  "Picked Up",
  "Delivered",
  "Completed",
  "Cancelled",
  "Incomplete",
  "Resolved",
];

export interface Errand {
  id: string;
  status: ErrandStatus;
  supplierId: string;
  pickupName: string | null;
  pickupLocation: string | null;
  pickupDescription: string | null;
  /** Building short-name snapshot; null until the supplier validates. */
  deliveryLocation: string | null;
  /** Requester's room or level, e.g. "Level 3 04-02". */
  deliveryDetail: string;
  /** Display label snapshotted by order-service once the venue is validated; null before. */
  deliveryVenue: string | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  collectionItems: string;
  description: string | null;
  rewardCredits: number;
  expiresAt: string | null;
  createdAt: string;
  requesterId?: string;
  courierId?: string | null;
  cancellationReason?: string | null;
  /** Courier's share; parties only, and only once Resolved. */
  settlementAmount?: number | null;
  settlementNote?: string | null;
  /** Parties on an Incomplete errand only: the caller's own report, and whether the form is still open. */
  hasReported?: boolean;
  canReport?: boolean;
  /** Incomplete errands: SYSTEM_FAILURE = credit rejected the payout (no dispute to report). */
  cause?: "SYSTEM_FAILURE" | "REQUESTER_DISPUTE";
  /** Admin views only: credit service's rejection reason when cause is SYSTEM_FAILURE. */
  causeReason?: string | null;
}

/** Venue label (order-service labels pins too), else building name, then the requester's note. */
export function formatDelivery(
  errand: Pick<Errand, "deliveryLocation" | "deliveryDetail" | "deliveryVenue">,
): string {
  const place = errand.deliveryVenue ?? errand.deliveryLocation ?? "—";
  return `${place}${errand.deliveryDetail ? ` · ${errand.deliveryDetail}` : ""}`;
}

const CANCELLATION_TEXT: Record<string, string> = {
  VENUE_UNAVAILABLE: "That venue is no longer available. Pick another.",
};

/** Plain-English cancellation reason; unknown reasons show as sent. */
export function cancellationText(reason: string): string {
  return CANCELLATION_TEXT[reason] ?? reason;
}

export interface AdminErrand extends Errand {
  internalStatus: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
}

export interface SupplierOption {
  id: string;
  displayName: string;
  building: { id: string; shortName: string } | null;
  floor: string;
}

export interface BuildingOption {
  id: string;
  shortName: string;
  canonicalName: string;
  coordinates: { latitude: number; longitude: number };
  venueCount: number;
  allowsPin?: boolean;
}

export interface VenueOption {
  id: string;
  code: string;
  name: string | null;
  floor: string;
  coordinates: { latitude: number; longitude: number };
}

export type ActionName =
  | "accept"
  | "pickup"
  | "deliver"
  | "withdraw"
  | "confirm"
  | "incomplete"
  | "cancel";

export const ACTION_LABELS: Record<ActionName, string> = {
  accept: "Accept",
  pickup: "Mark picked up",
  deliver: "Mark delivered",
  withdraw: "Withdraw",
  confirm: "Confirm delivery",
  incomplete: "Report incomplete",
  cancel: "Cancel errand",
};

// The requester may edit until the errand is taken; the backend refuses anything later.
export const canEdit = (errand: Errand, me: string) => errand.status === "Open" && errand.requesterId === me;

// Mirrors the backend's edges so only actions that should succeed are shown.
export function availableActions(errand: Errand, me: string): ActionName[] {
  const isRequester = errand.requesterId === me;
  const isCourier = !!errand.courierId && errand.courierId === me;
  switch (errand.status) {
    case "Open":
      return isRequester ? ["cancel"] : ["accept"];
    case "Accepted":
      return isCourier ? ["pickup", "withdraw"] : [];
    case "Picked Up":
      return isCourier ? ["deliver"] : [];
    case "Delivered":
      return isRequester ? ["confirm", "incomplete"] : [];
    default:
      return [];
  }
}
