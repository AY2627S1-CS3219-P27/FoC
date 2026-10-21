export type ErrandStatus =
  | "Pending"
  | "Open"
  | "Accepted"
  | "Picked Up"
  | "Delivered"
  | "Completed"
  | "Cancelled"
  | "Incomplete";

export const ERRAND_STATUSES: ErrandStatus[] = [
  "Pending",
  "Open",
  "Accepted",
  "Picked Up",
  "Delivered",
  "Completed",
  "Cancelled",
  "Incomplete",
];

export interface Errand {
  id: string;
  status: ErrandStatus;
  supplierId: string;
  pickupLocation: string | null;
  pickupDescription: string | null;
  deliveryLocation: string;
  collectionItems: string;
  description: string | null;
  rewardCredits: number;
  expiresAt: string | null;
  createdAt: string;
  requesterId?: string;
  courierId?: string | null;
  cancellationReason?: string | null;
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
  locationDescription: string;
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

export const ALL_ACTIONS = Object.keys(ACTION_LABELS) as ActionName[];

// Mirrors the backend's edges so normal mode only shows what should succeed.
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
