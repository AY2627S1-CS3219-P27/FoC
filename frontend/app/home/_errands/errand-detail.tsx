"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError, inputClass } from "@/components/ui/field";
import { Section } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/sheet";
import { cancellationText } from "./cancellation";
import { EditErrandForm } from "./edit-errand-form";
import {
  ACTION_LABELS,
  availableActions,
  canEdit,
  formatDelivery,
  type ActionName,
  type BuildingOption,
  type Errand,
  type SupplierOption,
} from "./types";
import { formatTime, shortId, StatusBadge, timeLeft } from "./ui";

const POLL_MS = 3000;

const DESTRUCTIVE: ActionName[] = ["cancel", "incomplete", "withdraw"];

// Irreversible, or needing a value, so they open a dialog first.
const CONFIRM: Partial<Record<ActionName, { title: string; description: string }>> = {
  cancel: {
    title: "Cancel this errand?",
    description: "Couriers can no longer see it and your reserved credits are released. This cannot be undone.",
  },
  incomplete: {
    title: "Report this delivery as incomplete?",
    description: "The errand closes as incomplete. This cannot be undone.",
  },
  withdraw: {
    title: "Withdraw from this errand?",
    description: "It goes back to other couriers. Tell the requester why.",
  },
};

const DONE: Record<ActionName, string> = {
  accept: "Errand accepted",
  pickup: "Marked as picked up",
  deliver: "Marked as delivered",
  withdraw: "You withdrew from this errand",
  confirm: "Delivery confirmed",
  incomplete: "Reported as incomplete",
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
  buildings,
  onChanged,
  onClose,
}: {
  errandId: string;
  me: string;
  suppliers: SupplierOption[];
  buildings: BuildingOption[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [errand, setErrand] = useState<Errand | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
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
      setLoadError(errorText(res, "Could not load this errand."));
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
    else setActionError(errorText(res, `Could not ${ACTION_LABELS[sent.action].toLowerCase()}.`));
    await load();
    onChanged();
  }

  function run(action: ActionName) {
    const body = action === "withdraw" ? { reason } : undefined;
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
      title={editing ? "Edit errand" : (errand?.pickupName ?? supplier?.displayName ?? `Errand ${shortId(errandId)}`)}
      description={errand && !editing ? role : undefined}
      onBack={editing ? () => setEditing(false) : undefined}
      onClose={onClose}
    >
      {loadError && !errand && (
        <div className="space-y-3 py-6 text-center">
          <p className="text-[15px] text-muted">{loadError}</p>
          {resultLine}
        </div>
      )}

      {!errand && !loadError && (
        <div className="space-y-3 py-2" role="status" aria-label="Loading">
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      )}

      {errand && editing && (
        <EditErrandForm
          errand={errand}
          suppliers={suppliers}
          buildings={buildings}
          onSaved={() => {
            setEditing(false);
            void load();
            onChanged();
          }}
        />
      )}

      {errand && !editing && (
        <div className="fade-in space-y-6">
          <div className="flex flex-col items-center pt-2 text-center">
            <StatusBadge status={errand.status} />
            <p className="tabular mt-3 flex flex-wrap items-baseline justify-center gap-x-1.5 text-[34px] leading-none font-bold tracking-tight text-nus-orange">
              <span className="min-w-0 break-all">{errand.rewardCredits.toLocaleString()}</span>
              <span className="text-[15px] font-semibold whitespace-nowrap text-muted">
                {errand.rewardCredits === 1 ? "credit" : "credits"}
              </span>
            </p>
            <p className="mt-2 text-[13px] text-muted">
              {errand.status === "Pending"
                ? "Waiting for the supplier check and credit reservation. This updates on its own."
                : `Expires ${formatTime(errand.expiresAt)} · ${timeLeft(errand.expiresAt)}`}
            </p>
          </div>

          <Section title="Route">
            <DetailRow label="Pickup">
              {errand.pickupName ?? supplier?.displayName ?? "Unknown supplier"}
              {errand.pickupLocation ? ` · ${errand.pickupLocation}` : ""}
              {errand.pickupDescription && (
                <span className="mt-0.5 block text-[13px] text-muted">{errand.pickupDescription}</span>
              )}
            </DetailRow>
            <DetailRow label="Deliver to">{formatDelivery(errand)}</DetailRow>
          </Section>

          <Section title="Request">
            <DetailRow label="Items">
              <span className="whitespace-pre-wrap">{errand.collectionItems}</span>
            </DetailRow>
            {errand.description && (
              <DetailRow label="Note">
                <span className="whitespace-pre-wrap">{errand.description}</span>
              </DetailRow>
            )}
            {errand.cancellationReason && (
              <DetailRow label="Reason">{cancellationText(errand.cancellationReason, errand.requesterId === me)}</DetailRow>
            )}
            <DetailRow label="Created">{formatTime(errand.createdAt)}</DetailRow>
          </Section>

          {actions.length === 0 ? (
            <p className="text-center text-[13px] text-muted">Nothing for you to do at this stage.</p>
          ) : (
            <div className="grid gap-2">
              {canEdit(errand, me) && (
                <Button
                  size="lg"
                  block
                  disabled={pending}
                  onClick={() => {
                    setActionError("");
                    setEditing(true);
                  }}
                >
                  Edit errand
                </Button>
              )}
              {actions.map((a) => (
                <Button
                  key={a}
                  size="lg"
                  block
                  disabled={pending}
                  onClick={() => {
                    if (CONFIRM[a]) {
                      setReason("");
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
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={(confirming && CONFIRM[confirming]?.title) ?? ""}
        description={(confirming && CONFIRM[confirming]?.description) ?? ""}
        confirmLabel={confirming ? ACTION_LABELS[confirming] : ""}
        intent={confirming && DESTRUCTIVE.includes(confirming) ? "danger" : "primary"}
        confirmDisabled={confirming === "withdraw" && reason.trim() === ""}
        onConfirm={() => {
          setConfirmOpen(false);
          if (confirming) run(confirming);
        }}
      >
        {confirming === "withdraw" && (
          <input
            autoFocus
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            aria-label="Withdraw reason"
            className={`w-full ${inputClass}`}
          />
        )}
      </ConfirmDialog>
    </Sheet>
  );
}

// A labelled value inside a grouped section; hairlines start at the text, as in table views.
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pl-4 [&+&>div]:border-t">
      <div className="border-border py-2.5 pr-4">
        <p className="text-[13px] text-muted">{label}</p>
        <p className="mt-0.5 text-[15px] break-words">{children}</p>
      </div>
    </div>
  );
}
