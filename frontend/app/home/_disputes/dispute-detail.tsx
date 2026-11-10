"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError, inputClass, textareaClass } from "@/components/ui/field";
import { Section } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/sheet";
import { formatDelivery } from "../_errands/types";
import { formatCredits, formatTime, shortId, StatusBadge } from "../_errands/ui";
import { MAX_NOTE_WORDS, wordCount, type DisputeDetailData } from "./types";

const POLL_MS = 3000;

export function DisputeDetail({
  errandId,
  onChanged,
  onClose,
}: {
  errandId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<DisputeDetailData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    const res = await api<DisputeDetailData>("GET", `/api/admin/disputes/${errandId}`);
    if (res.ok && res.data) {
      setData(res.data);
      setLoadError("");
    } else if (res.status === 404) {
      // Resolved meanwhile, or never in dispute.
      setData(null);
      setLoadError("This errand is no longer in dispute.");
    } else {
      setLoadError(errorText(res, "Could not load this dispute."));
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

  const errand = data?.errand;
  const settling = errand?.internalStatus === "Settling-Credit";
  const share = Number(amount);
  const amountOk = amount !== "" && Number.isInteger(share) && share >= 0 && !!errand && share <= errand.rewardCredits;
  const noteOk = note.trim() !== "" && wordCount(note) <= MAX_NOTE_WORDS;

  async function resolve() {
    setPending(true);
    setActionError("");
    const res = await api("POST", `/api/admin/disputes/${errandId}/resolve`, {
      body: { settlementAmount: share, note: note.trim() },
    });
    setPending(false);
    setResolving(false);
    if (res.ok) {
      toast.success("Settlement sent", { description: "Credit service is applying it." });
      setAmount("");
      setNote("");
    } else {
      setActionError(errorText(res, "Could not settle this errand."));
    }
    await load();
    onChanged();
  }

  const rejectionReason = data?.latestRejection?.payload?.reason;

  return (
    <Sheet
      title={errand?.pickupName ?? `Dispute ${shortId(errandId)}`}
      description={errand && `Errand ${shortId(errand.id)}`}
      onClose={onClose}
    >
      {loadError && !data && <p className="py-6 text-center text-[15px] text-muted">{loadError}</p>}

      {!data && !loadError && (
        <div className="space-y-3 py-2" role="status" aria-label="Loading">
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      )}

      {data && errand && (
        <div className="fade-in space-y-6">
          <div className="flex flex-col items-center pt-2 text-center">
            <StatusBadge status={settling ? "Settling credit" : errand.status} />
            <p className="tabular mt-3 text-[34px] leading-none font-bold tracking-tight text-nus-orange">
              {formatCredits(errand.rewardCredits)}
            </p>
            <p className="mt-2 text-[13px] text-muted">Reserved reward the settlement splits</p>
          </div>

          <Section title="Errand">
            <Row label="Route">
              {errand.pickupLocation ?? "—"} → {formatDelivery(errand)}
            </Row>
            <Row label="Items">
              <span className="whitespace-pre-wrap">{errand.collectionItems}</span>
            </Row>
            <Row label="Requester">{shortId(errand.requesterId)}</Row>
            <Row label="Courier">{shortId(errand.courierId)}</Row>
            {errand.cancellationReason && <Row label="Reason">{errand.cancellationReason}</Row>}
          </Section>

          {errand.cause === "SYSTEM_FAILURE" && (
            <Section
              title="Payment failure, not a dispute"
              footer="Credit service rejected the courier's payout. Neither party did anything wrong. Settle with the full reward to the courier; if the reservation is gone, the settlement may be rejected and credits need a manual fix."
            >
              <Row label="Credit service said">{errand.causeReason ?? "—"}</Row>
            </Section>
          )}

          <Section title="Reports" footer="Reports are optional. You can settle with none, one or both.">
            {(["requester", "courier"] as const).map((role) => {
              const r = data.reports.find((x) => x.role === role);
              return (
                <Row key={role} label={`${role === "requester" ? "Requester" : "Courier"}'s report`}>
                  {r ? (
                    <>
                      <span className="whitespace-pre-wrap">{r.body}</span>
                      <span className="mt-0.5 block text-xs text-muted">{formatTime(r.createdAt)}</span>
                    </>
                  ) : (
                    <span className="text-muted">Not filed</span>
                  )}
                </Row>
              );
            })}
          </Section>

          {rejectionReason !== undefined && !settling && (
            <Section title="Last settlement was rejected">
              <Row label="Credit service said">{String(rejectionReason)}</Row>
              <Row label="When">{formatTime(data.latestRejection?.occurredAt)}</Row>
            </Section>
          )}

          <Section title="History">
            {data.events.map((e) => (
              <Row key={e.sequenceNumber} label={formatTime(e.occurredAt)}>
                {e.type}
                <span className="block text-[13px] text-muted">
                  {e.fromStatus ? `${e.fromStatus} → ` : ""}
                  {e.toStatus}
                </span>
              </Row>
            ))}
          </Section>

          {settling ? (
            <p className="text-center text-[13px] text-muted">Settlement is with credit service. This updates on its own.</p>
          ) : (
            <Button
              size="lg"
              block
              onClick={() => {
                if (errand.cause === "SYSTEM_FAILURE" && amount === "") setAmount(String(errand.rewardCredits));
                setResolving(true);
              }}
            >
              Settle this dispute
            </Button>
          )}
          {actionError && <FormError>{actionError}</FormError>}
        </div>
      )}

      <ConfirmDialog
        open={resolving}
        onOpenChange={setResolving}
        title="Settle this dispute"
        description={
          errand
            ? `Courier's share of ${formatCredits(errand.rewardCredits)}. The rest goes back to the requester.`
            : ""
        }
        confirmLabel="Settle"
        pending={pending}
        confirmDisabled={!amountOk || !noteOk}
        onConfirm={() => void resolve()}
      >
        <div className="space-y-2">
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            min={0}
            max={errand?.rewardCredits}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Courier's share (0 to ${errand?.rewardCredits ?? ""})`}
            aria-label="Courier's share"
            className={`w-full ${inputClass}`}
          />
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for both parties (required)"
            aria-label="Settlement note"
            className={`w-full ${textareaClass}`}
          />
          <p className="text-xs text-muted">
            {wordCount(note)}/{MAX_NOTE_WORDS} words
          </p>
        </div>
      </ConfirmDialog>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pl-4 [&+&>div]:border-t">
      <div className="border-border py-2.5 pr-4">
        <p className="text-[13px] text-muted">{label}</p>
        <p className="mt-0.5 text-[15px] break-words">{children}</p>
      </div>
    </div>
  );
}
