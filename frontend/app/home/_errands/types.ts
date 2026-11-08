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
}

/** Building snapshot plus the requester's room/level, for display. */
export function formatDelivery(
  errand: Pick<Errand, "deliveryLocation" | "deliveryDetail">,
): string {
  return `${errand.deliveryLocation ?? "—"}${
    errand.deliveryDetail ? ` · ${errand.deliveryDetail}` : ""
  }`;
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
}

export type ActionName =
  | "accept"
  | "pickup"
  | "deliver"
  | "withdraw"
  | "confirm"
  | "incomplete"
  | "adjust"
  | "cancel";

export const ACTION_LABELS: Record<ActionName, string> = {
  accept: "Accept",
  pickup: "Mark picked up",
  deliver: "Mark delivered",
  withdraw: "Withdraw",
  confirm: "Confirm delivery",
  incomplete: "Report incomplete",
  adjust: "Change reward",
  cancel: "Cancel errand",
};


// Mirrors the backend's edges so only actions that should succeed are shown.
export function availableActions(errand: Errand, me: string): ActionName[] {
  const isRequester = errand.requesterId === me;
  const isCourier = !!errand.courierId && errand.courierId === me;
  switch (errand.status) {
    case "Open":
      return isRequester ? ["adjust", "cancel"] : ["accept"];
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
