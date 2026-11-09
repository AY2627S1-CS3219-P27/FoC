import { MAX_CREDITS, parseCreditAmount } from "./create-errand-form";
import type { BuildingOption, Errand } from "./types";

export interface EditValues {
  /** "" when the current one is unknown or the picker was cleared: never sent. */
  supplierId: string;
  deliveryBuildingId: string;
  deliveryDetail: string;
  collectionItems: string;
  description: string;
  rewardCredits: string;
  /** null keeps the current expiry. */
  expiryDurationMinutes: number | null;
}

export interface EditBody {
  supplierId?: string;
  deliveryBuildingId?: string;
  deliveryDetail?: string;
  collectionItems?: string;
  description?: string;
  rewardCredits?: number;
  expiryDurationMinutes?: number;
}

export const NOTHING_CHANGED = "Nothing to save yet.";

// The map pin placeholder is not a real choice: PATCH cannot set a pin.
export const editableBuildings = (buildings: BuildingOption[]) => buildings.filter((b) => !b.allowsPin);

// The read API has no building id, and short names are not guaranteed unique, so only a single match is trusted.
export function initialEditValues(errand: Errand, buildings: BuildingOption[]): EditValues {
  const matches = editableBuildings(buildings).filter((b) => b.shortName === errand.deliveryLocation);
  return {
    supplierId: errand.supplierId,
    deliveryBuildingId: matches.length === 1 ? matches[0].id : "",
    deliveryDetail: errand.deliveryDetail,
    collectionItems: errand.collectionItems,
    description: errand.description ?? "",
    rewardCredits: String(errand.rewardCredits),
    expiryDurationMinutes: null,
  };
}

// Only what changed: the backend routes on which fields are present, so sending
// the current supplier asks for a re-check and the current reward goes through credit.
export function buildEditBody(initial: EditValues, values: EditValues): EditBody {
  const body: EditBody = {};
  if (values.supplierId && values.supplierId !== initial.supplierId) body.supplierId = values.supplierId;
  if (values.deliveryBuildingId && values.deliveryBuildingId !== initial.deliveryBuildingId) {
    body.deliveryBuildingId = values.deliveryBuildingId;
  }
  for (const field of ["deliveryDetail", "collectionItems", "description"] as const) {
    const next = values[field].trim();
    if (next !== initial[field].trim()) body[field] = next;
  }
  const reward = parseCreditAmount(values.rewardCredits);
  if (reward !== null && reward !== parseCreditAmount(initial.rewardCredits)) body.rewardCredits = reward;
  if (values.expiryDurationMinutes !== null) body.expiryDurationMinutes = values.expiryDurationMinutes;
  return body;
}

// Why Save is blocked, or null when it can go. Mirrors the refusals the backend would give.
export function editProblem(initial: EditValues, values: EditValues): string | null {
  if (!values.collectionItems.trim()) return "Add the items to collect.";
  if (parseCreditAmount(values.rewardCredits) === null) {
    return `Enter a whole number of credits from 1 to ${MAX_CREDITS.toLocaleString()}.`;
  }
  const body = buildEditBody(initial, values);
  const noDetail = !values.deliveryDetail.trim();
  if (noDetail && initial.deliveryDetail.trim()) return "Add a room or level.";
  if (body.deliveryBuildingId && noDetail) {
    return "Add a room or level, since changing the building removes the venue.";
  }
  if (body.rewardCredits !== undefined && (body.supplierId || body.deliveryBuildingId)) {
    return "Change the reward and the supplier or building in separate edits.";
  }
  return Object.keys(body).length === 0 ? NOTHING_CHANGED : null;
}

export function savedMessage(body: EditBody): { title: string; description?: string } {
  if (body.supplierId || body.deliveryBuildingId) {
    return {
      title: "Checking your change",
      description: "It applies once confirmed. If the check fails, the errand stays as it was.",
    };
  }
  if (body.rewardCredits !== undefined) {
    return {
      title: "Reward change sent",
      description: "If you don't have enough credits, the reward stays as it was.",
    };
  }
  return { title: "Errand updated" };
}
