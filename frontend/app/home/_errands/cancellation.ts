// What the cancellation reason on a Cancelled errand means to the person
// reading it. The requester also gets a hint on whether to resubmit; keep the
// wording in step with notification-service's requester-errand-cancelled dispatcher.
const REQUESTER_COPY: Record<string, string> = {
  REQUESTER_CANCELLED: "You cancelled this errand.",
  SUPPLIER_VALIDATION_TIMEOUT: "We couldn't confirm the supplier in time. You can resubmit your errand.",
  CREDIT_TIMEOUT: "We couldn't reserve your credits in time. You can resubmit your errand.",
  SUPPLIER_UNAVAILABLE: "That supplier is no longer available. Resubmit with another one.",
  BUILDING_UNAVAILABLE: "That building is no longer available. Resubmit with another one.",
  INSUFFICIENT_CREDITS: "You didn't have enough credits. Top up, then resubmit your errand.",
  MISSING_BALANCE: "You didn't have enough credits. Top up, then resubmit your errand.",
  ERRAND_EXPIRED: "No courier accepted it in time. You can resubmit it with a longer expiry.",
  PICKUP_TIME_EXCEEDED: "It wasn't delivered in time and your credits were released. You can resubmit it.",
};

const COURIER_COPY: Record<string, string> = {
  REQUESTER_CANCELLED: "The requester cancelled this errand.",
  ERRAND_EXPIRED: "This errand expired before anyone accepted it.",
  PICKUP_TIME_EXCEEDED: "This errand was not delivered within 24 hours of pickup.",
};

export function cancellationText(reason: string, isRequester: boolean): string {
  const copy = isRequester ? REQUESTER_COPY : COURIER_COPY;
  return copy[reason] ?? "This errand was cancelled.";
}
