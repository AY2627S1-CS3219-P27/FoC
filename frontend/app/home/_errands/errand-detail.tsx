"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import {
  ACTION_LABELS,
  availableActions,
  type ActionName,
  type Errand,
  type SupplierOption,
} from "./types";
import { formatTime, inputClass, shortId, StatusBadge, timeLeft } from "./ui";

const POLL_MS = 3000;

const DESTRUCTIVE: ActionName[] = ["cancel", "incomplete", "withdraw"];

// Irreversible, so they ask first. Withdraw already needs a typed reason.
const CONFIRM: Partial<Record<ActionName, { title: string; description: string }>> = {
  cancel: {
    title: "Cancel this errand?",
    description: "Couriers can no longer see it and your reserved credits are released. This cannot be undone.",
  },
  incomplete: {
    title: "Report this delivery as incomplete?",
    description: "The errand closes as incomplete. This cannot be undone.",
  },
};

const DONE: Record<ActionName, string> = {
  accept: "Errand accepted",
  pickup: "Marked as picked up",
  deliver: "Marked as delivered",
  withdraw: "You withdrew from this errand",
  confirm: "Delivery confirmed",
  incomplete: "Reported as incomplete",
  adjust: "Reward updated",
  cancel: "Errand cancelled",
};

interface SentAction {
  action: ActionName;
  key: string;
  body?: unknown;
}

export function ErrandDetail({
  errandId,
  me,
  suppliers,
  onChanged,
  onClose,
}: {
  errandId: string;
  me: string;
  suppliers: SupplierOption[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [errand, setErrand] = useState<Errand | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reason, setReason] = useState("");
  const [newAmount, setNewAmount] = useState(0);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirming, setConfirming] = useState<ActionName | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await api<Errand>("GET", `/api/errands/${errandId}`);
    if (res.ok && res.data) {
      setErrand(res.data);
      setLoadError("");
    } else if (res.status === 404) {
      // Taken by another courier, or expired: non-parties can no longer see it.
      setErrand(null);
      setLoadError("This errand is no longer available.");
    } else {
      setLoadError(res.message ?? "Could not load this errand.");
    }
  }, [errandId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function send(sent: SentAction) {
    setPending(true);
    setActionError("");
    const res = await api("POST", `/api/errands/${errandId}/${sent.action}`, {
      idempotencyKey: sent.key,
      body: sent.body,
    });
    setPending(false);
    if (res.ok) toast.success(DONE[sent.action]);
    else setActionError(res.message ?? `Could not ${ACTION_LABELS[sent.action].toLowerCase()}.`);
    await load();
    onChanged();
  }

  function run(action: ActionName) {
    const body =
      action === "withdraw" ? { reason } : action === "adjust" ? { newAmount } : undefined;
    void send({ action, key: crypto.randomUUID(), body });
  }

  const supplier = errand ? suppliers.find((s) => s.id === errand.supplierId) : undefined;
  const actions = errand ? availableActions(errand, me) : [];
  const role =
    errand?.requesterId === me
      ? "You are the requester"
      : errand?.courierId === me
        ? "You are the courier"
        : "You are not a party to this errand";

  const resultLine = actionError && <FormError>{actionError}</FormError>;

  return (
    <Sheet
      title={`Errand ${shortId(errandId)}`}
      description={errand ? role : undefined}
      onClose={onClose}
    >
      {loadError && !errand && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{loadError}</p>
          {resultLine}
        </div>
      )}

      {!errand && !loadError && (
        <div className="space-y-3" role="status" aria-label="Loading">
          <div className="skeleton h-5 w-24 rounded-full" />
          <div className="skeleton h-4 w-3/4 rounded-md" />
          <div className="skeleton h-4 w-1/2 rounded-md" />
        </div>
      )}

      {errand && (
        <div className="fade-in">
          <div className="flex items-center gap-3 rounded-2xl bg-surface p-4">
            <div className="min-w-0 flex-1">
              <StatusBadge status={errand.status} />
              <p className="mt-2 text-sm text-muted">Reward</p>
              <p className="tabular flex flex-wrap items-baseline gap-x-1 text-2xl font-bold text-nus-orange">
                <span className="min-w-0 break-all">{errand.rewardCredits.toLocaleString()}</span>
                <span className="text-sm font-medium whitespace-nowrap text-muted">
                  {errand.rewardCredits === 1 ? "credit" : "credits"}
                </span>
              </p>
            </div>
            <div className="shrink-0 text-right text-sm">
              <p className="text-muted">Expires</p>
              <p className="font-medium">{timeLeft(errand.expiresAt)}</p>
            </div>
          </div>
          {errand.status === "Pending" && (
            <p className="mt-3 text-xs text-muted">
              Waiting for supplier validation and the credit reservation. This refreshes on its own.
            </p>
          )}

          <dl className="mt-5 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted">Pickup</dt>
            <dd className="break-words">
              {errand.pickupName ?? supplier?.displayName ?? "Unknown supplier"}
              {errand.pickupLocation ? ` · ${errand.pickupLocation}` : ""}
              {errand.pickupDescription && (
                <span className="block text-xs text-muted">{errand.pickupDescription}</span>
              )}
            </dd>
            <dt className="text-muted">Deliver to</dt>
            <dd className="break-words">{errand.deliveryLocation}</dd>
            <dt className="text-muted">Items</dt>
            <dd className="whitespace-pre-wrap break-words">{errand.collectionItems}</dd>
            {errand.description && (
              <>
                <dt className="text-muted">Note</dt>
                <dd className="whitespace-pre-wrap break-words">{errand.description}</dd>
              </>
            )}
            <dt className="text-muted">Expires</dt>
            <dd>{formatTime(errand.expiresAt)}</dd>
            <dt className="text-muted">Created</dt>
            <dd>{formatTime(errand.createdAt)}</dd>
            {errand.requesterId && (
              <>
                <dt className="text-muted">Requester</dt>
                <dd className="font-mono text-xs break-all">{errand.requesterId}</dd>
                <dt className="text-muted">Courier</dt>
                <dd className="font-mono text-xs break-all">{errand.courierId ?? "—"}</dd>
              </>
            )}
            {errand.cancellationReason && (
              <>
                <dt className="text-muted">Reason</dt>
                <dd className="break-words">{errand.cancellationReason}</dd>
              </>
            )}
          </dl>

          <div className="mt-6 space-y-3 border-t border-border pt-5">
            {(actions.includes("withdraw") || actions.includes("adjust")) && (
              <div className="grid gap-2">
                {actions.includes("withdraw") && (
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Withdraw reason (required)"
                    aria-label="Withdraw reason"
                    className={`w-full ${inputClass}`}
                  />
                )}
                {actions.includes("adjust") && (
                  <input
                    type="number"
                    min={1}
                    value={newAmount || ""}
                    onChange={(e) => setNewAmount(Number(e.target.value))}
                    placeholder="New reward amount"
                    aria-label="New reward amount"
                    className={`w-full ${inputClass}`}
                  />
                )}
              </div>
            )}

            {actions.length === 0 ? (
              <p className="text-sm text-muted">No actions for you at this stage.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (CONFIRM[a]) {
                        setConfirming(a);
                        setConfirmOpen(true);
                      } else run(a);
                    }}
                    intent={DESTRUCTIVE.includes(a) ? "danger-outline" : "primary"}
                  >
                    {ACTION_LABELS[a]}
                  </Button>
                ))}
              </div>
            )}

            {resultLine}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={(confirming && CONFIRM[confirming]?.title) ?? ""}
        description={(confirming && CONFIRM[confirming]?.description) ?? ""}
        confirmLabel={confirming ? ACTION_LABELS[confirming] : ""}
        intent="danger"
        onConfirm={() => {
          setConfirmOpen(false);
          if (confirming) run(confirming);
        }}
      />
    </Sheet>
  );
}
