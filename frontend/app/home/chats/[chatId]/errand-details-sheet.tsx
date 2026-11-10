"use client";

import { Avatar } from "@/components/ui/avatar";
import { Sheet } from "@/components/ui/sheet";
import type { ChatErrandSummary } from "@/lib/chat/use-chat-errand";
import { formatDelivery } from "../../_errands/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] leading-snug break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

// What the other party is doing for you: who, where from, where to, and what. Nothing else.
export function ErrandDetailsSheet({
  counterpartName,
  counterpartRole,
  errand,
  onClose,
}: {
  counterpartName: string | null;
  counterpartRole: string | null;
  errand: ChatErrandSummary;
  onClose: () => void;
}) {
  const pickup = [errand.pickupName, errand.pickupLocation].filter(Boolean).join(" · ") || "—";

  return (
    <Sheet title="Errand details" onClose={onClose}>
      <div className="flex items-center gap-3 px-1 pt-2 pb-4">
        <Avatar url={null} name={counterpartName ?? counterpartRole ?? "Chat"} size={48} />
        <div className="min-w-0">
          <p className="truncate text-[17px] leading-tight font-semibold">{counterpartName ?? counterpartRole ?? "Participant"}</p>
          {counterpartRole && <p className="text-[13px] text-muted">{counterpartRole}</p>}
        </div>
      </div>
      <dl className="divide-y divide-border overflow-hidden rounded-2xl bg-fill">
        <Row label="Collect from">{pickup}</Row>
        <Row label="Deliver to">{formatDelivery(errand)}</Row>
        <Row label="Items">{errand.collectionItems}</Row>
      </dl>
    </Sheet>
  );
}
