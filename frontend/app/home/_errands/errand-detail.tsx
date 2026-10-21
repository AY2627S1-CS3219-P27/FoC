"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiResult } from "@/lib/api";
import {
  ACTION_LABELS,
  ALL_ACTIONS,
  availableActions,
  type ActionName,
  type Errand,
  type SupplierOption,
} from "./types";
import { formatTime, inputClass, shortId, StatusBadge, timeLeft } from "./ui";

const POLL_MS = 3000;

interface SentAction {
  action: ActionName;
  key: string;
  body?: unknown;
}

function describe(res: ApiResult): string {
  if (res.ok) return `${res.status} OK${res.replayed ? " (replayed, nothing new written)" : ""}`;
  return `${res.status} ${res.code ?? ""}${res.message ? `: ${res.message}` : ""}`;
}

export function ErrandDetail({
  errandId,
  me,
  suppliers,
  showAllActions,
  onChanged,
  onClose,
}: {
  errandId: string;
  me: string;
  suppliers: SupplierOption[];
  showAllActions: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [errand, setErrand] = useState<Errand | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reason, setReason] = useState("");
  const [newAmount, setNewAmount] = useState(0);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const [lastSent, setLastSent] = useState<SentAction | null>(null);

  const load = useCallback(
    async (quiet: boolean) => {
      const res = await api<Errand>("GET", `/api/errands/${errandId}`, { quiet });
      if (res.ok && res.data) {
        setErrand(res.data);
        setLoadError("");
      } else if (res.status === 404) {
        // Taken by another courier, or expired: non-parties can no longer see it.
        setErrand(null);
        setLoadError("This errand is no longer available.");
      } else {
        setLoadError(describe(res));
      }
    },
    [errandId],
  );

  useEffect(() => {
    const first = setTimeout(() => void load(false), 0);
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function send(sent: SentAction) {
    setPending(true);
    setLastSent(sent);
    const res = await api("POST", `/api/errands/${errandId}/${sent.action}`, {
      idempotencyKey: sent.key,
      body: sent.body,
    });
    setPending(false);
    setResult({ text: `${ACTION_LABELS[sent.action]}: ${describe(res)}`, ok: res.ok });
    await load(true);
    onChanged();
  }

  function run(action: ActionName) {
    const body =
      action === "withdraw" ? { reason } : action === "adjust" ? { newAmount } : undefined;
    void send({ action, key: crypto.randomUUID(), body });
  }

  const supplier = errand ? suppliers.find((s) => s.id === errand.supplierId) : undefined;
  const actions = errand
    ? showAllActions
      ? ALL_ACTIONS
      : availableActions(errand, me)
    : [];
  const role =
    errand?.requesterId === me
      ? "You are the requester"
      : errand?.courierId === me
        ? "You are the courier"
        : "You are not a party to this errand";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 scrim" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border-l border-border overflow-y-auto p-6 fade-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold">Errand {shortId(errandId)}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn-press flex items-center justify-center w-8 h-8 rounded-full bg-surface text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {loadError && !errand && (
          <div className="space-y-2">
            <p className="text-sm text-muted">{loadError}</p>
            {result && (
              <p role="status" className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
                {result.text}
              </p>
            )}
          </div>
        )}

        {errand && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={errand.status} />
              <span className="text-sm text-muted">{role}</span>
            </div>
            {errand.status === "Pending" && (
              <p className="text-xs text-muted mb-3">
                Waiting for supplier validation and the credit reservation. This refreshes on its own.
              </p>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm mt-4">
              <dt className="text-muted">Pickup</dt>
              <dd>
                {errand.pickupName ?? supplier?.displayName ?? shortId(errand.supplierId)}
                {errand.pickupLocation ? ` · ${errand.pickupLocation}` : ""}
                {errand.pickupDescription && (
                  <span className="block text-xs text-muted">{errand.pickupDescription}</span>
                )}
              </dd>
              <dt className="text-muted">Deliver to</dt>
              <dd>{errand.deliveryLocation}</dd>
              <dt className="text-muted">Items</dt>
              <dd className="whitespace-pre-wrap">{errand.collectionItems}</dd>
              {errand.description && (
                <>
                  <dt className="text-muted">Note</dt>
                  <dd className="whitespace-pre-wrap">{errand.description}</dd>
                </>
              )}
              <dt className="text-muted">Reward</dt>
              <dd className="font-semibold">{errand.rewardCredits} credits</dd>
              <dt className="text-muted">Expires</dt>
              <dd>
                {formatTime(errand.expiresAt)} ({timeLeft(errand.expiresAt)})
              </dd>
              <dt className="text-muted">Created</dt>
              <dd>{formatTime(errand.createdAt)}</dd>
              {errand.requesterId && (
                <>
                  <dt className="text-muted">Requester</dt>
                  <dd className="font-mono text-xs">{errand.requesterId}</dd>
                  <dt className="text-muted">Courier</dt>
                  <dd className="font-mono text-xs">{errand.courierId ?? "—"}</dd>
                </>
              )}
              {errand.cancellationReason && (
                <>
                  <dt className="text-muted">Reason</dt>
                  <dd>{errand.cancellationReason}</dd>
                </>
              )}
            </dl>

            <div className="mt-6 space-y-3">
              {(actions.includes("withdraw") || actions.includes("adjust")) && (
                <div className="grid gap-2">
                  {actions.includes("withdraw") && (
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Withdraw reason (required)"
                      className={inputClass}
                    />
                  )}
                  {actions.includes("adjust") && (
                    <input
                      type="number"
                      min={1}
                      value={newAmount || ""}
                      onChange={(e) => setNewAmount(Number(e.target.value))}
                      placeholder="New reward amount"
                      className={inputClass}
                    />
                  )}
                </div>
              )}

              {actions.length === 0 ? (
                <p className="text-sm text-muted">No actions for you at this stage.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <button
                      key={a}
                      disabled={pending}
                      onClick={() => run(a)}
                      className={`btn-press rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                        a === "cancel" || a === "incomplete" || a === "withdraw"
                          ? "border border-danger text-danger hover:bg-danger/10"
                          : "bg-nus-orange text-white hover:bg-nus-orange-hover"
                      }`}
                    >
                      {ACTION_LABELS[a]}
                    </button>
                  ))}
                </div>
              )}

              {result && (
                <p
                  role="status"
                  className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}
                >
                  {result.text}
                </p>
              )}

              {lastSent && (
                <button
                  disabled={pending}
                  onClick={() => void send(lastSent)}
                  className="btn-press text-sm text-nus-blue hover:underline disabled:opacity-50"
                >
                  Send “{ACTION_LABELS[lastSent.action]}” again with the same Idempotency-Key
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
